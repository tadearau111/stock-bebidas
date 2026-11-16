'use client'

import { useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Cargando, Etiqueta, Tarjeta, Ventana } from '@/components/ui'
import { mensajeError } from '@/lib/formato'
import { useBorrarRol, useCambiarPermiso, useGuardarRol, usePermisosDisponibles, useRoles, type Rol } from '@/lib/usuarios'

export function RolesYPermisos() {
  const { data: roles, isPending } = useRoles()
  const { data: permisos } = usePermisosDisponibles()
  const cambiar = useCambiarPermiso()
  const borrar = useBorrarRol()
  const [editando, setEditando] = useState<Rol | 'nuevo' | null>(null)
  const [error, setError] = useState('')

  const grupos = [...new Set((permisos ?? []).map((p) => p.grupo))]

  async function alternar(rol: Rol, codigo: string, activo: boolean) {
    setError('')
    try {
      await cambiar.mutateAsync({ rolId: rol.id, codigo, activo })
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function borrarRol(rol: Rol) {
    if (!confirm(`¿Borrar el rol "${rol.nombre}"?`)) return
    setError('')
    try {
      await borrar.mutateAsync(rol.id)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  if (isPending) return <Cargando />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-suave">Marcá qué puede hacer cada rol. Los cambios se aplican al instante.</p>
        <Boton variante="secundario" className="shrink-0" onClick={() => setEditando('nuevo')}>
          + Rol
        </Boton>
      </div>
      {error && <Aviso>{error}</Aviso>}

      {(roles ?? []).map((rol) => {
        const esAdmin = rol.nombre === 'Administrador'
        return (
          <Tarjeta key={rol.id} className="p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  {rol.nombre} {rol.es_sistema && <Etiqueta>del sistema</Etiqueta>}
                </p>
                {rol.descripcion && <p className="text-sm text-suave">{rol.descripcion}</p>}
              </div>
              {!rol.es_sistema && (
                <div className="flex shrink-0 gap-3 text-sm">
                  <button onClick={() => setEditando(rol)} className="text-suave underline hover:text-tinta">
                    Editar
                  </button>
                  <button onClick={() => borrarRol(rol)} className="text-alerta/80 underline hover:text-alerta">
                    Borrar
                  </button>
                </div>
              )}
            </div>
            {esAdmin && <p className="mb-2 text-xs text-suave">El Administrador siempre tiene todos los permisos.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {grupos.map((g) => (
                <div key={g}>
                  <p className="mb-1 text-xs uppercase tracking-wide text-suave">{g}</p>
                  <ul className="space-y-1">
                    {(permisos ?? [])
                      .filter((p) => p.grupo === g)
                      .map((p) => {
                        const tiene = rol.permisos.includes(p.codigo)
                        return (
                          <li key={p.codigo}>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-realce">
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 shrink-0 accent-zinc-300"
                                checked={tiene}
                                disabled={esAdmin || cambiar.isPending}
                                onChange={(e) => alternar(rol, p.codigo, e.target.checked)}
                              />
                              <span className={tiene ? '' : 'text-suave'}>{p.descripcion}</span>
                            </label>
                          </li>
                        )
                      })}
                  </ul>
                </div>
              ))}
            </div>
          </Tarjeta>
        )
      })}

      <Ventana abierta={!!editando} alCerrar={() => setEditando(null)} titulo={editando === 'nuevo' ? 'Nuevo rol' : 'Editar rol'}>
        {editando && <FormRol rol={editando === 'nuevo' ? undefined : editando} alTerminar={() => setEditando(null)} />}
      </Ventana>
    </div>
  )
}

function FormRol({ rol, alTerminar }: { rol?: Rol; alTerminar: () => void }) {
  const guardar = useGuardarRol()
  const [nombre, setNombre] = useState(rol?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? '')
  const [error, setError] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return setError('Poné un nombre.')
    try {
      await guardar.mutateAsync({ id: rol?.id, nombre: nombre.trim(), descripcion: descripcion.trim() || null })
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo etiqueta="Nombre del rol *" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej: Encargado de depósito" />
      <Campo etiqueta="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Solo carga ingresos" />
      {!rol && <Aviso tipo="info">Después de crearlo, marcá sus permisos en la lista.</Aviso>}
      {error && <Aviso>{error}</Aviso>}
      <Boton type="submit" className="w-full" cargando={guardar.isPending}>
        {rol ? 'Guardar' : 'Crear rol'}
      </Boton>
    </form>
  )
}
