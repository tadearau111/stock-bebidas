'use client'

import { Tarjeta, cx } from '@/components/ui'
import { textoDiferencia } from '@/lib/calculos/caja'
import { resumirCajeros } from '@/lib/calculos/cajeros'
import { formatoPesos } from '@/lib/formato'
import type { DetalleEvento } from '@/lib/tipos'

/**
 * Resumen de todas las cajas de la noche (suma de los cajeros). Se muestra en
 * la pestaña Caja, en lugar del bloque Barras, cuando el evento tiene cajeros.
 */
export function ResumenCajas({ detalle, ventaCaja }: { detalle: DetalleEvento; ventaCaja: number }) {
  const resumen = resumirCajeros(detalle.cajeros ?? [], detalle.retirosCajeros ?? [])
  const cajeros = detalle.cajeros?.length ?? 0
  return (
    <Tarjeta className="space-y-3 border-marca-500 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Resumen de todas las cajas</h3>
          <p className="text-xs text-suave">Se suma solo con lo cargado en la pestaña Cajeros.</p>
        </div>
        <p className="text-xs text-suave">
          {cajeros} {cajeros === 1 ? 'cajero' : 'cajeros'} · {resumen.cantidad} {resumen.cantidad === 1 ? 'retiro' : 'retiros'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Dato titulo="Efectivo real (total retirado)" valor={formatoPesos(resumen.total)} destacado />
        <Dato titulo="Efectivo sistema" valor={formatoPesos(resumen.efectivoSistema)} />
        <Dato titulo="Cierre de lotes" valor={formatoPesos(resumen.cierreLotes)} />
        <Dato titulo="Tarjetas sistema" valor={formatoPesos(resumen.tarjetasSistema)} />
        <DiferenciaCaja titulo="Diferencia efectivo" valor={resumen.diferenciaEfectivo} />
        <DiferenciaCaja titulo="Diferencia tarjetas" valor={resumen.diferenciaTarjetas} />
      </div>
      <Dato titulo="Venta total caja (efectivo real + cierre de lotes)" valor={formatoPesos(ventaCaja)} destacado />
    </Tarjeta>
  )
}

function Dato({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className="rounded-lg bg-realce px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', destacado && 'texto-plata')}>{valor}</p>
    </div>
  )
}

/** Diferencia con colores. Vacía mientras no se cargó lo del sistema. */
export function DiferenciaCaja({ titulo, valor, ayuda }: { titulo: string; valor: number | null; ayuda?: string }) {
  const color = valor == null ? 'text-suave' : valor === 0 ? 'text-emerald-400' : valor < 0 ? 'text-alerta' : 'text-amber-300'
  return (
    <div className="rounded-lg bg-realce px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', color)}>{valor == null ? '—' : formatoPesos(valor)}</p>
      <p className={cx('text-[11px]', color)}>{valor == null ? 'Falta cargar el sistema' : textoDiferencia(valor, formatoPesos)}</p>
      {ayuda && <p className="text-[11px] text-suave">{ayuda}</p>}
    </div>
  )
}
