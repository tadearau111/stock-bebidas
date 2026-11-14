'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FormIngreso } from '@/components/deposito/formularios'
import { Aviso, Cargando, Tarjeta, Ventana, cx } from '@/components/ui'
import { useArticulos, useMovimientos } from '@/lib/datos'
import { formatoCantidad, formatoFechaHora, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'

export default function PaginaInicio() {
  const { nombre, puede } = useSesion()
  const verDeposito = puede('deposito.ver')
  const [ingreso, setIngreso] = useState(false)
  const [mensaje, setMensaje] = useState('')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hola{nombre ? `, ${nombre.split(' ')[0]}` : ''} 👋</h1>
        <p className="text-suave">Esto es lo que necesitás saber hoy.</p>
      </div>

      {mensaje && <Aviso tipo="ok">✓ {mensaje}</Aviso>}

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {puede('ingresos.cargar') && (
          <AccesoRapido icono="📥" titulo="Nuevo ingreso" onClick={() => setIngreso(true)} />
        )}
        <AccesoRapido icono="🎉" titulo="Nuevo evento" detalle="Disponible en la Fase 2" deshabilitado />
        {verDeposito && <AccesoRapido icono="📦" titulo="Ver depósito" href="/deposito" />}
      </div>

      {verDeposito && <AlertasMinimo />}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Últimos eventos</h2>
        <Tarjeta className="px-4 py-6 text-center text-sm text-suave">Los eventos se suman en la Fase 2.</Tarjeta>
      </section>

      {verDeposito && <UltimosMovimientos />}

      <Ventana abierta={ingreso} alCerrar={() => setIngreso(false)} titulo="Nuevo ingreso">
        {ingreso && <IngresoRapido alTerminar={(m) => { setIngreso(false); if (m) { setMensaje(m); setTimeout(() => setMensaje(''), 4000) } }} />}
      </Ventana>
    </div>
  )
}

function IngresoRapido({ alTerminar }: { alTerminar: (m?: string) => void }) {
  const { data } = useArticulos()
  if (!data) return <Cargando />
  return <FormIngreso articulos={data} alTerminar={alTerminar} />
}

function AccesoRapido({
  icono,
  titulo,
  detalle,
  href,
  onClick,
  deshabilitado,
}: {
  icono: string
  titulo: string
  detalle?: string
  href?: string
  onClick?: () => void
  deshabilitado?: boolean
}) {
  const clase = cx(
    'flex flex-col items-start gap-1 rounded-xl border border-borde bg-white p-4 text-left transition-colors',
    deshabilitado ? 'cursor-not-allowed opacity-50' : 'hover:border-marca-500 hover:bg-marca-50',
  )
  const contenido = (
    <>
      <span className="text-2xl">{icono}</span>
      <span className="font-semibold">{titulo}</span>
      {detalle && <span className="text-xs text-suave">{detalle}</span>}
    </>
  )
  if (href) return <Link href={href} className={clase}>{contenido}</Link>
  return (
    <button onClick={onClick} disabled={deshabilitado} className={clase}>
      {contenido}
    </button>
  )
}

function AlertasMinimo() {
  const { data, isPending, error } = useArticulos()
  const bajos = (data ?? []).filter((a) => a.activo && a.bajo_minimo).sort((a, b) => b.faltante - a.faltante)
  const sinMinimo = (data ?? []).filter((a) => a.activo && a.stock_minimo === 0).length

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">🛒 Qué comprar</h2>
        {bajos.length > 0 && <span className="text-sm text-alerta">{bajos.length} por debajo del mínimo</span>}
      </div>
      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : bajos.length === 0 ? (
        <Tarjeta className="px-4 py-6 text-center">
          <p className="font-medium text-marca-700">Todo en orden: no hay artículos por debajo del mínimo.</p>
          {sinMinimo > 0 && (
            <p className="mt-1 text-sm text-suave">
              {sinMinimo} artículos no tienen stock mínimo cargado.{' '}
              <Link href="/deposito" className="text-marca-700 underline">Completalos en el depósito</Link> para recibir alertas.
            </p>
          )}
        </Tarjeta>
      ) : (
        <Tarjeta className="divide-y divide-borde border-alerta/40">
          {bajos.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium text-alerta">{a.nombre}</p>
                <p className="text-xs text-suave">
                  Hay {formatoCantidad(a.stock_actual, a.unidad)} · mínimo {formatoCantidad(a.stock_minimo, a.unidad)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-suave">Comprar</p>
                <p className="tabular font-bold text-alerta">{formatoCantidad(a.faltante, a.unidad)}</p>
              </div>
            </div>
          ))}
        </Tarjeta>
      )}
    </section>
  )
}

function UltimosMovimientos() {
  const { data } = useMovimientos({ limite: 5 })
  if (!data || data.length === 0) return null
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Últimos movimientos</h2>
        <Link href="/movimientos" className="text-sm text-marca-700 hover:underline">Ver todos</Link>
      </div>
      <Tarjeta className="divide-y divide-borde">
        {data.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <p className="font-medium">{m.articulo?.nombre}</p>
              <p className="text-xs text-suave">
                {m.tipo === 'ingreso' ? 'Ingreso' : `Ajuste: ${m.motivo}`} · {formatoFechaHora(m.fecha)}
              </p>
            </div>
            <span className={cx('tabular shrink-0 whitespace-nowrap pl-2 font-semibold', m.cantidad < 0 ? 'text-alerta' : 'text-marca-700')}>
              {m.cantidad > 0 ? '+' : ''}
              {formatoCantidad(m.cantidad, m.articulo?.unidad)}
            </span>
          </div>
        ))}
      </Tarjeta>
    </section>
  )
}

