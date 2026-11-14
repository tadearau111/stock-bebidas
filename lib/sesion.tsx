'use client'

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
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

export function Proveedores({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <ProveedorSesion>{children}</ProveedorSesion>
    </QueryClientProvider>
  )
}

const CLAVE_LOCAL = 'stock-bebidas-local'

function ProveedorSesion({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sesionLista, setSesionLista] = useState(false)
  const [localElegido, setLocalElegido] = useState<string | null>(null)

  useEffect(() => {
    const sb = supabase()
    sb.auth.getSession().then(({ data }) => {
      try {
        setLocalElegido(localStorage.getItem(CLAVE_LOCAL))
      } catch {}
      setSession(data.session)
      setSesionLista(true)
    })
    const { data } = sb.auth.onAuthStateChange((_evento, nueva) => {
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
      return { locales: (locales ?? []) as AccesoLocal[], nombre: (perfil?.nombre as string) ?? '' }
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
    await supabase().auth.signOut()
    queryClient.clear()
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
