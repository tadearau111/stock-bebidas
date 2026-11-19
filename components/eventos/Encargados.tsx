'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Aviso, Cargando } from '@/components/ui'
import { mensajeError } from '@/lib/formato'
import { useAsignadosEvento, useMarcarEncargado, useRoles, useUsuarios, type UsuarioLocal } from '@/lib/usuarios'

/** Usuarios que necesitan que se les asigne el evento (cargan datos pero no ven todos los eventos). */
export function useEncargadosDisponibles() {
  const { data: usuarios, isPending } = useUsuarios()
  const { data: roles } = useRoles()
  const rolesQueCargan = new Set(
    (roles ?? []).filter((r) => r.permisos.includes('eventos.cargar') && !r.permisos.includes('eventos.gestionar')).map((r) => r.id),
  )
  const lista = (usuarios ?? []).filter((u) => rolesQueCargan.has(u.rol_id))
  return { lista, todos: usuarios ?? [], isPending: isPending || !roles }
}

/** Nombres de los encargados asignados al evento (para mostrar en el encabezado). */
export function NombresEncargados({ eventoId }: { eventoId: string }) {
  const { data: asignados } = useAsignadosEvento(eventoId)
  const { todos } = useEncargadosDisponibles()
  const nombres = todos.filter((u) => asignados?.has(u.usuario_id)).map((u) => u.nombre)
  if (!asignados) return null
  return <p className="text-sm text-suave">{nombres.length ? `Encargados: ${nombres.join(', ')}` : 'Sin encargados asignados'}</p>
}

/** Lista para tildar varios encargados a la vez. Cada tilde se guarda al instante. */
export function ElegirEncargados({ eventoId }: { eventoId: string }) {
  const { data: asignados } = useAsignadosEvento(eventoId)
  const { lista, todos, isPending } = useEncargadosDisponibles()
  const marcar = useMarcarEncargado(eventoId)
  const [error, setError] = useState('')
  // Tildes en pantalla (se actualizan al instante, sin esperar a la base)
  const [marcados, setMarcados] = useState<Set<string> | null>(null)
  const vistos = marcados ?? asignados

  if (isPending || !asignados || !vistos) return <Cargando />

  // También se muestran los ya asignados aunque hoy tengan otro rol, para poder quitarlos
  const extra = todos.filter((u) => vistos.has(u.usuario_id) && !lista.some((l) => l.usuario_id === u.usuario_id))
  const opciones: UsuarioLocal[] = [...lista, ...extra].sort((a, b) => Number(b.perfil_activo) - Number(a.perfil_activo) || a.nombre.localeCompare(b.nombre, 'es'))

  async function alternar(u: UsuarioLocal, asignado: boolean) {
    setError('')
    const antes = new Set(vistos)
    const ahora = new Set(vistos)
    if (asignado) ahora.add(u.usuario_id)
    else ahora.delete(u.usuario_id)
    setMarcados(ahora)
    try {
      await marcar(u.usuario_id, asignado)
    } catch (e) {
      setMarcados(antes)
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-suave">
        Marcá a todos los que van a cargar este evento (administradores de la noche y encargados de depósito). Solo ellos lo ven en su lista. Se guarda al instante.
      </p>
      {error && <Aviso>{error}</Aviso>}
      {opciones.length === 0 ? (
        <Aviso tipo="info">
          Todavía no hay administradores de la noche ni encargados de depósito.{' '}
          <Link href="/usuarios" className="underline">
            Crealos desde Usuarios
          </Link>
          .
        </Aviso>
      ) : (
        <ul className="divide-y divide-borde rounded-lg border border-borde">
          {opciones.map((u) => (
            <li key={u.usuario_id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-realce">
                <input
                  type="checkbox"
                  className="size-5 accent-zinc-300"
                  checked={vistos.has(u.usuario_id)}
                  onChange={(e) => alternar(u, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className={u.perfil_activo ? 'block truncate font-medium' : 'block truncate text-suave line-through'}>{u.nombre}</span>
                  <span className="block truncate text-xs text-suave">
                    {u.rol}
                    {!u.perfil_activo && ' · desactivado'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-suave">
        {vistos.size} {vistos.size === 1 ? 'encargado asignado' : 'encargados asignados'}. Las administradoras ya ven todos los eventos.
      </p>
    </div>
  )
}
