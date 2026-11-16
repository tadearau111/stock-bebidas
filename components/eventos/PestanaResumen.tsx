'use client'

import { useMemo } from 'react'
import { Aviso, Tarjeta, cx } from '@/components/ui'
import { bebidaAbiertaPorArticulo, formatoBotellas, resumirEvento, sumarFracciones } from '@/lib/calculos/evento'
import { useArticulos } from '@/lib/datos'
import { formatoCantidad, formatoNumero, formatoPesos } from '@/lib/formato'
import type { DetalleEvento } from '@/lib/tipos'

export function PestanaResumen({ detalle }: { detalle: DetalleEvento }) {
  const { data: articulos } = useArticulos()
  const { evento, lineas, retiros, bebidaAbierta, barras } = detalle

  const resumen = useMemo(() => {
    const precios = (articulos ?? []).map((a) => ({
      id: a.id,
      nombre: a.nombre,
      unidad: a.unidad,
      precio_costo: a.precio_costo,
      precio_venta: a.precio_venta,
    }))
    // si un artículo no está en la lista (p. ej. sin permiso), usar el nombre de la línea
    for (const l of lineas) {
      if (!precios.some((p) => p.id === l.articulo_id)) {
        precios.push({ id: l.articulo_id, nombre: l.articulo.nombre, unidad: l.articulo.unidad, precio_costo: null, precio_venta: null })
      }
    }
    return resumirEvento(
      lineas.map((l) => ({ articulo_id: l.articulo_id, stock_inicial: l.stock_inicial, stock_final: l.stock_final, reposiciones: l.reposiciones })),
      retiros,
      precios,
      evento.personas,
    )
  }, [articulos, lineas, retiros, evento.personas])

  const abierta = useMemo(() => bebidaAbiertaPorArticulo(bebidaAbierta), [bebidaAbierta])
  const nombreAbierta = (id: string) => bebidaAbierta.find((b) => b.articulo_id === id)?.articulo?.nombre ?? '¿?'
  const hayPrecios = resumen.totales.costo != null || resumen.totales.facturacion != null
  const negativos = resumen.filas.filter((f) => f.ventaEstimada < 0)

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Resumen del evento</h2>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato titulo="Personas" valor={formatoNumero(evento.personas)} />
        <Dato titulo="Barras" valor={formatoNumero(barras.length)} />
        <Dato titulo="Retiros personal" valor={formatoNumero(resumen.totales.retirosPersonal)} />
        <Dato titulo="Cortesías" valor={formatoNumero(resumen.totales.cortesias)} />
        {hayPrecios && (
          <>
            <Dato titulo="Costo estimado" valor={formatoPesos(resumen.totales.costo)} ancho />
            <Dato titulo="Facturación estimada" valor={formatoPesos(resumen.totales.facturacion)} ancho />
          </>
        )}
      </div>

      {resumen.barrasSinFinal > 0 && (
        <Aviso>
          Falta cargar el stock final en {resumen.barrasSinFinal} {resumen.barrasSinFinal === 1 ? 'artículo' : 'artículos'} de las barras. Hasta
          que se cargue, ese consumo no se cuenta en este resumen.
        </Aviso>
      )}
      {negativos.length > 0 && (
        <Aviso>
          Los retiros superan lo consumido en: {negativos.map((f) => f.articulo.nombre).join(', ')}. Revisá los números.
        </Aviso>
      )}

      {resumen.filas.length === 0 ? (
        <Tarjeta className="px-4 py-8 text-center text-suave">Todavía no hay artículos cargados en las barras.</Tarjeta>
      ) : (
        <>
          {/* Celular */}
          <ul className="space-y-2 md:hidden">
            {resumen.filas.map((f) => (
              <li key={f.articulo.id}>
                <Tarjeta className="p-3">
                  <div className="flex items-start justify-between">
                    <p className="font-semibold">{f.articulo.nombre}</p>
                    <div className="text-right">
                      <p className="text-[11px] text-suave">Consumido</p>
                      <p className="tabular texto-plata text-xl font-bold">{formatoCantidad(f.consumido, f.articulo.unidad)}</p>
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <Mini titulo="Venta est." valor={formatoNumero(f.ventaEstimada)} rojo={f.ventaEstimada < 0} />
                    <Mini titulo="Personal" valor={formatoNumero(f.retirosPersonal)} />
                    <Mini titulo="Cortesías" valor={formatoNumero(f.cortesias)} />
                    <Mini titulo="Por persona" valor={f.porPersona == null ? '—' : formatoNumero(Math.round(f.porPersona * 100) / 100)} />
                    {hayPrecios && <Mini titulo="Costo" valor={formatoPesos(f.costo)} />}
                    {hayPrecios && <Mini titulo="Facturación" valor={formatoPesos(f.facturacion)} />}
                  </dl>
                  {f.pendiente && <p className="mt-2 text-xs text-alerta">Falta el stock final en alguna barra.</p>}
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
                  <th className="px-3 py-3">Personal</th>
                  <th className="px-3 py-3">Cortesías</th>
                  <th className="px-3 py-3">Venta est.</th>
                  <th className="px-3 py-3">Por persona</th>
                  {hayPrecios && <th className="px-3 py-3">Costo</th>}
                  {hayPrecios && <th className="px-4 py-3">Facturación</th>}
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-borde text-right">
                {resumen.filas.map((f) => (
                  <tr key={f.articulo.id}>
                    <td className="px-4 py-2.5 text-left font-medium">
                      {f.articulo.nombre}
                      {f.pendiente && <span className="ml-2 text-xs text-alerta">falta final</span>}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">{formatoCantidad(f.consumido, f.articulo.unidad)}</td>
                    <td className="px-3 py-2.5">{formatoNumero(f.retirosPersonal)}</td>
                    <td className="px-3 py-2.5">{formatoNumero(f.cortesias)}</td>
                    <td className={cx('px-3 py-2.5', f.ventaEstimada < 0 && 'text-alerta')}>{formatoNumero(f.ventaEstimada)}</td>
                    <td className="px-3 py-2.5">{f.porPersona == null ? '—' : formatoNumero(Math.round(f.porPersona * 100) / 100)}</td>
                    {hayPrecios && <td className="px-3 py-2.5">{formatoPesos(f.costo)}</td>}
                    {hayPrecios && <td className="px-4 py-2.5">{formatoPesos(f.facturacion)}</td>}
                  </tr>
                ))}
              </tbody>
              {hayPrecios && (
                <tfoot className="tabular border-t border-borde text-right font-semibold">
                  <tr>
                    <td className="px-4 py-3 text-left" colSpan={6}>
                      Total
                    </td>
                    <td className="px-3 py-3">{formatoPesos(resumen.totales.costo)}</td>
                    <td className="px-4 py-3">{formatoPesos(resumen.totales.facturacion)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Tarjeta>
          <p className="text-xs text-suave">
            Venta estimada = Consumido − Retiros de personal − Cortesías. Costo = Consumido × precio de costo. Facturación = Venta estimada × precio de
            venta. Solo se calculan para artículos con precio cargado.
          </p>
        </>
      )}

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Bebida abierta</h3>
        {abierta.size === 0 ? (
          <p className="text-sm text-suave">No se cargó bebida abierta.</p>
        ) : (
          <Tarjeta className="divide-y divide-borde">
            {[...abierta.entries()]
              .sort((a, b) => nombreAbierta(a[0]).localeCompare(nombreAbierta(b[0]), 'es'))
              .map(([id, b]) => (
                <div key={id} className="flex justify-between px-4 py-2.5">
                  <span>{nombreAbierta(id)}</span>
                  <span className="tabular font-semibold">
                    {formatoBotellas(b)} {b > 1 ? 'botellas' : 'botella'}
                  </span>
                </div>
              ))}
            <div className="flex justify-between px-4 py-2.5 text-sm text-suave">
              <span>Total</span>
              <span className="tabular font-semibold text-tinta">{formatoBotellas(sumarFracciones(bebidaAbierta))} botellas</span>
            </div>
          </Tarjeta>
        )}
      </section>
    </div>
  )
}

function Dato({ titulo, valor, ancho }: { titulo: string; valor: string; ancho?: boolean }) {
  return (
    <Tarjeta className={cx('px-3 py-2.5', ancho && 'col-span-2')}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className="tabular text-lg font-semibold">{valor}</p>
    </Tarjeta>
  )
}

function Mini({ titulo, valor, rojo }: { titulo: string; valor: string; rojo?: boolean }) {
  return (
    <div className="rounded-lg bg-realce px-1 py-1.5">
      <dt className="text-[10px] text-suave">{titulo}</dt>
      <dd className={cx('tabular font-semibold', rojo && 'text-alerta')}>{valor}</dd>
    </div>
  )
}
