'use client'

import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase/cliente'
import type { AccesoLocal, Permiso } from './tipos'

interface Sesion {
  cargando: boolean
  session: Session | null
  nombre: string
  locales: AccesoLocal[]
  local: AccesoLocal | null
  elegirLocal: (id: string) => void
  puede: (permiso: Permiso) => boolean
  salir: () => Promise<void>
}

const SesionContext = createContext<Sesion | null>(null)

const UNA_SEMANA = 7 * 24 * 60 * 60 * 1000
const CLAVE_DATOS = 'stock-bebidas-datos'
/** Consultas que no vale la pena guardar en el dispositivo (grandes o solo de consulta). */
const NO_GUARDAR = new Set(['historial', 'papelera', 'movimientos', 'permisos'])

/** Lo último que se leyó de la base queda guardado en el dispositivo, para verlo sin conexión. */
const guardadoLocal = createSyncStoragePersister({
  // En el servidor no hay dónde guardar: no hace nada
  storage:
    typeof window === 'undefined'
      ? undefined
      : {
          getItem: (k) => {
            try {
              return window.localStorage.getItem(k)
            } catch {
              return null
            }
          },
          // Si el dispositivo se queda sin lugar, no se guarda (la app sigue andando igual)
          setItem: (k, v) => {
            try {
              window.localStorage.setItem(k, v)
            } catch {}
          },
          removeItem: (k) => {
            try {
              window.localStorage.removeItem(k)
            } catch {}
          },
        },
  key: CLAVE_DATOS,
  throttleTime: 2000,
  // Algunos datos son Map o Set (ej: el stock por artículo): se guardan de forma que vuelvan igual
  serialize: (datos) =>
    JSON.stringify(datos, (_k, v: unknown) =>
      v instanceof Map ? { __tipo: 'Map', v: [...v.entries()] } : v instanceof Set ? { __tipo: 'Set', v: [...v] } : v,
    ),
  deserialize: (texto) =>
    JSON.parse(texto, (_k, v: { __tipo?: string; v?: unknown[] } | unknown) => {
      const o = v as { __tipo?: string; v?: unknown[] } | null
      if (o && typeof o === 'object' && o.__tipo === 'Map') return new Map(o.v as [unknown, unknown][])
      if (o && typeof o === 'object' && o.__tipo === 'Set') return new Set(o.v)
      return v
    }),
})

export function Proveedores({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Sin conexión se muestra lo último guardado (y se actualiza solo al volver internet)
          queries: {
            staleTime: 30_000,
            gcTime: UNA_SEMANA,
            retry: 1,
            refetchOnWindowFocus: true,
          },
          // Los guardados que no son del evento fallan enseguida con "No hay conexión" (no se quedan esperando)
          mutations: { networkMode: 'always' },
        },
      }),
  )
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: guardadoLocal,
        maxAge: UNA_SEMANA,
        buster: 'v2',
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === 'success' && !NO_GUARDAR.has(String(q.queryKey[0])),
        },
      }}
    >
      <ProveedorSesion>{children}</ProveedorSesion>
    </PersistQueryClientProvider>
  )
}

const CLAVE_SESION = 'stock-bebidas-sesion'

/** Sesión guardada en el dispositivo, tal cual (para seguir usando la app sin conexión aunque haya vencido). */
function sesionGuardada(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION) ?? 'null') as Session | null
    return s?.user?.id ? s : null
  } catch {
    return null
  }
}

/** Sin internet no se puede renovar la sesión: se sigue con la guardada hasta que vuelva la conexión. */
function sinConexion() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

const CLAVE_LOCAL = 'stock-bebidas-local'

function ProveedorSesion({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sesionLista, setSesionLista] = useState(false)
  const [localElegido, setLocalElegido] = useState<string | null>(null)

  useEffect(() => {
    const sb = supabase()
    sb.auth.getSession().then(({ data, error }) => {
      try {
        setLocalElegido(localStorage.getItem(CLAVE_LOCAL))
      } catch {}
      // Vencida y sin internet para renovarla: se usa la guardada
      setSession(data.session ?? (error || sinConexion() ? sesionGuardada() : null))
      setSesionLista(true)
    })
    const { data } = sb.auth.onAuthStateChange((evento, nueva) => {
      if (!nueva && evento !== 'SIGNED_OUT' && sinConexion()) {
        const guardada = sesionGuardada()
        if (guardada) return setSession(guardada)
      }
      setSession(nueva)
      setSesionLista(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const usuarioId = session?.user.id
  const acceso = useQuery({
    queryKey: ['acceso', usuarioId],
    enabled: !!usuarioId,
    queryFn: async () => {
      const sb = supabase()
      const [{ data: locales, error }, { data: perfil }] = await Promise.all([
        sb.rpc('mi_acceso'),
        sb.from('perfiles').select('nombre').eq('id', usuarioId!).maybeSingle(),
      ])
      if (error) throw error
      return {
        locales: (locales ?? []) as AccesoLocal[],
        nombre: (perfil?.nombre as string) ?? '',
      }
    },
  })

  const locales = useMemo(() => acceso.data?.locales ?? [], [acceso.data])
  const local = locales.find((l) => l.local_id === localElegido) ?? locales[0] ?? null

  const elegirLocal = useCallback((id: string) => {
    setLocalElegido(id)
    try {
      localStorage.setItem(CLAVE_LOCAL, id)
    } catch {}
  }, [])

  const puede = useCallback((permiso: Permiso) => !!local?.permisos.includes(permiso), [local])

  const salir = useCallback(async () => {
    // Cambios cargados sin conexión que todavía no se mandaron
    let pendientes = 0
    try {
      pendientes = (
        JSON.parse(localStorage.getItem('stock-bebidas-cola') ?? '[]') as {
          estado: string
        }[]
      ).filter((p) => p.estado === 'pendiente').length
    } catch {}
    if (
      pendientes &&
      !confirm(
        `Hay ${pendientes} ${pendientes === 1 ? 'cambio cargado' : 'cambios cargados'} sin conexión que todavía no se mandaron.\n\n` +
          'Si salís ahora, quedan guardados en este celular y se mandan cuando vuelvas a entrar con tu usuario. ¿Salir igual?',
      )
    )
      return
    // Sin internet se cierra solo en este dispositivo
    await supabase().auth.signOut(sinConexion() ? { scope: 'local' } : undefined)
    queryClient.clear()
    try {
      localStorage.removeItem(CLAVE_DATOS)
    } catch {}
  }, [queryClient])

  const valor: Sesion = {
    cargando: !sesionLista || (!!usuarioId && acceso.isPending),
    session,
    nombre: acceso.data?.nombre || session?.user.email || '',
    locales,
    local,
    elegirLocal,
    puede,
    salir,
  }

  return <SesionContext value={valor}>{children}</SesionContext>
}

export function useSesion(): Sesion {
  const s = useContext(SesionContext)
  if (!s) throw new Error('useSesion debe usarse dentro de <Proveedores>')
  return s
}

/** Atajo: el local actual (las pantallas internas siempre tienen uno). */
export function useLocalId(): string {
  const { local } = useSesion()
  return local?.local_id ?? ''
}
