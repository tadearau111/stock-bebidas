'use client'

import Link from 'next/link'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Aviso, Boton, Campo, Cargando, Tarjeta, Ventana, cx } from '@/components/ui'
import { armarLibro, type MovimientoManual, type Renglon } from '@/lib/calculos/cajaFuerte'
import { useBorrarMovimientoCajaFuerte, useCajaFuerte, useMovimientoCajaFuerte } from '@/lib/cajaFuerte'
import { ahoraParaInput, formatoFechaEvento, formatoFechaHora, formatoPesos, leerPrecio, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'

type Edicion = { tipo: 'retiro' | 'ingreso'; mov?: MovimientoManual } | null

export default function PaginaCajaFuerte() {
  const { puede } = useSesion()
  const permitido = puede('caja_fuerte.gestionar')
  const { data, isPending, error } = useCajaFuerte(permitido)
  const [edicion, setEdicion] = useState<Edicion>(null)

  const libro = useMemo(() => (data ? armarLibro(data.eventos, data.manuales) : null), [data])

  if (!permitido) return <Aviso>No tenés permiso para ver la caja fuerte.</Aviso>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Caja fuerte</h1>
          <p className="text-sm text-suave">Se actualiza sola con el efectivo y los gastos de cada evento.</p>
        </div>
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={() => setEdicion({ tipo: 'ingreso' })}>
            + Ingreso
          </Boton>
          <Boton onClick={() => setEdicion({ tipo: 'retiro' })}>− Retiro</Boton>
        </div>
      </div>

      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : libro ? (
        <>
          <Tarjeta className="border-marca-500 px-5 py-4">
            <p className="text-sm text-suave">Saldo en caja fuerte</p>
            <p className={cx('tabular text-4xl font-semibold', libro.saldo < 0 ? 'text-alerta' : 'texto-plata')}>{formatoPesos(libro.saldo)}</p>
          </Tarjeta>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Total titulo="Efectivo de eventos" valor={libro.totalEfectivo} signo="+" />
            <Total titulo="Gastos de eventos" valor={libro.totalGastos} signo="−" />
            <Total titulo="Retiros" valor={libro.totalRetiros} signo="−" />
            <Total titulo="Ingresos manuales" valor={libro.totalIngresos} signo="+" />
          </div>

          {libro.renglones.length === 0 ? (
            <Tarjeta className="px-4 py-10 text-center text-suave">
              Todavía no hay movimientos. Se suman solos cuando cargás la Caja de un evento. Si ya hay plata en la caja fuerte, cargala con “+ Ingreso”
              (por ejemplo, “Saldo inicial”).
            </Tarjeta>
          ) : (
            <Tarjeta className="divide-y divide-borde">
              {[...libro.renglones].reverse().map((r) => (
                <Fila key={r.clave} r={r} editar={(mov) => setEdicion({ tipo: mov.tipo, mov })} />
              ))}
            </Tarjeta>
          )}
        </>
      ) : null}

      <Ventana
        abierta={!!edicion}
        alCerrar={() => setEdicion(null)}
        titulo={edicion?.mov ? 'Editar movimiento' : edicion?.tipo === 'retiro' ? 'Retiro de caja fuerte' : 'Ingreso a caja fuerte'}
      >
        {edicion && <FormMovimiento tipo={edicion.tipo} mov={edicion.mov} alTerminar={() => setEdicion(null)} />}
      </Ventana>
    </div>
  )
}

function Total({ titulo, valor, signo }: { titulo: string; valor: number; signo: '+' | '−' }) {
  return (
    <Tarjeta className="px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className="tabular text-lg font-semibold">
        <span className="text-suave">{signo}</span> {formatoPesos(valor)}
      </p>
    </Tarjeta>
  )
}

function Fila({ r, editar }: { r: Renglon; editar: (m: MovimientoManual) => void }) {
  const positivo = r.monto >= 0
  let titulo: ReactNode
  let sub: ReactNode
  if (r.clase === 'efectivo' || r.clase === 'gastos') {
    titulo = r.clase === 'efectivo' ? 'Efectivo real' : 'Gastos'
    sub = (
      <>
        <Link href={`/evento?id=${r.evento.evento_id}&p=caja`} className="text-marca-700 underline">
          {r.evento.nombre}
        </Link>{' '}
        · {formatoFechaEvento(r.evento.fecha)}
      </>
    )
  } else {
    titulo = (
      <>
        {r.clase === 'retiro' ? 'Retiro' : 'Ingreso'}: <span className="font-normal">{r.mov.detalle}</span>
      </>
    )
    sub = (
      <>
        {formatoFechaHora(r.mov.fecha)}
        {r.mov.autor ? ` · cargó ${r.mov.autor}` : ''} ·{' '}
        <button onClick={() => editar(r.mov)} className="text-marca-700 underline">
          Editar
        </button>
      </>
    )
  }
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{titulo}</p>
        <p className="text-xs text-suave">{sub}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cx('tabular font-semibold', positivo ? 'text-emerald-400' : 'text-alerta')}>
          {positivo ? '+' : '−'} {formatoPesos(Math.abs(r.monto))}
        </p>
        <p className="tabular text-xs text-suave">Saldo {formatoPesos(r.saldo)}</p>
      </div>
    </div>
  )
}

function FormMovimiento({ tipo, mov, alTerminar }: { tipo: 'retiro' | 'ingreso'; mov?: MovimientoManual; alTerminar: () => void }) {
  const guardar = useMovimientoCajaFuerte()
  const borrar = useBorrarMovimientoCajaFuerte()
  const [monto, setMonto] = useState(mov ? String(mov.monto).replace('.', ',') : '')
  const [detalle, setDetalle] = useState(mov?.detalle ?? '')
  const [fecha, setFecha] = useState(mov ? mov.fecha.slice(0, 16) : ahoraParaInput())
  const [error, setError] = useState('')
  const esRetiro = tipo === 'retiro'

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const m = leerPrecio(monto)
    if (m == null || Number.isNaN(m) || m <= 0) return setError('Poné un monto mayor a 0.')
    if (!detalle.trim()) return setError(esRetiro ? 'Anotá quién retiró o para qué fue.' : 'Anotá de dónde viene la plata.')
    try {
      await guardar.mutateAsync({ id: mov?.id, tipo, monto: m, detalle: detalle.trim(), fecha: new Date(fecha).toISOString() })
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function eliminar() {
    if (!mov || !confirm('¿Borrar este movimiento? Va a la papelera durante 30 días.')) return
    try {
      await borrar.mutateAsync(mov.id)
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-suave">
        {esRetiro
          ? 'Se resta del saldo. Por ejemplo: quién retiró plata, o gastos del salón que no son de un evento.'
          : 'Se suma al saldo. Por ejemplo: la plata que ya había en la caja fuerte al empezar.'}
      </p>
      <Campo etiqueta="Monto *" inputMode="decimal" placeholder="$ 0" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
      <Campo
        etiqueta="Detalle *"
        value={detalle}
        onChange={(e) => setDetalle(e.target.value)}
        placeholder={esRetiro ? 'Ej: Retiró Laura para pagar a Distribuidora Norte' : 'Ej: Saldo inicial'}
      />
      <Campo etiqueta="Fecha y hora" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={guardar.isPending}>
          {mov ? 'Guardar cambios' : esRetiro ? 'Registrar retiro' : 'Registrar ingreso'}
        </Boton>
      </div>
      {mov && (
        <Boton variante="fantasma" className="w-full text-alerta" onClick={eliminar} cargando={borrar.isPending} textoCargando="Borrando…">
          Borrar movimiento
        </Boton>
      )}
    </form>
  )
}
