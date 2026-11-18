'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useId, useMemo, useState, type FormEvent } from 'react'
import { BotonesExportar } from '@/components/Exportar'
import { Aviso, Boton, Campo, Cargando, Tarjeta, Ventana, cx } from '@/components/ui'
import { mesActual, nombreMes, textoHoras, type MesEncadenado, type MovimientoManual } from '@/lib/calculos/cajaFuerte'
import { moverSemanas, nombresUsados, resumirMesTareas, resumirSemana } from '@/lib/calculos/tareas'
import { useBorrarMovimientoCajaFuerte, useCadenaCajaFuerte, useMovimientoCajaFuerte } from '@/lib/cajaFuerte'
import { reporteTareasMes, reporteTareasSemana } from '@/lib/exportar/reportes'
import { formatoFechaEvento, formatoFechaHora, formatoPesos, hoyISO, leerPrecio, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'

export default function PaginaTareasSemana() {
  return (
    <Suspense fallback={<Cargando />}>
      <TareasSemana />
    </Suspense>
  )
}

const aFecha = (dia: string) => {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(a, m - 1, d)
}
const fechaCorta = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' })

function TareasSemana() {
  const { puede, local } = useSesion()
  const permitido = puede('caja_fuerte.gestionar')
  const params = useSearchParams()
  const router = useRouter()
  const ruta = usePathname()
  const { data, cadena, isPending, error } = useCadenaCajaFuerte(permitido)
  const [edicion, setEdicion] = useState<{ pago?: MovimientoManual; dia?: string } | null>(null)

  const diaParam = params.get('dia')
  const diaElegido = diaParam && /^\d{4}-\d{2}-\d{2}$/.test(diaParam) ? diaParam : hoyISO()
  const semana = useMemo(() => (data ? resumirSemana(data.manuales, aFecha(diaElegido)) : null), [data, diaElegido])
  const nombres = useMemo(() => (data ? nombresUsados(data.manuales) : []), [data])
  const saldo = cadena?.saldoActual ?? null
  const vista = params.get('vista') === 'mes' ? 'mes' : 'semana'

  if (!permitido) return <Aviso>No tenés permiso para ver los pagos de tareas.</Aviso>

  const hoy = hoyISO()
  const esEstaSemana = !!semana && hoy >= semana.desde && hoy <= semana.hasta
  const irA = (n: number) => semana && router.replace(`${ruta}?dia=${hoyOMover(semana.desde, n)}`, { scroll: false })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tareas semana</h1>
          <p className="text-sm text-suave">Pagos al personal por trabajos de la semana. Cada pago se resta solo del efectivo de la caja fuerte.</p>
        </div>
        <Boton onClick={() => setEdicion({ dia: esEstaSemana || !semana ? hoy : semana.desde })}>+ Pago</Boton>
      </div>

      {/* Por semana / Por mes */}
      <div className="flex gap-1 rounded-xl border border-borde p-1">
        {(['semana', 'mes'] as const).map((v) => (
          <button
            key={v}
            onClick={() => router.replace(v === 'mes' ? `${ruta}?vista=mes` : ruta, { scroll: false })}
            className={cx('flex-1 rounded-lg px-3 py-2 text-sm transition-colors', vista === v ? 'plata font-semibold' : 'text-suave hover:bg-realce hover:text-tinta')}
          >
            {v === 'semana' ? 'Por semana' : 'Resumen mensual'}
          </button>
        ))}
      </div>

      {isPending || !semana || !cadena ? (
        error ? <Aviso>{mensajeError(error)}</Aviso> : <Cargando />
      ) : vista === 'mes' ? (
        <VistaMes meses={cadena.meses} elegido={params.get('mes')} local={local?.local_nombre ?? ''} irA={(q) => router.replace(`${ruta}?${q}`, { scroll: false })} />
      ) : (
        <>
          {/* Elegir semana */}
          <div className="flex items-center justify-between gap-2">
            <Boton variante="secundario" onClick={() => irA(-1)} aria-label="Semana anterior">
              ‹
            </Boton>
            <div className="text-center">
              <p className="font-semibold">
                {fechaCorta.format(aFecha(semana.desde))} al {fechaCorta.format(aFecha(semana.hasta))}
              </p>
              <p className="text-xs text-suave">
                {esEstaSemana ? (
                  'Esta semana (lunes a domingo)'
                ) : (
                  <button className="text-marca-700 underline" onClick={() => router.replace(ruta, { scroll: false })}>
                    Volver a esta semana
                  </button>
                )}
              </p>
            </div>
            <Boton variante="secundario" onClick={() => irA(1)} aria-label="Semana siguiente">
              ›
            </Boton>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tarjeta className="border-marca-500 px-3 py-2.5">
              <p className="text-xs text-suave">Pagado en la semana</p>
              <p className="tabular texto-plata text-lg font-semibold">{formatoPesos(semana.total)}</p>
            </Tarjeta>
            <Tarjeta className="px-3 py-2.5">
              <p className="text-xs text-suave">Horas trabajadas</p>
              <p className="tabular text-lg font-semibold">{semana.horas ? textoHoras(semana.horas) : '—'}</p>
            </Tarjeta>
            <Tarjeta className="col-span-2 px-3 py-2.5 sm:col-span-1">
              <p className="text-xs text-suave">Queda en caja fuerte</p>
              <p className={cx('tabular text-lg font-semibold', saldo != null && saldo < 0 && 'text-alerta')}>
                {saldo == null ? '…' : formatoPesos(saldo)}
              </p>
              <Link href="/caja-fuerte" className="text-xs text-marca-700 underline">
                Ver caja fuerte
              </Link>
            </Tarjeta>
          </div>

          {semana.pagos.length === 0 ? (
            <Tarjeta className="px-4 py-8 text-center text-suave">
              No hay pagos cargados en esta semana.
              <span className="mt-1 block text-sm">Tocá “+ Pago” para anotar a quién le pagaste, qué hizo y cuánto.</span>
            </Tarjeta>
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Por persona</h2>
                  <BotonesExportar compacto crear={() => reporteTareasSemana(semana, local?.local_nombre ?? '')} />
                </div>
                <Tarjeta className="divide-y divide-borde">
                  {semana.porPersona.map((p) => (
                    <div key={p.persona} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.persona}</p>
                        <p className="text-xs text-suave">
                          {p.pagos} {p.pagos === 1 ? 'pago' : 'pagos'}
                          {p.horas ? ` · ${textoHoras(p.horas)}` : ''}
                        </p>
                      </div>
                      <p className="tabular shrink-0 font-semibold">{formatoPesos(p.total)}</p>
                    </div>
                  ))}
                </Tarjeta>
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">Día por día</h2>
                {semana.porDia.map((d) => (
                  <div key={d.dia} className="space-y-1">
                    <div className="flex items-baseline justify-between px-1 text-sm">
                      <span className="font-semibold capitalize">{formatoFechaEvento(d.dia)}</span>
                      <span className="tabular text-suave">{formatoPesos(d.total)}</span>
                    </div>
                    <Tarjeta className="divide-y divide-borde">
                      {d.pagos.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setEdicion({ pago: p })}
                          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-realce"
                        >
                          <span className="min-w-0">
                            <span className="block font-medium">{p.persona}</span>
                            <span className="block text-sm text-suave">{p.detalle}</span>
                            <span className="block text-xs text-suave">
                              {p.horas ? `${textoHoras(p.horas)} · ` : ''}
                              {p.autor ? `cargó ${p.autor} · ` : ''}
                              <span className="text-marca-700 underline">Editar</span>
                            </span>
                          </span>
                          <span className="tabular shrink-0 font-semibold text-alerta">− {formatoPesos(p.monto)}</span>
                        </button>
                      ))}
                    </Tarjeta>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}

      <Ventana abierta={!!edicion} alCerrar={() => setEdicion(null)} titulo={edicion?.pago ? 'Editar pago' : 'Nuevo pago'}>
        {edicion && (
          <FormPago
            pago={edicion.pago}
            diaInicial={edicion.dia ?? hoy}
            nombres={nombres}
            alTerminar={(dia) => {
              setEdicion(null)
              // Si el pago quedó en otra semana, se muestra esa semana
              if (dia && semana && (dia < semana.desde || dia > semana.hasta)) router.replace(`${ruta}?dia=${dia}`, { scroll: false })
            }}
          />
        )}
      </Ventana>
    </div>
  )
}

/** Resumen de un mes: lo guardado al cerrar el mes (no se borra) o, si es el mes en curso, lo de hoy. */
function VistaMes({ meses, elegido, local, irA }: { meses: MesEncadenado[]; elegido: string | null; local: string; irA: (query: string) => void }) {
  const actual = mesActual()
  // Meses con pagos (y siempre el actual)
  const tienePagos = (m: MesEncadenado) => [...m.mostrado.renglones, ...m.vivo.renglones].some((r) => r.clase === 'pago')
  const conPagos = meses.filter((m) => m.clave === actual || tienePagos(m))
  const clave = elegido && conPagos.some((m) => m.clave === elegido) ? elegido : actual
  const mes = conPagos.find((m) => m.clave === clave)
  const resumen = resumirMesTareas(mes?.mostrado.renglones ?? [])

  const porAnio = new Map<number, MesEncadenado[]>()
  for (const m of conPagos) porAnio.set(m.anio, [...(porAnio.get(m.anio) ?? []), m])

  if (!mes) return <Cargando />
  const estado = mes.guardado
    ? mes.guardado.cerrado_en ? `Guardado el ${formatoFechaHora(mes.guardado.cerrado_en)}` : 'Resumen guardado'
    : mes.clave === actual
      ? 'Mes en curso (se guarda solo al terminar el mes)'
      : 'Mes terminado'
  const desactualizado = mes.desactualizado && resumirMesTareas(mes.vivo.renglones).total !== resumen.total

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {[...porAnio.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([anio, ms]) => (
            <div key={anio} className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 shrink-0 text-sm font-semibold text-suave">{anio}</span>
              {ms.map((m) => (
                <button
                  key={m.clave}
                  onClick={() => irA(`vista=mes&mes=${m.clave}`)}
                  className={cx(
                    'rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                    m.clave === clave ? 'plata font-semibold' : 'border border-borde text-suave hover:bg-realce hover:text-tinta',
                  )}
                >
                  {nombreMes(m.mes).slice(0, 3)}
                  {m.clave === actual && <span className="ml-1 text-[10px] opacity-70">(actual)</span>}
                  {m.guardado && m.clave !== clave && <span className="ml-1 text-[10px] opacity-60">✓</span>}
                </button>
              ))}
            </div>
          ))}
        <p className="text-xs text-suave">✓ = resumen guardado. Al terminar cada mes se guarda junto con el de la caja fuerte y no se puede borrar.</p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {nombreMes(mes.mes)} {mes.anio}
          </h2>
          <p className="text-sm text-suave">{estado}</p>
        </div>
        <BotonesExportar compacto crear={() => reporteTareasMes(mes.anio, mes.mes, resumen, local, estado)} />
      </div>

      {desactualizado && (
        <Aviso tipo="info">
          Después de cerrar este mes se cambió o borró algún pago. Acá se muestra lo guardado. Para actualizarlo, entrá a la{' '}
          <Link href="/caja-fuerte" className="underline">
            Caja fuerte
          </Link>
          , elegí este mes y tocá “Actualizar el resumen guardado”.
        </Aviso>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Tarjeta className="border-marca-500 px-3 py-2.5">
          <p className="text-xs text-suave">Pagado en el mes</p>
          <p className="tabular texto-plata text-lg font-semibold">{formatoPesos(resumen.total)}</p>
        </Tarjeta>
        <Tarjeta className="px-3 py-2.5">
          <p className="text-xs text-suave">Horas trabajadas</p>
          <p className="tabular text-lg font-semibold">{resumen.horas ? textoHoras(resumen.horas) : '—'}</p>
        </Tarjeta>
      </div>

      {resumen.pagos.length === 0 ? (
        <Tarjeta className="px-4 py-8 text-center text-suave">No hay pagos cargados en este mes.</Tarjeta>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-lg font-semibold">Por persona</h3>
            <Tarjeta className="divide-y divide-borde">
              {resumen.porPersona.map((p) => (
                <div key={p.persona} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.persona}</p>
                    <p className="text-xs text-suave">
                      {p.pagos} {p.pagos === 1 ? 'pago' : 'pagos'}
                      {p.horas ? ` · ${textoHoras(p.horas)}` : ''}
                    </p>
                  </div>
                  <p className="tabular shrink-0 font-semibold">{formatoPesos(p.total)}</p>
                </div>
              ))}
            </Tarjeta>
          </section>

          <section className="space-y-2">
            <h3 className="text-lg font-semibold">Por semana</h3>
            <Tarjeta className="divide-y divide-borde">
              {resumen.porSemana.map((w) => (
                <button
                  key={w.desde}
                  onClick={() => irA(`dia=${w.desde}`)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-realce"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {fechaCorta.format(aFecha(w.desde))} al {fechaCorta.format(aFecha(w.hasta))}
                    </span>
                    <span className="block text-xs text-suave">
                      {w.pagos} {w.pagos === 1 ? 'pago' : 'pagos'}
                      {w.horas ? ` · ${textoHoras(w.horas)}` : ''} · <span className="text-marca-700 underline">Ver semana</span>
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-semibold">{formatoPesos(w.total)}</span>
                </button>
              ))}
            </Tarjeta>
          </section>

          <section className="space-y-2">
            <h3 className="text-lg font-semibold">Todos los pagos</h3>
            <Tarjeta className="divide-y divide-borde">
              {resumen.pagos.map((p, i) => (
                <div key={p.ref ?? i} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{p.persona}</p>
                    <p className="text-sm text-suave">{p.tareas}</p>
                    <p className="text-xs text-suave">
                      <span className="capitalize">{formatoFechaEvento(p.fecha.slice(0, 10))}</span>
                      {p.horas ? ` · ${textoHoras(p.horas)}` : ''}
                    </p>
                  </div>
                  <p className="tabular shrink-0 font-semibold text-alerta">− {formatoPesos(p.monto)}</p>
                </div>
              ))}
            </Tarjeta>
          </section>
        </>
      )}
    </div>
  )
}

/** Lunes de la semana a `n` semanas de `desde`, como AAAA-MM-DD. */
function hoyOMover(desde: string, n: number) {
  const d = moverSemanas(desde, n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function FormPago({
  pago,
  diaInicial,
  nombres,
  alTerminar,
}: {
  pago?: MovimientoManual
  diaInicial: string
  nombres: string[]
  alTerminar: (dia?: string) => void
}) {
  const guardar = useMovimientoCajaFuerte()
  const borrar = useBorrarMovimientoCajaFuerte()
  const listaId = useId()
  const [dia, setDia] = useState(pago ? pago.fecha.slice(0, 10) : diaInicial)
  const [persona, setPersona] = useState(pago?.persona ?? '')
  const [tareas, setTareas] = useState(pago?.detalle ?? '')
  const [horas, setHoras] = useState(pago?.horas ? String(pago.horas).replace('.', ',') : '')
  const [monto, setMonto] = useState(pago ? String(pago.monto).replace('.', ',') : '')
  const [error, setError] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return setError('Elegí el día.')
    if (!persona.trim()) return setError('Anotá a quién le pagaste.')
    if (!tareas.trim()) return setError('Anotá qué tareas hizo.')
    const h = horas.trim() ? Number(horas.trim().replace(',', '.')) : null
    if (h != null && (!Number.isFinite(h) || h <= 0 || h > 200)) return setError('Las horas tienen que ser un número mayor a 0 (por ejemplo 4 o 2,5).')
    const m = leerPrecio(monto)
    if (m == null || Number.isNaN(m) || m <= 0) return setError('Poné un monto mayor a 0.')
    try {
      await guardar.mutateAsync({
        id: pago?.id,
        tipo: 'pago',
        persona: persona.trim(),
        detalle: tareas.trim(),
        horas: h,
        monto: m,
        // Al mediodía del día elegido (así no se corre de día por la zona horaria)
        fecha: new Date(`${dia}T12:00:00`).toISOString(),
      })
      alTerminar(dia)
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function eliminar() {
    if (!pago || !confirm('¿Borrar este pago? La plata vuelve a sumarse en la caja fuerte. Va a la papelera durante 30 días.')) return
    try {
      await borrar.mutateAsync(pago.id)
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Campo etiqueta="Día" type="date" value={dia} onChange={(e) => setDia(e.target.value)} required />
      <Campo
        etiqueta="¿A quién le pagaste?"
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
        list={listaId}
        placeholder="Ej: Juan Pérez"
        autoComplete="off"
        ayuda={nombres.length ? 'Empezá a escribir y te sugiere los nombres que ya cargaste.' : undefined}
      />
      <datalist id={listaId}>
        {nombres.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <Campo etiqueta="¿Qué tareas hizo?" value={tareas} onChange={(e) => setTareas(e.target.value)} placeholder="Ej: Limpieza del salón y vidrios" />
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Horas (opcional)" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="Ej: 4" />
        <Campo etiqueta="Monto ($)" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 25.000" />
      </div>
      <p className="text-xs text-suave">El monto se resta del efectivo de la caja fuerte.</p>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex flex-wrap justify-between gap-2 pt-1">
        {pago ? (
          <Boton variante="peligro" onClick={eliminar} cargando={borrar.isPending} textoCargando="Borrando…">
            Borrar
          </Boton>
        ) : (
          <span />
        )}
        <Boton type="submit" cargando={guardar.isPending}>
          {pago ? 'Guardar cambios' : 'Guardar pago'}
        </Boton>
      </div>
    </form>
  )
}
