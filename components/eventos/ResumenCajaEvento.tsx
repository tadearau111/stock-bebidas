'use client'

import type { ReactNode } from 'react'
import { Tarjeta, cx } from '@/components/ui'
import { cajaCargada, calcularCaja, textoDiferencia } from '@/lib/calculos/caja'
import { cajaDelEvento, resumirCajeros } from '@/lib/calculos/cajeros'
import { formatoHora, formatoPesos } from '@/lib/formato'
import type { DetalleEvento } from '@/lib/tipos'

/** La Caja del evento, para leer de un vistazo en el Resumen (los mismos números que la pestaña Caja). */
export function ResumenCajaEvento({ detalle }: { detalle: DetalleEvento }) {
  const { datos: c, automatico } = cajaDelEvento(detalle)
  const cajeros = resumirCajeros(detalle.cajeros ?? [], detalle.retirosCajeros ?? [])
  if (!cajaCargada(c, detalle.gastos) && !cajeros.cajeros.length) return null
  const r = calcularCaja(c, detalle.gastos)

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">Caja</h3>
        <p className="text-xs text-suave">
          {automatico ? 'Barras es la suma de todas las cajas de los cajeros.' : 'Lo cargado en la pestaña Caja.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Dato titulo="Venta total caja (barras)" valor={formatoPesos(r.ventaCaja)} />
        <Dato titulo="Gastos totales" valor={formatoPesos(r.totalGastos)} />
        <Dato titulo="Retiro a caja fuerte" valor={formatoPesos(r.retiroCajaFuerte)} rojo={r.retiroCajaFuerte < 0} />
        <Dato titulo="Venta total + boletería + guardarropas" valor={formatoPesos(r.ventaTotalGeneral)} destacado ancho />
      </div>

      <Tarjeta className="divide-y divide-borde">
        <Grupo titulo="Barras">
          <Fila texto="Efectivo real" valor={formatoPesos(c.efectivo_real ?? 0)} />
          <Fila texto="Efectivo sistema" valor={formatoPesos(c.efectivo_sistema ?? 0)} />
          <Fila texto="Diferencia efectivo" valor={textoDiferencia(r.diferenciaEfectivo, formatoPesos)} dif={r.diferenciaEfectivo} />
          <Fila texto="Cierre de lotes" valor={formatoPesos(c.cierre_lotes ?? 0)} />
          <Fila texto="Tarjetas sistema" valor={formatoPesos(c.tarjetas_sistema ?? 0)} />
          <Fila texto="Diferencia tarjetas" valor={textoDiferencia(r.diferenciaTarjetas, formatoPesos)} dif={r.diferenciaTarjetas} />
          <Fila texto="Venta total caja" valor={formatoPesos(r.ventaCaja)} fuerte />
        </Grupo>

        <Grupo titulo="Boletería y guardarropas">
          <Fila texto="Boletería · efectivo real" valor={formatoPesos(c.boleteria_efectivo ?? 0)} />
          <Fila texto="Boletería · cierre de lotes" valor={formatoPesos(c.boleteria_lotes ?? 0)} />
          <Fila texto="Total boletería" valor={formatoPesos(r.totalBoleteria)} fuerte />
          <Fila texto="Guardarropas · efectivo real" valor={formatoPesos(c.guardarropas_efectivo ?? 0)} />
          <Fila texto="Guardarropas · cierre de lotes" valor={formatoPesos(c.guardarropas_lotes ?? 0)} />
          <Fila texto="Total guardarropas" valor={formatoPesos(r.totalGuardarropas)} fuerte />
        </Grupo>

        <Grupo titulo="Gastos de la noche">
          {detalle.gastos.length === 0 && <p className="py-1 text-sm text-suave">Sin gastos.</p>}
          {detalle.gastos.map((g) => (
            <Fila key={g.id} texto={`${g.detalle} · ${formatoHora(g.hora)}`} valor={formatoPesos(g.monto)} />
          ))}
          <Fila texto="Gastos totales" valor={formatoPesos(r.totalGastos)} fuerte />
        </Grupo>

        <Grupo titulo="Cierre de caja">
          <Fila texto="Cambio disponible próxima caja" valor={formatoPesos(c.cambio_proxima_caja ?? 0)} />
          <Fila texto="Vasos no devueltos" valor={String(c.vasos_no_devueltos ?? 0)} />
          <Fila texto="Retiro a caja fuerte" valor={formatoPesos(r.retiroCajaFuerte)} fuerte />
          <Fila texto="Venta total + boletería + guardarropas" valor={formatoPesos(r.ventaTotalGeneral)} fuerte />
        </Grupo>
      </Tarjeta>
    </section>
  )
}

const colorDif = (v: number | null) => (v == null ? 'text-suave' : v === 0 ? 'text-emerald-400' : v < 0 ? 'text-alerta' : 'text-amber-300')

function Dato({ titulo, valor, destacado, ancho, rojo }: { titulo: string; valor: string; destacado?: boolean; ancho?: boolean; rojo?: boolean }) {
  return (
    <Tarjeta className={cx('px-3 py-2.5', destacado && 'border-marca-500', ancho && 'col-span-2 sm:col-span-3')}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', destacado && 'texto-plata', rojo && 'text-alerta')}>{valor}</p>
    </Tarjeta>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-suave">{titulo}</p>
      {children}
    </div>
  )
}

function Fila({ texto, valor, fuerte, dif }: { texto: string; valor: string; fuerte?: boolean; dif?: number }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className={cx(fuerte ? 'font-semibold' : 'text-suave')}>{texto}</span>
      <span className={cx('tabular text-right', fuerte && 'font-semibold', dif != null && colorDif(dif))}>{valor}</span>
    </div>
  )
}
