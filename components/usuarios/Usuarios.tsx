'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Ventana, cx } from '@/components/ui'
import { useEventos } from '@/lib/eventos'
import { eventoPasado, formatoFechaEvento, hoyISO, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'
import {
  useActivarUsuario,
  useAsignaciones,
  useCambiarClave,
  useCrearUsuario,
  useEditarUsuario,
  useMarcarEvento,
  useRoles,
  useUsuarios,
  type UsuarioLocal,
} from '@/lib/usuarios'

/** Contraseña provisoria fácil de dictar: "mesa-4821-luna" */
function claveProvisoria() {
  const palabras = ['mesa', 'barra', 'copa', 'luna', 'sol', 'hielo', 'vaso', 'fiesta', 'brindis', 'noche']
  const p = () => palabras[Math.floor(Math.random() * palabras.length)]
  return `${p()}-${Math.floor(1000 + Math.random() * 9000)}-${p()}`
}

export function ListaUsuarios() {
  const { data: usuarios, isPending, error } = useUsuarios()
  const [nuevo, setNuevo] = useState(false)
  const [elegido, setElegido] = useState<UsuarioLocal | null>(null)
  const [mensaje, setMensaje] = useState('')

  const avisar = (m: string) => {
    setMensaje(m)
    setTimeout(() => setMensaje(''), 6000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-suave">Solo vos podés crear usuarios y darles un rol.</p>
        <Boton onClick={() => setNuevo(true)}>+ Usuario</Boton>
      </div>
      {mensaje && <Aviso tipo="ok">{mensaje}</Aviso>}
      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {(usuarios ?? []).map((u) => (
            <button key={u.usuario_id} onClick={() => setElegido(u)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-realce">
              <div className="min-w-0">
                <p className={cx('truncate font-medium', !u.perfil_activo && 'text-suave line-through')}>{u.nombre}</p>
                <p className="truncate text-xs text-suave">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!u.perfil_activo && <Etiqueta color="rojo">Desactivado</Etiqueta>}
                <Etiqueta color={u.rol === 'Administrador' ? 'verde' : 'gris'}>{u.rol}</Etiqueta>
              </div>
            </button>
          ))}
        </Tarjeta>
      )}

      <Ventana abierta={nuevo} alCerrar={() => setNuevo(false)} titulo="Nuevo usuario">
        {nuevo && (
          <FormNuevoUsuario
            alTerminar={(m) => {
              setNuevo(false)
              if (m) avisar(m)
            }}
          />
        )}
      </Ventana>
      <Ventana abierta={!!elegido} alCerrar={() => setElegido(null)} titulo={elegido?.nombre ?? ''}>
        {elegido && (
          <DetalleUsuario
            usuario={(usuarios ?? []).find((u) => u.usuario_id === elegido.usuario_id) ?? elegido}
            avisar={avisar}
            cerrar={() => setElegido(null)}
          />
        )}
      </Ventana>
    </div>
  )
}

function FormNuevoUsuario({ alTerminar }: { alTerminar: (mensaje?: string) => void }) {
  const crear = useCrearUsuario()
  const { data: roles } = useRoles()
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState(claveProvisoria)
  const [rolId, setRolId] = useState('')
  const [error, setError] = useState('')
  const rolPorDefecto = roles?.find((r) => r.nombre === 'Encargado de la noche')?.id ?? ''

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const rol = rolId || rolPorDefecto
    if (!nombre.trim()) return setError('Poné el nombre.')
    if (clave.length < 8) return setError('La contraseña tiene que tener al menos 8 caracteres.')
    if (!rol) return setError('Elegí un rol.')
    try {
      await crear.mutateAsync({ nombre: nombre.trim(), email: email.trim(), clave, rol_id: rol })
      alTerminar(`Usuario creado. Pasale a ${nombre.trim()} su email (${email.trim()}) y la contraseña: ${clave}`)
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo etiqueta="Nombre *" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej: Martín Gómez" />
      <Campo etiqueta="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
      <div>
        <Campo
          etiqueta="Contraseña provisoria *"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          autoComplete="off"
          ayuda="Anotala para pasársela. Mínimo 8 caracteres."
        />
        <button type="button" onClick={() => setClave(claveProvisoria())} className="mt-1 text-sm text-marca-700 underline">
          Generar otra
        </button>
      </div>
      <Selector etiqueta="Rol *" value={rolId || rolPorDefecto} onChange={(e) => setRolId(e.target.value)}>
        {(roles ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.nombre}
          </option>
        ))}
      </Selector>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={() => alTerminar()}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={crear.isPending} textoCargando="Creando…">
          Crear usuario
        </Boton>
      </div>
    </form>
  )
}

function DetalleUsuario({ usuario: u, avisar, cerrar }: { usuario: UsuarioLocal; avisar: (m: string) => void; cerrar: () => void }) {
  const { session } = useSesion()
  const soyYo = session?.user.id === u.usuario_id
  const editar = useEditarUsuario()
  const activar = useActivarUsuario()
  const cambiarClave = useCambiarClave()
  const { data: roles } = useRoles()
  const [nombre, setNombre] = useState(u.nombre)
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const rol = roles?.find((r) => r.id === u.rol_id)
  const cargaEventos = rol?.permisos.includes('eventos.cargar') && !rol.permisos.includes('eventos.gestionar')

  async function guardarNombre() {
    setError('')
    if (!nombre.trim()) return setError('Poné el nombre.')
    try {
      await editar.mutateAsync({ usuario_id: u.usuario_id, nombre: nombre.trim() })
      avisar('Nombre actualizado.')
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function cambiarRol(rolId: string) {
    setError('')
    try {
      await editar.mutateAsync({ usuario_id: u.usuario_id, rol_id: rolId })
      avisar(`Rol cambiado a ${roles?.find((r) => r.id === rolId)?.nombre}.`)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function nuevaClave() {
    setError('')
    if (clave.length < 8) return setError('La contraseña tiene que tener al menos 8 caracteres.')
    try {
      await cambiarClave.mutateAsync({ usuario_id: u.usuario_id, clave })
      avisar(`Contraseña de ${u.nombre} cambiada a: ${clave}`)
      setClave('')
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function alternarActivo() {
    setError('')
    const activo = !u.perfil_activo
    if (!activo && !confirm(`¿Desactivar a ${u.nombre}? No va a poder entrar más. Lo que cargó queda guardado.`)) return
    try {
      await activar.mutateAsync({ usuario_id: u.usuario_id, activo })
      avisar(activo ? `${u.nombre} puede volver a entrar.` : `${u.nombre} quedó desactivado.`)
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-suave">{u.email}</p>
      {error && <Aviso>{error}</Aviso>}

      <div className="flex items-end gap-2">
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="flex-1" />
        {nombre !== u.nombre && (
          <Boton variante="secundario" onClick={guardarNombre} cargando={editar.isPending}>
            Guardar
          </Boton>
        )}
      </div>

      <Selector etiqueta="Rol" value={u.rol_id} onChange={(e) => cambiarRol(e.target.value)} disabled={editar.isPending}>
        {(roles ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.nombre}
          </option>
        ))}
      </Selector>
      {soyYo && <p className="-mt-3 text-xs text-suave">Si te sacás el rol de Administrador, la app no te deja si no queda otro.</p>}

      {cargaEventos && <EventosAsignados usuarioId={u.usuario_id} />}
      {rol?.permisos.includes('eventos.gestionar') && <p className="text-sm text-suave">Este rol ve todos los eventos (no hace falta asignarlos).</p>}

      <div className="space-y-2 rounded-xl border border-borde p-3">
        <p className="text-sm font-semibold">Cambiar contraseña</p>
        <div className="flex gap-2">
          <input
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Nueva contraseña"
            autoComplete="off"
            className="min-h-11 w-full flex-1 rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
          />
          <Boton variante="secundario" onClick={nuevaClave} cargando={cambiarClave.isPending}>
            Cambiar
          </Boton>
        </div>
        <button type="button" onClick={() => setClave(claveProvisoria())} className="text-sm text-marca-700 underline">
          Generar una
        </button>
      </div>

      {!soyYo && (
        <Boton variante={u.perfil_activo ? 'peligro' : 'secundario'} className="w-full" onClick={alternarActivo} cargando={activar.isPending}>
          {u.perfil_activo ? 'Desactivar usuario' : 'Volver a activar'}
        </Boton>
      )}
    </div>
  )
}

function EventosAsignados({ usuarioId }: { usuarioId: string }) {
  const { data: eventos } = useEventos()
  const { data: asignados } = useAsignaciones(usuarioId)
  const marcar = useMarcarEvento(usuarioId)
  const [verPasados, setVerPasados] = useState(false)
  const [error, setError] = useState('')

  const lista = useMemo(() => {
    const todos = (eventos ?? []).filter((e) => !e.archivado || asignados?.has(e.id))
    // próximos primero (del más cercano al más lejano), después los pasados
    const proximos = todos.filter((e) => e.fecha >= hoyISO()).sort((a, b) => a.fecha.localeCompare(b.fecha))
    const pasados = todos.filter((e) => eventoPasado(e.fecha))
    return verPasados ? [...proximos, ...pasados] : [...proximos, ...pasados.filter((e) => asignados?.has(e.id))]
  }, [eventos, asignados, verPasados])

  async function alternar(eventoId: string, asignado: boolean) {
    setError('')
    try {
      await marcar(eventoId, asignado)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Eventos asignados</p>
      <p className="text-xs text-suave">Solo va a ver y cargar los eventos que marques.</p>
      {error && <Aviso>{error}</Aviso>}
      <ul className="max-h-60 divide-y divide-borde overflow-y-auto rounded-lg border border-borde">
        {lista.map((e) => (
          <li key={e.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-realce">
              <input
                type="checkbox"
                className="size-5 accent-zinc-300"
                checked={!!asignados?.has(e.id)}
                onChange={(ev) => alternar(e.id, ev.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.nombre}</span>
                <span className="block text-xs text-suave">{formatoFechaEvento(e.fecha)}</span>
              </span>
            </label>
          </li>
        ))}
        {lista.length === 0 && <li className="px-3 py-3 text-sm text-suave">No hay eventos próximos.</li>}
      </ul>
      <button type="button" onClick={() => setVerPasados((v) => !v)} className="text-sm text-marca-700 underline">
        {verPasados ? 'Ocultar eventos pasados' : 'Mostrar también eventos pasados'}
      </button>
    </div>
  )
}
