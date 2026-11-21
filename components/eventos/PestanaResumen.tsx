'use client'

import { useMemo } from 'react'
import { Aviso, Tarjeta, cx } from '@/components/ui'
import {
  TIPOS_BARRA,
  bebidaAbiertaPorArticulo,
  detalleRetiros,
  formatoBotellas,
  resumirEvento,
  soloBotellas,
  sumarFracciones,
  textoTotalRetiros,
  tragosRetirados,
  type TipoBarra,
} from '@/lib/calculos/evento'
import { BotonesExportar } from '@/components/Exportar'
import { ResumenCajaEvento } from './ResumenCajaEvento'
import { useArticulos } from '@/lib/datos'
import { reporteEvento } from '@/lib/exportar/reportes'
import { useSesion } from '@/lib/sesion'
import { formatoCantidad, formatoHora, formatoNumero, formatoPesos, formatoVasos } from '@/lib/formato'
import type { DetalleEvento, RetiroDB } from '@/lib/tipos'

export function PestanaResumen({ detalle }: { detalle: DetalleEvento }) {
  const { data: articulos } = useArticulos()
  const { puede } = useSesion()
  const { evento, lineas, retiros, bebidaAbierta, barras } = detalle
  const tipo: TipoBarra = evento.tipo_barra ?? 'propia'

  const resumen = useMemo(() => {
    const precios = (articulos ?? []).map((a) => ({
      id: a.id,
      nombre: a.nombre,
      unidad: a.unidad,
      precio_costo: a.precio_costo,
      precio_mayorista: a.precio_mayorista,
    }))
    // si un artículo no está en la lista (p. ej. sin permiso), usar el nombre de la línea
    for (const l of lineas) {
      if (!precios.some((p) => p.id === l.articulo_id)) {
        precios.push({ id: l.articulo_id, nombre: l.articulo.nombre, unidad: l.articulo.unidad, precio_costo: null, precio_mayorista: null })
      }
    }
    return resumirEvento(
      lineas.map((l) => ({ articulo_id: l.articulo_id, stock_inicial: l.stock_inicial, stock_final: l.stock_final, reposiciones: l.reposiciones })),
      soloBotellas(retiros),
      precios,
      evento.personas,
      tipo,
    )
  }, [articulos, lineas, retiros, evento.personas, tipo])

  const abierta = useMemo(() => bebidaAbiertaPorArticulo(bebidaAbierta), [bebidaAbierta])
  const tragos = useMemo(() => tragosRetirados(retiros), [retiros])
  const personal = useMemo(() => detalleRetiros(retiros, 'personal'), [retiros])
  const cortesias = useMemo(() => detalleRetiros(retiros, 'cortesia'), [retiros])
  const nombreBarra = (id: string) => barras.find((b) => b.id === id)?.nombre ?? 'Barra'
  const nombreAbierta = (id: string) => bebidaAbierta.find((b) => b.articulo_id === id)?.articulo?.nombre ?? '¿?'
  // Los precios los ve quien gestiona eventos (igual que la pestaña Costos)
  const hayPrecios = puede('eventos.gestionar') && resumen.totales.total != null
  const precio = TIPOS_BARRA[tipo].precio
  const negativos = resumen.filas.filter((f) => f.ventaEstimada < 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Resumen del evento</h2>
        <BotonesExportar
          compacto
          crear={() =>
            reporteEvento(
              detalle,
              (articulos ?? []).map((a) => ({ id: a.id, nombre: a.nombre, unidad: a.unidad, precio_costo: a.precio_costo, precio_mayorista: a.precio_mayorista })),
              { incluirCostos: puede('eventos.gestionar') },
            )
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato titulo="Personas" valor={formatoNumero(evento.personas)} />
        <Dato titulo="Barras" valor={formatoNumero(barras.length)} />
        <Dato
          titulo="Retiros de personal"
          valor={formatoNumero(personal.cantidadRetiros)}
          detalle={personal.cantidadRetiros ? textoTotalRetiros(personal) : undefined}
        />
        <Dato
          titulo="Cortesías"
          valor={formatoNumero(cortesias.cantidadRetiros)}
          detalle={cortesias.cantidadRetiros ? textoTotalRetiros(cortesias) : undefined}
        />
        {hayPrecios && (
          <>
            <Dato titulo={`Total a ${precio} (${TIPOS_BARRA[tipo].nombre.toLowerCase()})`} valor={formatoPesos(resumen.totales.total)} ancho />
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
                    {hayPrecios && <Mini titulo={`Total (${precio})`} valor={formatoPesos(f.total)} />}
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
                  {hayPrecios && <th className="px-4 py-3">Total ({precio})</th>}
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
                    {hayPrecios && <td className="px-4 py-2.5">{formatoPesos(f.total)}</td>}
                  </tr>
                ))}
              </tbody>
              {hayPrecios && (
                <tfoot className="tabular border-t border-borde text-right font-semibold">
                  <tr>
                    <td className="px-4 py-3 text-left" colSpan={6}>
                      Total
                    </td>
                    <td className="px-4 py-3">{formatoPesos(resumen.totales.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Tarjeta>
          <p className="text-xs text-suave">
            Venta estimada = Consumido − Retiros de personal − Cortesías (en unidades).
            {hayPrecios && ` Total = Consumido × ${precio}; solo para artículos con ese precio cargado.`}
          </p>
        </>
      )}

      <ListaRetiros
        titulo="Retiros de personal"
        ayuda="Lo que retiró el personal, botellas y tragos. Salen de lo cargado en las barras (ya están dentro del consumido)."
        detalle={personal}
        nombreBarra={nombreBarra}
      />
      <ListaRetiros titulo="Cortesías" ayuda="Lo que se dio de cortesía, botellas y tragos." detalle={cortesias} nombreBarra={nombreBarra} />

      {tragos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Tragos y vasos retirados</h3>
          <p className="text-xs text-suave">Informativo: salen de las botellas de las barras, que ya están dentro del consumido.</p>
          <Tarjeta className="overflow-x-auto">
            <table className="tabular w-full text-sm">
              <thead className="border-b border-borde text-right text-xs uppercase tracking-wide text-suave">
                <tr>
                  <th className="px-4 py-2.5 text-left">Trago / vaso</th>
                  <th className="px-3 py-2.5">Personal</th>
                  <th className="px-3 py-2.5">Cortesía</th>
                  <th className="px-4 py-2.5">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde text-right">
                {tragos.map((t) => (
                  <tr key={t.nombre}>
                    <td className="px-4 py-2.5 text-left">{t.nombre}</td>
                    <td className="px-3 py-2.5">{formatoNumero(t.personal)}</td>
                    <td className="px-3 py-2.5">{formatoNumero(t.cortesia)}</td>
                    <td className="px-4 py-2.5 font-semibold">{formatoVasos(t.vasos)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-borde text-right text-suave">
                <tr>
                  <td className="px-4 py-2.5 text-left">Total</td>
                  <td className="px-3 py-2.5">{formatoNumero(tragos.reduce((t, x) => t + x.personal, 0))}</td>
                  <td className="px-3 py-2.5">{formatoNumero(tragos.reduce((t, x) => t + x.cortesia, 0))}</td>
                  <td className="px-4 py-2.5 font-semibold text-tinta">{formatoVasos(tragos.reduce((t, x) => t + x.vasos, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </Tarjeta>
        </section>
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

      {/* La caja completa (solo quien puede ver la Caja) */}
      {puede('eventos.caja') && <ResumenCajaEvento detalle={detalle} />}
    </div>
  )
}

function Dato({ titulo, valor, detalle, ancho }: { titulo: string; valor: string; detalle?: string; ancho?: boolean }) {
  return (
    <Tarjeta className={cx('px-3 py-2.5', ancho && 'col-span-2')}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className="tabular text-lg font-semibold">{valor}</p>
      {detalle && <p className="tabular text-xs text-suave">{detalle}</p>}
    </Tarjeta>
  )
}

/** Lista de retiros de un tipo con quién retiró, qué, cuánto, barra y hora. */
function ListaRetiros({
  titulo,
  ayuda,
  detalle,
  nombreBarra,
}: {
  titulo: string
  ayuda: string
  detalle: { lista: RetiroDB[]; cantidadRetiros: number; unidades: number; vasos: number }
  nombreBarra: (id: string) => string
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-lg font-semibold">{titulo}</h3>
        <p className="tabular text-sm text-suave">
          {detalle.cantidadRetiros} {detalle.cantidadRetiros === 1 ? 'retiro' : 'retiros'} · Total: <b className="text-tinta">{textoTotalRetiros(detalle)}</b>
        </p>
      </div>
      <p className="text-xs text-suave">{ayuda}</p>
      {detalle.lista.length === 0 ? (
        <p className="rounded-lg border border-dashed border-borde px-3 py-3 text-center text-sm text-suave">No hay.</p>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {detalle.lista.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.retirado_por}</p>
                <p className="truncate text-xs text-suave">
                  {r.articulo?.nombre ?? r.trago?.nombre} · {nombreBarra(r.barra_id)} · {formatoHora(r.hora)}
                </p>
              </div>
              <span className="tabular shrink-0 font-semibold">
                {r.trago_id ? formatoVasos(r.cantidad) : formatoCantidad(r.cantidad, r.articulo?.unidad)}
              </span>
            </div>
          ))}
        </Tarjeta>
      )}
    </section>
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
