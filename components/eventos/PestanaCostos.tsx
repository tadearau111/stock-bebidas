'use client'

import { useMemo } from 'react'
import { Aviso, Tarjeta, cx } from '@/components/ui'
import { costosDelEvento } from '@/lib/calculos/evento'
import { useArticulos } from '@/lib/datos'
import { formatoCantidad, formatoNumero, formatoPesos } from '@/lib/formato'
import type { DetalleEvento } from '@/lib/tipos'

export function PestanaCostos({ detalle }: { detalle: DetalleEvento }) {
  const { data: articulos } = useArticulos()
  const { barras, lineas, retiros } = detalle

  const costos = useMemo(() => {
    const precios = (articulos ?? []).map((a) => ({
      id: a.id,
      nombre: a.nombre,
      unidad: a.unidad,
      precio_costo: a.precio_costo,
      precio_venta: a.precio_venta,
    }))
    for (const l of lineas) {
      if (!precios.some((p) => p.id === l.articulo_id)) {
        precios.push({ id: l.articulo_id, nombre: l.articulo.nombre, unidad: l.articulo.unidad, precio_costo: null, precio_venta: null })
      }
    }
    return costosDelEvento(barras, lineas, retiros, precios)
  }, [articulos, barras, lineas, retiros])

  const nombreBarra = (id: string) => barras.find((b) => b.id === id)?.nombre ?? 'Barra'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Costos</h2>
        <p className="text-sm text-suave">
          Calculado con lo consumido en cada barra. <b className="text-tinta">Costo</b> = consumido × precio de costo.{' '}
          <b className="text-tinta">Venta</b> = vendido × precio de venta (vendido = consumido − retiros de personal y cortesías).
        </p>
      </div>

      {/* Totales generales */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Total titulo="Total precio costo" valor={formatoPesos(costos.totalCosto)} />
        <Total titulo="Total precio venta" valor={formatoPesos(costos.totalVenta)} destacado />
        <Total titulo="Diferencia (venta − costo)" valor={formatoPesos(costos.diferencia)} rojo={costos.diferencia < 0} />
      </div>

      {costos.lineasPendientes > 0 && (
        <Aviso>
          Falta cargar el stock final en {costos.lineasPendientes} {costos.lineasPendientes === 1 ? 'artículo' : 'artículos'}. Hasta que se cargue, no se
          cuentan en los costos.
        </Aviso>
      )}
      {(costos.sinPrecioCosto.length > 0 || costos.sinPrecioVenta.length > 0) && (
        <Aviso tipo="info">
          {costos.sinPrecioCosto.length > 0 && (
            <span className="block">Sin precio de costo (no se suman): {costos.sinPrecioCosto.join(', ')}.</span>
          )}
          {costos.sinPrecioVenta.length > 0 && (
            <span className="block">Sin precio de venta (no se suman): {costos.sinPrecioVenta.join(', ')}.</span>
          )}
          <span className="block">Los precios se cargan en Depósito → el artículo → Editar.</span>
        </Aviso>
      )}

      {/* Detalle por barra */}
      {costos.barras.map((b) => (
        <section key={b.barra_id} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h3 className="text-lg font-semibold">{nombreBarra(b.barra_id)}</h3>
            <p className="tabular text-sm text-suave">
              Costo <b className="text-tinta">{formatoPesos(b.totalCosto)}</b> · Venta <b className="text-tinta">{formatoPesos(b.totalVenta)}</b>
            </p>
          </div>

          {b.filas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-borde px-3 py-3 text-sm text-suave">Esta barra no tiene artículos.</p>
          ) : (
            <>
              {/* Celular */}
              <ul className="space-y-2 md:hidden">
                {b.filas.map((f) => (
                  <li key={f.articulo.id}>
                    <Tarjeta className="p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold">{f.articulo.nombre}</p>
                        <p className="tabular text-sm text-suave">
                          {f.pendiente ? 'falta el final' : `${formatoCantidad(f.consumido, f.articulo.unidad)} consumidas`}
                        </p>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <Celda
                          titulo="Costo"
                          detalle={f.articulo.precio_costo == null ? 'sin precio' : `${formatoNumero(f.consumido)} × ${formatoPesos(f.articulo.precio_costo)}`}
                          valor={formatoPesos(f.totalCosto)}
                        />
                        <Celda
                          titulo="Venta"
                          detalle={f.articulo.precio_venta == null ? 'sin precio' : `${formatoNumero(f.vendido)} × ${formatoPesos(f.articulo.precio_venta)}`}
                          valor={formatoPesos(f.totalVenta)}
                        />
                      </div>
                      {f.retiros > 0 && <p className="mt-1.5 text-xs text-suave">{formatoNumero(f.retiros)} {f.retiros === 1 ? 'retirada' : 'retiradas'} (personal/cortesías): {f.retiros === 1 ? 'cuesta pero no se vende' : 'cuestan pero no se venden'}.</p>}
                    </Tarjeta>
                  </li>
                ))}
              </ul>

              {/* Computadora */}
              <Tarjeta className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-borde text-right text-xs uppercase tracking-wide text-suave">
                    <tr>
                      <th className="px-4 py-3 text-left">Artículo</th>
                      <th className="px-3 py-3">Consumido</th>
                      <th className="px-3 py-3">Precio costo</th>
                      <th className="px-3 py-3">Total costo</th>
                      <th className="px-3 py-3">Vendido</th>
                      <th className="px-3 py-3">Precio venta</th>
                      <th className="px-4 py-3">Total venta</th>
                    </tr>
                  </thead>
                  <tbody className="tabular divide-y divide-borde text-right">
                    {b.filas.map((f) => (
                      <tr key={f.articulo.id}>
                        <td className="px-4 py-2.5 text-left font-medium">
                          {f.articulo.nombre}
                          {f.pendiente && <span className="ml-2 text-xs text-alerta">falta final</span>}
                        </td>
                        <td className="px-3 py-2.5">{formatoCantidad(f.consumido, f.articulo.unidad)}</td>
                        <td className="px-3 py-2.5 text-suave">{formatoPesos(f.articulo.precio_costo)}</td>
                        <td className="px-3 py-2.5 font-semibold">{formatoPesos(f.totalCosto)}</td>
                        <td className="px-3 py-2.5" title={f.retiros ? `${f.retiros} retiradas` : undefined}>
                          {formatoNumero(f.vendido)}
                          {f.retiros > 0 && <span className="ml-1 text-xs text-suave">(−{f.retiros})</span>}
                        </td>
                        <td className="px-3 py-2.5 text-suave">{formatoPesos(f.articulo.precio_venta)}</td>
                        <td className="px-4 py-2.5 font-semibold">{formatoPesos(f.totalVenta)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="tabular border-t border-borde text-right font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-left" colSpan={3}>
                        Total {nombreBarra(b.barra_id)}
                      </td>
                      <td className="px-3 py-3">{formatoPesos(b.totalCosto)}</td>
                      <td colSpan={2} />
                      <td className="px-4 py-3">{formatoPesos(b.totalVenta)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Tarjeta>
            </>
          )}
        </section>
      ))}

      {/* Total general al final */}
      {costos.barras.length > 1 && (
        <Tarjeta className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="font-semibold">Total general ({costos.barras.length} barras)</p>
          <p className="tabular">
            Costo <b>{formatoPesos(costos.totalCosto)}</b> · Venta <b className="texto-plata">{formatoPesos(costos.totalVenta)}</b>
          </p>
        </Tarjeta>
      )}
    </div>
  )
}

function Total({ titulo, valor, destacado, rojo }: { titulo: string; valor: string; destacado?: boolean; rojo?: boolean }) {
  return (
    <Tarjeta className={cx('px-4 py-3', destacado && 'border-marca-500')}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-2xl font-semibold', destacado && 'texto-plata', rojo && 'text-alerta')}>{valor}</p>
    </Tarjeta>
  )
}

function Celda({ titulo, detalle, valor }: { titulo: string; detalle: string; valor: string }) {
  return (
    <div className="rounded-lg bg-realce px-2.5 py-2">
      <p className="text-[11px] text-suave">{titulo}</p>
      <p className="tabular font-semibold">{valor}</p>
      <p className="tabular text-[11px] text-suave">{detalle}</p>
    </div>
  )
}
