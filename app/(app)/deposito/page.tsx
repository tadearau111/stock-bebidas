'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FormAjuste, FormArticulo, FormIngreso } from '@/components/deposito/formularios'
import { ListaTragos } from '@/components/deposito/Tragos'
import { IconoBuscar } from '@/components/marca'
import { Aviso, Boton, Cargando, Etiqueta, Tarjeta, Ventana, cx } from '@/components/ui'
import { coincideBusqueda } from '@/lib/calculos/stock'
import { useArticulos, useBorrarArticulo, useGuardarArticulo } from '@/lib/datos'
import { detalleArticulo, formatoCantidad, formatoNumero, formatoPesos, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'
import type { Articulo } from '@/lib/tipos'

type Filtro = 'activos' | 'bajo' | 'inactivos'
type Accion =
  | { tipo: 'nuevo' }
  | { tipo: 'editar'; articulo: Articulo }
  | { tipo: 'ingreso'; articulo?: Articulo }
  | { tipo: 'ajuste'; articulo: Articulo }
  | { tipo: 'opciones'; articulo: Articulo }
  | { tipo: 'tragos' }
  | null

export default function PaginaDeposito() {
  const { puede } = useSesion()
  const { data: articulos, isPending, error } = useArticulos()
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('activos')
  const [accion, setAccion] = useState<Accion>(null)
  const [mensaje, setMensaje] = useState('')

  const lista = useMemo(() => {
    return (articulos ?? [])
      .filter((a) => (filtro === 'inactivos' ? !a.activo : a.activo))
      .filter((a) => filtro !== 'bajo' || a.bajo_minimo)
      .filter((a) => coincideBusqueda(busqueda, [a.nombre, a.marca, a.tamano]))
  }, [articulos, filtro, busqueda])

  const cantidadBajo = (articulos ?? []).filter((a) => a.activo && a.bajo_minimo).length

  const cerrar = (msg?: string) => {
    setAccion(null)
    if (msg) {
      setMensaje(msg)
      setTimeout(() => setMensaje(''), 4000)
    }
  }

  if (!puede('deposito.ver')) return <Aviso>No tenés permiso para ver el depósito.</Aviso>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Depósito</h1>
        <div className="flex gap-2">
          {puede('articulos.editar') && (
            <Boton variante="secundario" onClick={() => setAccion({ tipo: 'tragos' })}>
              Tragos
            </Boton>
          )}
          {puede('articulos.editar') && (
            <Boton variante="secundario" onClick={() => setAccion({ tipo: 'nuevo' })}>
              + Artículo
            </Boton>
          )}
          {puede('ingresos.cargar') && <Boton onClick={() => setAccion({ tipo: 'ingreso' })}>+ Ingreso</Boton>}
        </div>
      </div>

      {mensaje && <Aviso tipo="ok">✓ {mensaje}</Aviso>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-suave" width={18} height={18} />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, marca o tamaño"
            className="min-h-11 w-full rounded-lg border border-borde bg-superficie pl-10 pr-3 outline-none placeholder:text-suave focus:border-marca-500 focus:ring-2 focus:ring-marca-100"
          />
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-borde bg-superficie p-1 text-sm sm:w-auto">
          {(
            [
              ['activos', 'Todos'],
              ['bajo', `Bajo mínimo${cantidadBajo ? ` (${cantidadBajo})` : ''}`],
              ['inactivos', 'Inactivos'],
            ] as const
          ).map(([f, t]) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cx('whitespace-nowrap rounded-md px-3 py-1.5', filtro === f ? 'plata font-semibold' : 'text-suave hover:bg-realce')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : lista.length === 0 ? (
        <Tarjeta className="px-4 py-10 text-center text-suave">
          {filtro === 'bajo' ? '¡Nada por debajo del mínimo! 🎉' : 'No hay artículos que coincidan.'}
        </Tarjeta>
      ) : (
        <>
          {/* Celular: tarjetas */}
          <ul className="space-y-2 md:hidden">
            {lista.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setAccion({ tipo: 'opciones', articulo: a })}
                  className={cx(
                    'flex w-full items-center justify-between rounded-xl border bg-superficie px-4 py-3 text-left',
                    a.bajo_minimo ? 'border-alerta/50 bg-alerta-50' : 'border-borde',
                  )}
                >
                  <div className="min-w-0">
                    <p className={cx('truncate font-semibold', a.bajo_minimo && 'text-alerta')}>{a.nombre}</p>
                    <p className="truncate text-xs text-suave">{detalleArticulo(a) || '—'}</p>
                    <p className="text-xs text-suave">Mínimo: {formatoNumero(a.stock_minimo)}</p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className={cx('tabular text-xl font-bold', a.bajo_minimo && 'text-alerta')}>{formatoNumero(a.stock_actual)}</p>
                    <p className="text-xs text-suave">{a.unidad === 'bolsa' ? 'bolsas' : 'unidades'}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Computadora: tabla */}
          <Tarjeta className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-borde text-left text-xs uppercase tracking-wide text-suave">
                <tr>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Marca</th>
                  <th className="px-4 py-3">Tamaño</th>
                  <th className="px-4 py-3 text-right">Stock actual</th>
                  <th className="px-4 py-3 text-right">Stock mínimo</th>
                  <th className="px-4 py-3 text-right">Precio costo</th>
                  <th className="px-4 py-3 text-right">Precio venta</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {lista.map((a) => (
                  <tr key={a.id} className={cx(a.bajo_minimo ? 'bg-alerta-50' : 'hover:bg-realce')}>
                    <td className={cx('px-4 py-2.5 font-medium', a.bajo_minimo && 'text-alerta')}>
                      {a.nombre} {a.bajo_minimo && <Etiqueta color="rojo">Faltan {formatoNumero(a.faltante)}</Etiqueta>}
                    </td>
                    <td className="px-4 py-2.5 text-suave">{a.marca || '—'}</td>
                    <td className="px-4 py-2.5 text-suave">{a.tamano || '—'}</td>
                    <td className={cx('tabular px-4 py-2.5 text-right font-semibold', a.bajo_minimo && 'text-alerta')}>
                      {formatoCantidad(a.stock_actual, a.unidad)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{formatoNumero(a.stock_minimo)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatoPesos(a.precio_costo)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatoPesos(a.precio_venta)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setAccion({ tipo: 'opciones', articulo: a })} className="rounded-lg px-3 py-1 text-marca-700 hover:bg-marca-50">
                        Opciones
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tarjeta>
          <p className="text-center text-xs text-suave">
            {lista.length} {lista.length === 1 ? 'artículo' : 'artículos'}
          </p>
        </>
      )}

      <Ventana abierta={accion?.tipo === 'tragos'} alCerrar={() => cerrar()} titulo="Tragos y vasos">
        {accion?.tipo === 'tragos' && <ListaTragos />}
      </Ventana>
      <Ventana abierta={accion?.tipo === 'nuevo'} alCerrar={() => cerrar()} titulo="Nuevo artículo">
        <FormArticulo alTerminar={() => cerrar('Artículo agregado.')} />
      </Ventana>
      <Ventana abierta={accion?.tipo === 'editar'} alCerrar={() => cerrar()} titulo="Editar artículo">
        {accion?.tipo === 'editar' && <FormArticulo articulo={accion.articulo} alTerminar={() => cerrar('Cambios guardados.')} />}
      </Ventana>
      <Ventana abierta={accion?.tipo === 'ingreso'} alCerrar={() => cerrar()} titulo="Nuevo ingreso">
        {accion?.tipo === 'ingreso' && <FormIngreso articulos={articulos ?? []} inicial={accion.articulo} alTerminar={cerrar} />}
      </Ventana>
      <Ventana abierta={accion?.tipo === 'ajuste'} alCerrar={() => cerrar()} titulo="Ajuste manual de stock">
        {accion?.tipo === 'ajuste' && <FormAjuste articulo={accion.articulo} alTerminar={cerrar} />}
      </Ventana>
      <Ventana abierta={accion?.tipo === 'opciones'} alCerrar={() => cerrar()} titulo={accion?.tipo === 'opciones' ? accion.articulo.nombre : ''}>
        {accion?.tipo === 'opciones' && <OpcionesArticulo articulo={accion.articulo} setAccion={setAccion} cerrar={cerrar} />}
      </Ventana>
    </div>
  )
}

function OpcionesArticulo({
  articulo: a,
  setAccion,
  cerrar,
}: {
  articulo: Articulo
  setAccion: (a: Accion) => void
  cerrar: (msg?: string) => void
}) {
  const { puede } = useSesion()
  const guardar = useGuardarArticulo()
  const borrar = useBorrarArticulo()
  const [error, setError] = useState('')

  async function cambiarActivo() {
    try {
      await guardar.mutateAsync({ id: a.id, datos: { activo: !a.activo } })
      cerrar(a.activo ? `${a.nombre} desactivado.` : `${a.nombre} activado.`)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar "${a.nombre}"? No tiene movimientos, así que se borra por completo.`)) return
    try {
      await borrar.mutateAsync(a.id)
      cerrar(`${a.nombre} eliminado.`)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  const fila = (titulo: string, valor: string, rojo = false) => (
    <div className="flex justify-between py-1.5">
      <dt className="text-suave">{titulo}</dt>
      <dd className={cx('tabular font-medium', rojo && 'text-alerta')}>{valor}</dd>
    </div>
  )

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-borde text-sm">
        {fila('Marca', a.marca || '—')}
        {fila('Tamaño', a.tamano || '—')}
        {fila('Stock actual', formatoCantidad(a.stock_actual, a.unidad), a.bajo_minimo)}
        {fila('Stock mínimo', formatoCantidad(a.stock_minimo, a.unidad))}
        {a.bajo_minimo && fila('Falta comprar', formatoCantidad(a.faltante, a.unidad), true)}
        {fila('Precio de costo', formatoPesos(a.precio_costo))}
        {fila('Precio de venta', formatoPesos(a.precio_venta))}
      </dl>
      {!a.activo && <Aviso tipo="info">Este artículo está desactivado: no aparece para cargar ingresos ni en las barras.</Aviso>}
      {error && <Aviso>{error}</Aviso>}
      <div className="grid gap-2">
        {puede('ingresos.cargar') && a.activo && <Boton onClick={() => setAccion({ tipo: 'ingreso', articulo: a })}>+ Cargar ingreso</Boton>}
        {puede('articulos.editar') && (
          <Boton variante="secundario" onClick={() => setAccion({ tipo: 'editar', articulo: a })}>
            Editar datos y precios
          </Boton>
        )}
        {puede('deposito.ajustar') && (
          <Boton variante="secundario" onClick={() => setAccion({ tipo: 'ajuste', articulo: a })}>
            Ajuste manual de stock
          </Boton>
        )}
        <Link
          href={`/movimientos?articulo=${a.id}`}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-borde bg-superficie px-4 text-sm font-semibold hover:bg-realce"
        >
          Ver movimientos
        </Link>
        {puede('articulos.editar') && (
          <Boton variante={a.activo ? 'peligro' : 'secundario'} onClick={cambiarActivo} cargando={guardar.isPending}>
            {a.activo ? 'Desactivar' : 'Volver a activar'}
          </Boton>
        )}
        {puede('articulos.editar') && a.cantidad_movimientos === 0 && (
          <Boton variante="fantasma" className="text-alerta" onClick={eliminar} cargando={borrar.isPending} textoCargando="Eliminando…">
            Eliminar artículo
          </Boton>
        )}
      </div>
    </div>
  )
}
