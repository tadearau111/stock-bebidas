'use client'

import { useMemo, useState } from 'react'
import { Aviso, Tarjeta, cx } from '@/components/ui'
import { TIPOS_BARRA, costosDelEvento, soloBotellas, type TipoBarra } from '@/lib/calculos/evento'
import { useArticulos } from '@/lib/datos'
import { ejecutar, useCambioEvento } from '@/lib/eventos'
import { formatoCantidad, formatoNumero, formatoPesos, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'
import type { DetalleEvento } from '@/lib/tipos'

export function PestanaCostos({ detalle }: { detalle: DetalleEvento }) {
  const { data: articulos } = useArticulos()
  const { puede } = useSesion()
  const { evento, barras, lineas, retiros } = detalle
  const tipo: TipoBarra = evento.tipo_barra ?? 'propia'
  const cambio = useCambioEvento(evento.id)
  const [error, setError] = useState('')

  const costos = useMemo(() => {
    const precios = (articulos ?? []).map((a) => ({
      id: a.id,
      nombre: a.nombre,
      unidad: a.unidad,
      precio_costo: a.precio_costo,
      precio_mayorista: a.precio_mayorista,
    }))
    for (const l of lineas) {
      if (!precios.some((p) => p.id === l.articulo_id)) {
        precios.push({ id: l.articulo_id, nombre: l.articulo.nombre, unidad: l.articulo.unidad, precio_costo: null, precio_mayorista: null })
      }
    }
    return costosDelEvento(barras, lineas, soloBotellas(retiros), precios, tipo)
  }, [articulos, barras, lineas, retiros, tipo])

  const nombreBarra = (id: string) => barras.find((b) => b.id === id)?.nombre ?? 'Barra'
  const precio = TIPOS_BARRA[tipo].precio

  async function cambiarTipo(t: TipoBarra) {
    if (t === tipo) return
    setError('')
    try {
      await cambio.mutateAsync((sb) => ejecutar(sb.from('eventos').update({ tipo_barra: t }).eq('id', evento.id).select('id').single()))
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Costos</h2>
        <p className="text-sm text-suave">
          Calculado con lo consumido en cada barra × <b className="text-tinta">{precio}</b>.
        </p>
      </div>

      {/* Tipo de barra del evento */}
      <div className="space-y-1">
        <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-borde bg-superficie p-1 text-sm sm:w-[28rem]">
          {(Object.keys(TIPOS_BARRA) as TipoBarra[]).map((t) => (
            <button
              key={t}
              onClick={() => cambiarTipo(t)}
              disabled={!puede('eventos.gestionar') || cambio.isPending}
              className={cx('rounded-md px-2 py-2 leading-tight', tipo === t ? 'plata font-semibold' : 'text-suave hover:bg-realce disabled:hover:bg-transparent')}
            >
              {TIPOS_BARRA[t].nombre}
              <span className="block text-[11px] font-normal opacity-80">con {TIPOS_BARRA[t].precio}</span>
            </button>
          ))}
        </div>
        {error && <Aviso>{error}</Aviso>}
      </div>

      <Tarjeta className="border-marca-500 px-4 py-3">
        <p className="text-xs text-suave">Total a {precio}</p>
        <p className="tabular texto-plata text-3xl font-semibold">{formatoPesos(costos.total)}</p>
      </Tarjeta>

      {costos.lineasPendientes > 0 && (
        <Aviso>
          Falta cargar el stock final en {costos.lineasPendientes} {costos.lineasPendientes === 1 ? 'artículo' : 'artículos'}. Hasta que se cargue, no se
          cuentan.
        </Aviso>
      )}
      {costos.sinPrecio.length > 0 && (
        <Aviso tipo="info">
          Sin {precio} cargado (no se suman): {costos.sinPrecio.join(', ')}. Se carga en Depósito → el artículo → Editar.
        </Aviso>
      )}

      {/* Detalle por barra */}
      {costos.barras.map((b) => (
        <section key={b.barra_id} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h3 className="text-lg font-semibold">{nombreBarra(b.barra_id)}</h3>
            <p className="tabular text-sm text-suave">
              Total <b className="text-tinta">{formatoPesos(b.total)}</b>
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
                    <Tarjeta className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{f.articulo.nombre}</p>
                        <p className="tabular text-xs text-suave">
                          {f.pendiente
                            ? 'falta el stock final'
                            : f.precio == null
                              ? `${formatoCantidad(f.consumido, f.articulo.unidad)} · sin ${precio}`
                              : `${formatoNumero(f.consumido)} × ${formatoPesos(f.precio)}`}
                        </p>
                      </div>
                      <p className="tabular shrink-0 text-lg font-semibold">{formatoPesos(f.total)}</p>
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
                      <th className="px-3 py-3">{precio}</th>
                      <th className="px-4 py-3">Total</th>
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
                        <td className="px-3 py-2.5 text-suave">{formatoPesos(f.precio)}</td>
                        <td className="px-4 py-2.5 font-semibold">{formatoPesos(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="tabular border-t border-borde text-right font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-left" colSpan={3}>
                        Total {nombreBarra(b.barra_id)}
                      </td>
                      <td className="px-4 py-3">{formatoPesos(b.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Tarjeta>
            </>
          )}
        </section>
      ))}

      {costos.barras.length > 1 && (
        <Tarjeta className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="font-semibold">Total general ({costos.barras.length} barras)</p>
          <p className="tabular texto-plata text-lg font-semibold">{formatoPesos(costos.total)}</p>
        </Tarjeta>
      )}
    </div>
  )
}
