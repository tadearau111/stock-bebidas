'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Ventana, cx } from '@/components/ui'
import { esCantidadValida } from '@/lib/calculos/stock'
import { useAnularMovimiento, useArticulos, useCorregirMovimiento, useMovimientos } from '@/lib/datos'
import { formatoCantidad, formatoFechaHora, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'
import type { Movimiento } from '@/lib/tipos'

export default function PaginaMovimientos() {
  return (
    <Suspense fallback={<Cargando />}>
      <Movimientos />
    </Suspense>
  )
}

function Movimientos() {
  const { puede } = useSesion()
  const router = useRouter()
  const ruta = usePathname()
  const params = useSearchParams()
  const articuloId = params.get('articulo') ?? ''
  const [tipo, setTipo] = useState<'' | 'ingreso' | 'ajuste'>('')
  const [corrigiendo, setCorrigiendo] = useState<Movimiento | null>(null)
  const { data: articulos } = useArticulos()
  const { data: movimientos, isPending, error } = useMovimientos({ articuloId: articuloId || undefined })

  const lista = (movimientos ?? []).filter((m) => !tipo || m.tipo === tipo)
  const articulo = articulos?.find((a) => a.id === articuloId)

  if (!puede('deposito.ver')) return <Aviso>No tenés permiso para ver los movimientos.</Aviso>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Movimientos del depósito</h1>
        <p className="text-sm text-suave">Ingresos de compras y ajustes manuales. El stock se calcula a partir de esta lista.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Selector
          etiqueta="Artículo"
          value={articuloId}
          onChange={(e) => router.replace(e.target.value ? `${ruta}?articulo=${e.target.value}` : ruta)}
        >
          <option value="">Todos los artículos</option>
          {(articulos ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
          <option value="">Ingresos y ajustes</option>
          <option value="ingreso">Solo ingresos</option>
          <option value="ajuste">Solo ajustes</option>
        </Selector>
      </div>

      {articulo && (
        <Aviso tipo="info">
          Stock actual de <b>{articulo.nombre}</b>: {formatoCantidad(articulo.stock_actual, articulo.unidad)}
        </Aviso>
      )}

      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : lista.length === 0 ? (
        <Tarjeta className="px-4 py-10 text-center text-suave">Todavía no hay movimientos.</Tarjeta>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {lista.map((m) => (
            <div key={m.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {m.articulo?.nombre ?? '—'}{' '}
                  <Etiqueta color={m.tipo === 'ingreso' ? 'verde' : 'gris'}>{m.tipo === 'ingreso' ? 'Ingreso' : 'Ajuste'}</Etiqueta>
                </p>
                {m.motivo && <p className="text-sm text-suave">Motivo: {m.motivo}</p>}
                <p className="text-xs text-suave">
                  {formatoFechaHora(m.fecha)} · {m.autor?.nombre ?? 'Usuario'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cx('tabular whitespace-nowrap text-lg font-bold', m.cantidad < 0 ? 'text-alerta' : 'text-marca-700')}>
                  {m.cantidad > 0 ? '+' : ''}
                  {formatoCantidad(m.cantidad, m.articulo?.unidad)}
                </p>
                {puede('deposito.ajustar') && (
                  <button onClick={() => setCorrigiendo(m)} className="text-sm text-marca-700 hover:underline">
                    Corregir
                  </button>
                )}
              </div>
            </div>
          ))}
        </Tarjeta>
      )}

      <Ventana abierta={!!corrigiendo} alCerrar={() => setCorrigiendo(null)} titulo="Corregir movimiento">
        {corrigiendo && <FormCorregir movimiento={corrigiendo} alTerminar={() => setCorrigiendo(null)} />}
      </Ventana>
    </div>
  )
}

function FormCorregir({ movimiento: m, alTerminar }: { movimiento: Movimiento; alTerminar: () => void }) {
  const corregir = useCorregirMovimiento()
  const anular = useAnularMovimiento()
  const [cantidad, setCantidad] = useState(String(m.cantidad))
  const [motivo, setMotivo] = useState(m.motivo ?? '')
  const [error, setError] = useState('')
  const esIngreso = m.tipo === 'ingreso'

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const n = Number(cantidad)
    if (!esCantidadValida(n, { permitirNegativo: !esIngreso })) {
      return setError(esIngreso ? 'La cantidad tiene que ser un número entero mayor a 0.' : 'La cantidad tiene que ser un número entero distinto de 0.')
    }
    if (!esIngreso && !motivo.trim()) return setError('El motivo es obligatorio en los ajustes.')
    try {
      await corregir.mutateAsync({ id: m.id, cantidad: n, motivo: motivo.trim() || null })
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function borrar() {
    if (!confirm('¿Anular este movimiento? El stock se recalcula y queda registrado en el historial.')) return
    try {
      await anular.mutateAsync(m.id)
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="rounded-lg bg-fondo px-3 py-2 text-sm">
        <p className="font-medium">{m.articulo?.nombre}</p>
        <p className="text-suave">
          {esIngreso ? 'Ingreso' : 'Ajuste'} del {formatoFechaHora(m.fecha)} · cargado por {m.autor?.nombre ?? 'Usuario'}
        </p>
      </div>
      <Campo
        etiqueta="Cantidad"
        type="number"
        inputMode={esIngreso ? 'numeric' : 'text'}
        step={1}
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
      />
      <Campo etiqueta={esIngreso ? 'Nota (opcional)' : 'Motivo *'} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Aviso tipo="info">El cambio queda registrado en el historial con el valor anterior y el nuevo.</Aviso>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={corregir.isPending}>
          Guardar
        </Boton>
      </div>
      <Boton variante="peligro" className="w-full" onClick={borrar} cargando={anular.isPending} textoCargando="Anulando…">
        Anular movimiento
      </Boton>
    </form>
  )
}
