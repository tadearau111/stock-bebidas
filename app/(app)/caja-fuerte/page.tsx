'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BotonesExportar } from '@/components/Exportar'
import { Aviso, Boton, Campo, Cargando, Tarjeta, Ventana, cx } from '@/components/ui'
import {
  armarLibro,
  cierreDesactualizado,
  mesActual,
  nombreMes,
  resumirPorMes,
  type MovimientoManual,
  type Renglon,
  type RenglonResumen,
} from '@/lib/calculos/cajaFuerte'
import { useBorrarMovimientoCajaFuerte, useCajaFuerte, useCierres, useGuardarCierre, useMovimientoCajaFuerte } from '@/lib/cajaFuerte'
import { reporteCajaFuerteMes } from '@/lib/exportar/reportes'
import { ahoraParaInput, formatoFechaEvento, formatoFechaHora, formatoPesos, leerPrecio, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'

type Edicion = { tipo: 'retiro' | 'ingreso'; mov?: MovimientoManual } | null

export default function PaginaCajaFuerte() {
  const { puede, local } = useSesion()
  const permitido = puede('caja_fuerte.gestionar')
  const { data, isPending, error } = useCajaFuerte(permitido)
  const { data: cierres } = useCierres(permitido)
  const guardarCierre = useGuardarCierre()
  const [edicion, setEdicion] = useState<Edicion>(null)
  const [elegido, setElegido] = useState<string | null>(null)
  const [verActual, setVerActual] = useState(false)
  const [aviso, setAviso] = useState('')
  const intentados = useRef(new Set<string>())

  const libro = useMemo(() => (data ? armarLibro(data.eventos, data.manuales) : null), [data])
  const meses = useMemo(() => (libro ? resumirPorMes(libro) : []), [libro])
  const actual = mesActual()

  // Pestañas: los meses calculados + los que solo quedan guardados en un cierre
  const claves = useMemo(() => {
    const set = new Set(meses.map((m) => m.clave))
    for (const c of cierres ?? []) set.add(`${c.anio}-${String(c.mes).padStart(2, '0')}`)
    return [...set].sort()
  }, [meses, cierres])
  const cierreDe = (clave: string) => cierres?.find((c) => `${c.anio}-${String(c.mes).padStart(2, '0')}` === clave)

  // Cuando un mes terminó y todavía no tiene su resumen guardado, se guarda solo
  useEffect(() => {
    if (!cierres || !meses.length) return
    for (const m of meses) {
      if (m.clave >= actual || cierreDe(m.clave) || intentados.current.has(m.clave)) continue
      intentados.current.add(m.clave)
      guardarCierre.mutate({ resumen: m })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cierres, meses, actual])

  if (!permitido) return <Aviso>No tenés permiso para ver la caja fuerte.</Aviso>

  const clave = elegido && claves.includes(elegido) ? elegido : actual
  const enVivo = meses.find((m) => m.clave === clave) ?? null
  const cierre = cierreDe(clave)
  const desactualizado = !!(cierre && enVivo && cierreDesactualizado(cierre, enVivo))
  // Lo que se muestra: el resumen guardado (si el mes ya cerró) o lo calculado
  const mostrado = cierre && !verActual ? { ...cierre, clave } : enVivo
  const [anioSel, mesSel] = clave.split('-').map(Number)

  const porAnio = new Map<number, string[]>()
  for (const c of claves) {
    const a = Number(c.slice(0, 4))
    porAnio.set(a, [...(porAnio.get(a) ?? []), c])
  }

  async function actualizarCierre() {
    if (!enVivo || !cierre) return
    if (!confirm('¿Actualizar el resumen guardado de este mes con los números de hoy? El valor anterior queda en el Historial.')) return
    try {
      await guardarCierre.mutateAsync({ resumen: enVivo, id: cierre.id })
      setVerActual(false)
      setAviso('Resumen del mes actualizado.')
      setTimeout(() => setAviso(''), 4000)
    } catch (e) {
      setAviso(mensajeError(e))
    }
  }

  const estado = cierre ? `Cerrado el ${formatoFechaHora(cierre.cerrado_en)}` : clave === actual ? 'Mes en curso' : 'Mes terminado'

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
            <p className="text-sm text-suave">Saldo actual en caja fuerte</p>
            <p className={cx('tabular text-4xl font-semibold', libro.saldo < 0 ? 'text-alerta' : 'texto-plata')}>{formatoPesos(libro.saldo)}</p>
          </Tarjeta>

          {/* Pestañas por año y mes */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Resúmenes mensuales</h2>
            <div className="space-y-2">
              {[...porAnio.entries()]
                .sort((a, b) => b[0] - a[0])
                .map(([anio, cs]) => (
                  <div key={anio} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 shrink-0 text-sm font-semibold text-suave">{anio}</span>
                    {cs.map((c) => {
                      const m = Number(c.slice(5, 7))
                      return (
                        <button
                          key={c}
                          onClick={() => {
                            setElegido(c)
                            setVerActual(false)
                          }}
                          className={cx(
                            'rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                            c === clave ? 'plata font-semibold' : 'border border-borde text-suave hover:bg-realce hover:text-tinta',
                          )}
                        >
                          {nombreMes(m).slice(0, 3)}
                          {c === actual && <span className="ml-1 text-[10px] opacity-70">(actual)</span>}
                          {cierreDe(c) && c !== clave && <span className="ml-1 text-[10px] opacity-60">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
            </div>
            <p className="text-xs text-suave">✓ = resumen guardado. Los resúmenes guardados no se pueden borrar.</p>
          </section>

          {/* Mes elegido */}
          {mostrado && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    {nombreMes(mesSel)} {anioSel}
                  </h2>
                  <p className="text-sm text-suave">{estado}</p>
                </div>
                <BotonesExportar compacto crear={() => reporteCajaFuerteMes(mostrado, local?.local_nombre ?? '', estado)} />
              </div>

              {desactualizado && (
                <Aviso tipo="info">
                  Después de cerrar este mes hubo cambios (por ejemplo, se corrigió la caja de un evento o se borró un movimiento). Lo guardado cierra
                  con <b>{formatoPesos(cierre!.saldo_final)}</b>; con los datos de hoy daría <b>{formatoPesos(enVivo!.saldo_final)}</b>.
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Boton variante="secundario" className="min-h-9 text-xs" onClick={() => setVerActual((v) => !v)}>
                      {verActual ? 'Ver lo guardado' : 'Ver cómo da hoy'}
                    </Boton>
                    <Boton className="min-h-9 text-xs" onClick={actualizarCierre} cargando={guardarCierre.isPending}>
                      Actualizar el resumen guardado
                    </Boton>
                  </span>
                </Aviso>
              )}
              {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Total titulo="Saldo al empezar el mes" valor={mostrado.saldo_inicial} />
                <Total titulo="Efectivo de eventos" valor={mostrado.efectivo} signo="+" />
                <Total titulo="Gastos de eventos" valor={mostrado.gastos} signo="−" />
                <Total titulo="Retiros" valor={mostrado.retiros} signo="−" />
                <Total titulo="Ingresos manuales" valor={mostrado.ingresos} signo="+" />
                <Total titulo={clave === actual ? 'Saldo hasta hoy' : 'Saldo al cierre del mes'} valor={mostrado.saldo_final} destacado />
              </div>

              {mostrado.renglones.length === 0 ? (
                <Tarjeta className="px-4 py-8 text-center text-suave">
                  Sin movimientos en este mes.
                  {libro.renglones.length === 0 && (
                    <span className="mt-1 block text-sm">
                      Se suman solos cuando cargás la Caja de un evento. Si ya hay plata en la caja fuerte, cargala con “+ Ingreso” (por ejemplo, “Saldo
                      inicial”).
                    </span>
                  )}
                </Tarjeta>
              ) : cierre && !verActual ? (
                <Tarjeta className="divide-y divide-borde">
                  {[...mostrado.renglones].reverse().map((r, i) => (
                    <FilaGuardada key={i} r={r} />
                  ))}
                </Tarjeta>
              ) : (
                <Tarjeta className="divide-y divide-borde">
                  {[...libro.renglones]
                    .filter((r) => r.fecha.slice(0, 7) === clave)
                    .reverse()
                    .map((r) => (
                      <Fila key={r.clave} r={r} editar={(mov) => setEdicion({ tipo: mov.tipo, mov })} />
                    ))}
                </Tarjeta>
              )}
            </section>
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

/** Renglón de un resumen guardado (no se edita: es el registro del mes). */
function FilaGuardada({ r }: { r: RenglonResumen }) {
  const fecha = r.fecha.length === 10 ? formatoFechaEvento(r.fecha) : formatoFechaHora(r.fecha)
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">
          {r.titulo}
          {r.clase !== 'efectivo' && r.clase !== 'gastos' ? <span className="font-normal">: {r.detalle}</span> : null}
        </p>
        <p className="text-xs text-suave">
          {r.clase === 'efectivo' || r.clase === 'gastos' ? `${r.detalle} · ` : ''}
          {fecha}
        </p>
        <DetalleGastos items={r.items} />
      </div>
      <Monto monto={r.monto} saldo={r.saldo} />
    </div>
  )
}

function DetalleGastos({ items }: { items?: { detalle: string; monto: number }[] }) {
  if (!items?.length) return null
  return (
    <ul className="mt-1.5 space-y-0.5 border-l border-borde pl-2.5 text-xs text-suave">
      {items.map((g, i) => (
        <li key={i} className="tabular">
          {g.detalle}: {formatoPesos(g.monto)}
        </li>
      ))}
    </ul>
  )
}

function Monto({ monto, saldo }: { monto: number; saldo: number }) {
  const positivo = monto >= 0
  return (
    <div className="shrink-0 text-right">
      <p className={cx('tabular font-semibold', positivo ? 'text-emerald-400' : 'text-alerta')}>
        {positivo ? '+' : '−'} {formatoPesos(Math.abs(monto))}
      </p>
      <p className="tabular text-xs text-suave">Saldo {formatoPesos(saldo)}</p>
    </div>
  )
}

function Total({ titulo, valor, signo, destacado }: { titulo: string; valor: number; signo?: '+' | '−'; destacado?: boolean }) {
  return (
    <Tarjeta className={cx('px-3 py-2.5', destacado && 'border-marca-500')}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', destacado && 'texto-plata')}>
        {signo && <span className="text-suave">{signo} </span>}
        {formatoPesos(valor)}
      </p>
    </Tarjeta>
  )
}

function Fila({ r, editar }: { r: Renglon; editar: (m: MovimientoManual) => void }) {
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
        {r.clase === 'gastos' && <DetalleGastos items={r.evento.gastos_detalle} />}
      </div>
      <Monto monto={r.monto} saldo={r.saldo} />
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
