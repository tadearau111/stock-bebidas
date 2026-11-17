'use client'

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Aviso, Boton, Campo, Tarjeta, cx } from '@/components/ui'
import { CAJA_VACIA, calcularCaja, textoDiferencia, type DatosCaja } from '@/lib/calculos/caja'
import { ejecutar, useCambioEvento } from '@/lib/eventos'
import { ahoraParaInput, formatoFechaHora, formatoHora, formatoPesos, leerPrecio, mensajeError } from '@/lib/formato'
import { mandarAPapelera } from '@/lib/papelera'
import { useLocalId } from '@/lib/sesion'
import type { DetalleEvento, GastoDB } from '@/lib/tipos'

type CampoCaja = keyof DatosCaja
type Textos = Record<CampoCaja, string>

const miles = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
/** 100000 → "100.000", 3500.5 → "3.500,5" (se vuelve a leer bien al guardar) */
const aTexto = (v: number | null) => (v == null ? '' : miles.format(v))

export function PestanaCaja({ detalle }: { detalle: DetalleEvento }) {
  const eventoId = detalle.evento.id
  const localId = useLocalId()
  const cambio = useCambioEvento(eventoId)
  const guardada = detalle.caja ?? null
  const inicial = useMemo(() => {
    const base = guardada ?? CAJA_VACIA
    return Object.fromEntries(Object.keys(CAJA_VACIA).map((k) => [k, aTexto(base[k as CampoCaja])])) as Textos
  }, [guardada])
  const [textos, setTextos] = useState<Textos>(inicial)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  // Valores numéricos a partir de lo que se está escribiendo (los cálculos se ven al instante)
  const valores = useMemo(() => {
    const v = {} as DatosCaja
    for (const k of Object.keys(CAJA_VACIA) as CampoCaja[]) {
      const n = k === 'vasos_no_devueltos' ? (textos[k].trim() === '' ? null : Number(textos[k])) : leerPrecio(textos[k])
      v[k] = n
    }
    return v
  }, [textos])
  const invalidos = (Object.keys(valores) as CampoCaja[]).filter((k) => valores[k] != null && (Number.isNaN(valores[k]) || (valores[k] as number) < 0))
  const r = calcularCaja(
    Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, Number.isNaN(v) ? null : v])) as unknown as DatosCaja,
    detalle.gastos,
  )
  const hayCambios = (Object.keys(textos) as CampoCaja[]).some((k) => textos[k] !== inicial[k])

  const cambiar = (k: CampoCaja) => (e: { target: { value: string } }) => {
    setOk('')
    setTextos((t) => ({ ...t, [k]: e.target.value }))
  }

  async function guardar(e?: FormEvent) {
    e?.preventDefault()
    setError('')
    if (invalidos.length) return setError('Hay montos que no son válidos. Usá solo números (ej: 125.000 o 125000,50).')
    if (valores.vasos_no_devueltos != null && !Number.isInteger(valores.vasos_no_devueltos)) return setError('Los vasos no devueltos tienen que ser un número entero.')
    try {
      await cambio.mutateAsync((sb) =>
        ejecutar(sb.from('evento_caja').upsert({ evento_id: eventoId, local_id: localId, ...valores }, { onConflict: 'evento_id' }).select('evento_id').single()),
      )
      setOk('Caja guardada.')
      setTimeout(() => setOk(''), 4000)
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  const campo = (k: CampoCaja, etiqueta: string, ayuda?: string) => (
    <Campo
      etiqueta={etiqueta}
      inputMode={k === 'vasos_no_devueltos' ? 'numeric' : 'decimal'}
      placeholder={k === 'vasos_no_devueltos' ? '0' : '$ 0'}
      value={textos[k]}
      onChange={cambiar(k)}
      error={invalidos.includes(k) ? 'Monto inválido' : undefined}
      ayuda={ayuda}
    />
  )

  return (
    <form onSubmit={guardar} className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Caja</h2>
          <p className="text-sm text-suave">Ingresos de barras, boletería y guardarropas, y gastos de la noche.</p>
          {guardada && <p className="text-xs text-suave">Última modificación: {formatoFechaHora(guardada.actualizado_en)}</p>}
        </div>
      </div>

      {/* Totales principales */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Total titulo="Venta total caja (barras)" valor={formatoPesos(r.ventaCaja)} />
        <Total titulo="Gastos totales" valor={formatoPesos(r.totalGastos)} />
        <Total titulo="Venta total + boletería + guardarropas" valor={formatoPesos(r.ventaTotalGeneral)} destacado />
      </div>

      <Bloque titulo="Barras" ayuda="Efectivo y tarjetas reales contra lo que dice el sistema de venta.">
        <div className="grid grid-cols-2 gap-3">
          {campo('efectivo_real', 'Efectivo real', 'Lo que hay en la caja')}
          {campo('efectivo_sistema', 'Efectivo sistema', 'Según el sistema de venta')}
          {campo('cierre_lotes', 'Cierre de lotes', 'Lo que dicen los posnet')}
          {campo('tarjetas_sistema', 'Tarjetas sistema', 'Según el sistema de venta')}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Diferencia titulo="Diferencia efectivo" valor={r.diferenciaEfectivo} />
          <Diferencia titulo="Diferencia tarjetas" valor={r.diferenciaTarjetas} />
          <Resultado titulo="Venta total caja" valor={formatoPesos(r.ventaCaja)} />
        </div>
      </Bloque>

      <div className="grid gap-5 md:grid-cols-2">
        <Bloque titulo="Boletería" ayuda="No pasa por el sistema de venta.">
          <div className="grid grid-cols-2 gap-3">
            {campo('boleteria_efectivo', 'Efectivo real')}
            {campo('boleteria_lotes', 'Cierre de lotes')}
          </div>
          <Resultado titulo="Total boletería" valor={formatoPesos(r.totalBoleteria)} />
        </Bloque>
        <Bloque titulo="Guardarropas" ayuda="No pasa por el sistema de venta.">
          <div className="grid grid-cols-2 gap-3">
            {campo('guardarropas_efectivo', 'Efectivo real')}
            {campo('guardarropas_lotes', 'Cierre de lotes')}
          </div>
          <Resultado titulo="Total guardarropas" valor={formatoPesos(r.totalGuardarropas)} />
        </Bloque>
      </div>

      <Gastos gastos={detalle.gastos} eventoId={eventoId} total={r.totalGastos} />

      <Bloque titulo="Cierre de caja">
        <div className="grid grid-cols-2 gap-3">
          {campo('cambio_proxima_caja', 'Cambio disponible próxima caja', 'Efectivo que queda para el próximo evento')}
          {campo('vasos_no_devueltos', 'Vasos no devueltos', 'Cantidad')}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Resultado
            titulo="Retiro a caja fuerte"
            valor={formatoPesos(r.retiroCajaFuerte)}
            detalle={`Efectivo total ${formatoPesos(r.efectivoTotal)} − gastos ${formatoPesos(r.totalGastos)} − cambio ${formatoPesos(valores.cambio_proxima_caja || 0)}`}
            rojo={r.retiroCajaFuerte < 0}
          />
          <Resultado titulo="Venta total + boletería + guardarropas" valor={formatoPesos(r.ventaTotalGeneral)} />
        </div>
      </Bloque>

      {error && <Aviso>{error}</Aviso>}
      {ok && <Aviso tipo="ok">✓ {ok}</Aviso>}

      {/* Botón fijo para guardar mientras se carga */}
      <div className={cx('sticky bottom-20 z-[5] md:bottom-4', !hayCambios && !cambio.isPending && 'pointer-events-none opacity-0')}>
        <Boton type="submit" className="w-full shadow-2xl shadow-black" cargando={cambio.isPending}>
          Guardar caja
        </Boton>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------ Gastos de la noche

function Gastos({ gastos, eventoId, total }: { gastos: GastoDB[]; eventoId: string; total: number }) {
  const localId = useLocalId()
  const cambio = useCambioEvento(eventoId)
  const [monto, setMonto] = useState('')
  const [detalle, setDetalle] = useState('')
  const [error, setError] = useState('')

  async function agregar() {
    setError('')
    const m = leerPrecio(monto)
    if (m == null || Number.isNaN(m) || m <= 0) return setError('Poné un monto mayor a 0.')
    if (!detalle.trim()) return setError('Anotá a qué fue el gasto.')
    try {
      await cambio.mutateAsync((sb) =>
        ejecutar(sb.from('evento_gastos').insert({ evento_id: eventoId, local_id: localId, monto: m, detalle: detalle.trim(), hora: new Date(ahoraParaInput()).toISOString() })),
      )
      setMonto('')
      setDetalle('')
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function borrar(g: GastoDB) {
    if (!confirm(`¿Borrar el gasto "${g.detalle}" de ${formatoPesos(g.monto)}? Va a la papelera durante 30 días.`)) return
    try {
      await cambio.mutateAsync(() => mandarAPapelera('gasto', g.id))
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <Bloque titulo="Gastos de la noche" ayuda="Lo que se pagó con plata de la caja. Se resta del retiro a caja fuerte.">
      {gastos.length > 0 && (
        <ul className="divide-y divide-borde rounded-lg border border-borde">
          {gastos.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{g.detalle}</p>
                <p className="text-xs text-suave">
                  {formatoHora(g.hora)} · cargó {g.autor?.nombre ?? 'usuario'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="tabular font-semibold">{formatoPesos(g.monto)}</span>
                <button type="button" onClick={() => borrar(g)} className="rounded px-2 py-1 text-suave hover:bg-realce hover:text-alerta" aria-label="Borrar">
                  ✕
                </button>
              </div>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2.5 font-semibold">
            <span>Total gastos</span>
            <span className="tabular">{formatoPesos(total)}</span>
          </li>
        </ul>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
        <Campo etiqueta="Monto" inputMode="decimal" placeholder="$ 0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        <Campo
          etiqueta="Detalle"
          placeholder="Ej: hielo de emergencia"
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              agregar()
            }
          }}
        />
      </div>
      <Boton variante="secundario" className="w-full" onClick={agregar} cargando={cambio.isPending}>
        + Agregar gasto
      </Boton>
      {error && <Aviso>{error}</Aviso>}
    </Bloque>
  )
}

// ------------------------------------------------------------------ Piezas

function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <Tarjeta className="space-y-3 p-4">
      <div>
        <h3 className="text-lg font-semibold">{titulo}</h3>
        {ayuda && <p className="text-xs text-suave">{ayuda}</p>}
      </div>
      {children}
    </Tarjeta>
  )
}

function Total({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <Tarjeta className={cx('px-4 py-3', destacado && 'border-marca-500')}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-2xl font-semibold', destacado && 'texto-plata')}>{valor}</p>
    </Tarjeta>
  )
}

function Resultado({ titulo, valor, detalle, rojo }: { titulo: string; valor: string; detalle?: string; rojo?: boolean }) {
  return (
    <div className="rounded-lg bg-realce px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', rojo && 'text-alerta')}>{valor}</p>
      {detalle && <p className="tabular text-[11px] text-suave">{detalle}</p>}
    </div>
  )
}

function Diferencia({ titulo, valor }: { titulo: string; valor: number }) {
  const color = valor === 0 ? 'text-emerald-400' : valor < 0 ? 'text-alerta' : 'text-amber-300'
  return (
    <div className="rounded-lg bg-realce px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', color)}>{formatoPesos(valor)}</p>
      <p className={cx('text-[11px]', color)}>{textoDiferencia(valor, formatoPesos)}</p>
    </div>
  )
}
