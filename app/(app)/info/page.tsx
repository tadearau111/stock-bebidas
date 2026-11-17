'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Ventana, cx } from '@/components/ui'
import { agruparNotas, limpiarPersonal, personalInicial, personalParaEditar, totalPersonal, type PersonalNota } from '@/lib/calculos/info'
import { useEventos } from '@/lib/eventos'
import { formatoFechaEvento, hoyISO, mensajeError } from '@/lib/formato'
import { useBorrarNota, useGuardarNota, useNotasInfo } from '@/lib/info'
import { useSesion } from '@/lib/sesion'
import type { NotaInfo } from '@/lib/tipos'

const hora = (h: string | null) => (h ? h.slice(0, 5) : null)

export default function PaginaInfo() {
  const { puede } = useSesion()
  const puedeEditar = puede('info.editar')
  const { data: notas, isPending, error } = useNotasInfo()
  const [editando, setEditando] = useState<NotaInfo | 'nueva' | null>(null)
  const [verPasadas, setVerPasadas] = useState(false)

  if (!puede('info.ver') && !puedeEditar) return <Aviso>No tenés permiso para ver Info.</Aviso>

  const g = agruparNotas(notas ?? [])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Info</h1>
          <p className="text-sm text-suave">Lo que hay que tener en cuenta para los próximos eventos.</p>
        </div>
        {puedeEditar && (
          <Boton className="shrink-0 whitespace-nowrap" onClick={() => setEditando('nueva')}>
            + Nota
          </Boton>
        )}
      </div>

      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : (
        <>
          <Grupo titulo="Esta semana" vacio="No hay notas para esta semana." notas={g.semana} puedeEditar={puedeEditar} editar={setEditando} />
          <Grupo titulo="Próximas" vacio="No hay notas para más adelante." notas={g.proximas} puedeEditar={puedeEditar} editar={setEditando} />
          {g.pasadas.length > 0 && (
            <div>
              <button onClick={() => setVerPasadas((v) => !v)} className="text-sm text-marca-700 underline">
                {verPasadas ? 'Ocultar notas pasadas' : `Ver notas pasadas (${g.pasadas.length})`}
              </button>
              {verPasadas && (
                <div className="mt-3">
                  <Grupo titulo="Pasadas" notas={g.pasadas} puedeEditar={puedeEditar} editar={setEditando} apagado />
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Ventana abierta={!!editando} alCerrar={() => setEditando(null)} titulo={editando === 'nueva' ? 'Nueva nota' : 'Editar nota'}>
        {editando && <FormNota nota={editando === 'nueva' ? undefined : editando} alTerminar={() => setEditando(null)} />}
      </Ventana>
    </div>
  )
}

function Grupo({
  titulo,
  vacio,
  notas,
  puedeEditar,
  editar,
  apagado,
}: {
  titulo: string
  vacio?: string
  notas: NotaInfo[]
  puedeEditar: boolean
  editar: (n: NotaInfo) => void
  apagado?: boolean
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {notas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-borde px-3 py-4 text-center text-sm text-suave">{vacio}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {notas.map((n) => (
            <Nota key={n.id} nota={n} puedeEditar={puedeEditar} editar={() => editar(n)} apagado={apagado} />
          ))}
        </div>
      )}
    </section>
  )
}

function Nota({ nota: n, puedeEditar, editar, apagado }: { nota: NotaInfo; puedeEditar: boolean; editar: () => void; apagado?: boolean }) {
  const total = totalPersonal(n.personal)
  return (
    <Tarjeta className={cx('space-y-3 p-4', apagado && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-suave">
            {formatoFechaEvento(n.fecha)} {n.fecha === hoyISO() && <Etiqueta color="verde">Hoy</Etiqueta>}
          </p>
          <h3 className="text-lg font-semibold">{n.titulo}</h3>
          {n.evento_id && n.evento && (
            <Link href={`/evento?id=${n.evento_id}`} className="text-sm text-marca-700 underline">
              Ver evento: {n.evento.nombre}
            </Link>
          )}
        </div>
        {puedeEditar && (
          <button onClick={editar} className="shrink-0 rounded-lg px-2 py-1 text-sm text-suave underline hover:text-tinta">
            Editar
          </button>
        )}
      </div>

      {(n.hora_apertura || n.hora_cierre) && (
        <div className="flex gap-2">
          {n.hora_apertura && <Dato titulo="Apertura" valor={hora(n.hora_apertura)!} />}
          {n.hora_cierre && <Dato titulo="Cierre" valor={hora(n.hora_cierre)!} />}
        </div>
      )}

      {n.personal.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-suave">Personal a convocar{total ? ` · ${total} personas` : ''}</p>
          <ul className="divide-y divide-borde rounded-lg border border-borde">
            {n.personal.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.rol}</span>
                  {p.detalle && <span className="block text-xs text-suave">{p.detalle}</span>}
                </span>
                {p.cantidad != null && <span className="tabular shrink-0 font-semibold">{p.cantidad}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {n.notas && (
        <div>
          <p className="mb-1 text-xs text-suave">A tener en cuenta</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.notas}</p>
        </div>
      )}
    </Tarjeta>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-realce px-3 py-1.5">
      <p className="text-[11px] text-suave">{titulo}</p>
      <p className="tabular font-semibold">{valor}</p>
    </div>
  )
}

// ------------------------------------------------------------------ Formulario

function FormNota({ nota, alTerminar }: { nota?: NotaInfo; alTerminar: () => void }) {
  const guardar = useGuardarNota()
  const borrar = useBorrarNota()
  const { data: eventos } = useEventos()
  const [fecha, setFecha] = useState(nota?.fecha ?? hoyISO())
  const [eventoId, setEventoId] = useState(nota?.evento_id ?? '')
  const [titulo, setTitulo] = useState(nota?.titulo ?? '')
  const [apertura, setApertura] = useState(hora(nota?.hora_apertura ?? null) ?? '')
  const [cierre, setCierre] = useState(hora(nota?.hora_cierre ?? null) ?? '')
  const [personal, setPersonal] = useState<PersonalNota[]>(nota ? personalParaEditar(nota.personal) : personalInicial())
  const [notas, setNotas] = useState(nota?.notas ?? '')
  const [error, setError] = useState('')

  const proximos = (eventos ?? []).filter((e) => (e.fecha >= hoyISO() && !e.archivado) || e.id === eventoId).sort((a, b) => a.fecha.localeCompare(b.fecha))

  function elegirEvento(id: string) {
    setEventoId(id)
    const ev = eventos?.find((e) => e.id === id)
    if (ev) {
      setFecha(ev.fecha)
      if (!titulo.trim()) setTitulo(ev.nombre)
    }
  }

  const cambiarPersonal = (i: number, cambios: Partial<PersonalNota>) => setPersonal((l) => l.map((p, j) => (j === i ? { ...p, ...cambios } : p)))

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!fecha) return setError('Elegí la fecha.')
    if (!titulo.trim()) return setError('Poné un título (por ejemplo, el nombre del evento).')
    if (personal.some((p) => p.cantidad != null && (!Number.isInteger(p.cantidad) || p.cantidad < 0))) return setError('Las cantidades tienen que ser números enteros.')
    try {
      await guardar.mutateAsync({
        id: nota?.id,
        datos: {
          fecha,
          evento_id: eventoId || null,
          titulo: titulo.trim(),
          hora_apertura: apertura || null,
          hora_cierre: cierre || null,
          personal: limpiarPersonal(personal),
          notas: notas.trim() || null,
        },
      })
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function eliminar() {
    if (!nota || !confirm(`¿Borrar la nota "${nota.titulo}"? Va a la papelera durante 30 días.`)) return
    try {
      await borrar.mutateAsync(nota.id)
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {proximos.length > 0 && (
        <Selector etiqueta="Evento (opcional)" value={eventoId} onChange={(e) => elegirEvento(e.target.value)}>
          <option value="">Sin evento</option>
          {proximos.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.nombre} · {formatoFechaEvento(ev.fecha)}
            </option>
          ))}
        </Selector>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Fecha *" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <Campo etiqueta="Título *" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Casamiento Pérez" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Horario de apertura" type="time" value={apertura} onChange={(e) => setApertura(e.target.value)} />
        <Campo etiqueta="Horario de cierre" type="time" value={cierre} onChange={(e) => setCierre(e.target.value)} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Personal a convocar</p>
        {personal.map((p, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,7rem)_4.5rem_minmax(0,1fr)] items-center gap-2">
            {i < 5 ? (
              <span className="truncate text-sm">{p.rol}</span>
            ) : (
              <input
                value={p.rol}
                onChange={(e) => cambiarPersonal(i, { rol: e.target.value })}
                placeholder="Rol"
                aria-label="Rol"
                className="min-h-10 w-full rounded-lg border border-borde bg-superficie px-2 outline-none focus:border-marca-500"
              />
            )}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={p.cantidad ?? ''}
              onChange={(e) => cambiarPersonal(i, { cantidad: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="Cant."
              aria-label={`Cantidad de ${p.rol || 'personal'}`}
              className="min-h-10 w-full rounded-lg border border-borde bg-superficie px-2 text-center outline-none focus:border-marca-500"
            />
            <input
              value={p.detalle}
              onChange={(e) => cambiarPersonal(i, { detalle: e.target.value })}
              placeholder="Detalle (opcional)"
              aria-label={`Detalle de ${p.rol || 'personal'}`}
              className="min-h-10 w-full rounded-lg border border-borde bg-superficie px-2 outline-none focus:border-marca-500"
            />
          </div>
        ))}
        <button type="button" onClick={() => setPersonal((l) => [...l, { rol: '', cantidad: null, detalle: '' }])} className="text-sm text-marca-700 underline">
          + Otro rol (mozos, DJ, etc.)
        </button>
      </div>

      <div>
        <label htmlFor="notas-info" className="mb-1 block text-sm font-medium">
          A tener en cuenta
        </label>
        <textarea
          id="notas-info"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={6}
          placeholder="Escribí lo que haga falta: proveedores que llegan, pedidos especiales, recordatorios…"
          className="block w-full rounded-lg border border-borde bg-superficie px-3 py-2 outline-none focus:border-marca-500 focus:ring-2 focus:ring-marca-100"
        />
      </div>

      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={guardar.isPending}>
          {nota ? 'Guardar cambios' : 'Guardar nota'}
        </Boton>
      </div>
      {nota && (
        <Boton variante="fantasma" className="w-full text-alerta" onClick={eliminar} cargando={borrar.isPending} textoCargando="Borrando…">
          Borrar nota
        </Boton>
      )}
    </form>
  )
}
