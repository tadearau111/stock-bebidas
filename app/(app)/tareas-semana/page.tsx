'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useId, useMemo, useState, type FormEvent } from 'react'
import { BotonesExportar } from '@/components/Exportar'
import { Aviso, Boton, Campo, Cargando, Tarjeta, Ventana, cx } from '@/components/ui'
import { armarLibro, encadenarMeses, resumirPorMes, textoHoras, type MovimientoManual } from '@/lib/calculos/cajaFuerte'
import { moverSemanas, nombresUsados, resumirSemana } from '@/lib/calculos/tareas'
import { useBorrarMovimientoCajaFuerte, useCajaFuerte, useCierres, useMovimientoCajaFuerte } from '@/lib/cajaFuerte'
import { reporteTareasSemana } from '@/lib/exportar/reportes'
import { formatoFechaEvento, formatoPesos, hoyISO, leerPrecio, mensajeError } from '@/lib/formato'
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
  const { data, isPending, error } = useCajaFuerte(permitido)
  const { data: cierres } = useCierres(permitido)
  const [edicion, setEdicion] = useState<{ pago?: MovimientoManual; dia?: string } | null>(null)

  const diaParam = params.get('dia')
  const diaElegido = diaParam && /^\d{4}-\d{2}-\d{2}$/.test(diaParam) ? diaParam : hoyISO()
  const semana = useMemo(() => (data ? resumirSemana(data.manuales, aFecha(diaElegido)) : null), [data, diaElegido])
  const nombres = useMemo(() => (data ? nombresUsados(data.manuales) : []), [data])
  const saldo = useMemo(
    () => (data && cierres ? encadenarMeses(resumirPorMes(armarLibro(data.eventos, data.manuales)), cierres).saldoActual : null),
    [data, cierres],
  )

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

      {isPending || !semana ? (
        error ? <Aviso>{mensajeError(error)}</Aviso> : <Cargando />
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
