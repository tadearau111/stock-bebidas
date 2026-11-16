'use client'

import { useMemo, useState } from 'react'
import { Aviso, Tarjeta, cx } from '@/components/ui'
import { bebidaAbiertaPorArticulo, etiquetaCuartos, formatoBotellas, sumarFracciones } from '@/lib/calculos/evento'
import { coincideBusqueda } from '@/lib/calculos/stock'
import { useArticulos } from '@/lib/datos'
import { ejecutar, useCambioEvento } from '@/lib/eventos'
import { formatoHora, mensajeError } from '@/lib/formato'
import { useLocalId } from '@/lib/sesion'
import type { DetalleEvento } from '@/lib/tipos'

const FRACCIONES = [1, 2, 3, 4] as const

export function PestanaBebidaAbierta({ detalle }: { detalle: DetalleEvento }) {
  const localId = useLocalId()
  const eventoId = detalle.evento.id
  const cambio = useCambioEvento(eventoId)
  const { data: articulos } = useArticulos()
  const [articuloId, setArticuloId] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ultimo, setUltimo] = useState('')

  const cargas = detalle.bebidaAbierta
  const totales = useMemo(() => bebidaAbiertaPorArticulo(cargas), [cargas])
  const nombre = (id: string) => cargas.find((c) => c.articulo_id === id)?.articulo?.nombre ?? articulos?.find((a) => a.id === id)?.nombre ?? '¿?'
  const filas = [...totales.entries()].sort((a, b) => nombre(a[0]).localeCompare(nombre(b[0]), 'es'))

  // Primero los que ya se usaron esta noche, después el resto
  const opciones = useMemo(() => {
    const usados = new Set(cargas.map((c) => c.articulo_id))
    return (articulos ?? [])
      .filter((a) => a.activo && coincideBusqueda(busqueda, [a.nombre, a.marca]))
      .sort((a, b) => Number(usados.has(b.id)) - Number(usados.has(a.id)) || a.nombre.localeCompare(b.nombre, 'es'))
  }, [articulos, busqueda, cargas])

  async function cargar(cuartos: number) {
    setError('')
    if (!articuloId) return setError('Primero elegí el artículo.')
    try {
      await cambio.mutateAsync((sb) =>
        ejecutar(sb.from('bebida_abierta').insert({ evento_id: eventoId, local_id: localId, articulo_id: articuloId, cuartos })),
      )
      setUltimo(`${etiquetaCuartos(cuartos)} de ${nombre(articuloId)} cargado.`)
      setTimeout(() => setUltimo(''), 3000)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function borrar(id: string) {
    if (!confirm('¿Borrar esta carga?')) return
    try {
      await cambio.mutateAsync((sb) => ejecutar(sb.from('bebida_abierta').delete().eq('id', id)))
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  const elegido = articulos?.find((a) => a.id === articuloId)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Bebida abierta</h2>
        <p className="text-sm text-suave">
          Solo informativa: no sale del depósito ni vuelve a él, y no pasa a otros eventos. Se carga cada botella abierta en fracciones aproximadas.
        </p>
      </div>

      <Tarjeta className="space-y-3 p-4">
        <p className="text-sm font-semibold">1. Elegí el artículo</p>
        {elegido ? (
          <div className="flex min-h-11 items-center justify-between rounded-lg border border-marca-500 bg-marca-50 px-3">
            <span className="font-medium">{elegido.nombre}</span>
            <button onClick={() => setArticuloId('')} className="text-sm text-marca-700 underline">
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar… (ej: fernet)"
              className="block min-h-11 w-full rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
            />
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {opciones.map((a) => (
                <button key={a.id} onClick={() => setArticuloId(a.id)} className="rounded-full border border-borde px-3 py-1.5 text-sm hover:border-marca-500 hover:bg-realce">
                  {a.nombre}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="pt-1 text-sm font-semibold">2. Tocá cuánto se usó</p>
        <div className="grid grid-cols-4 gap-2">
          {FRACCIONES.map((c) => (
            <button
              key={c}
              disabled={!articuloId || cambio.isPending}
              onClick={() => cargar(c)}
              className={cx(
                'flex h-16 flex-col items-center justify-center rounded-xl border text-2xl font-semibold transition-colors',
                articuloId ? 'border-marca-500 hover:bg-realce' : 'border-borde text-suave opacity-50',
              )}
            >
              {c === 4 ? <span className="text-base">Entera</span> : etiquetaCuartos(c)}
            </button>
          ))}
        </div>
        {ultimo && <Aviso tipo="ok">✓ {ultimo}</Aviso>}
        {error && <Aviso>{error}</Aviso>}
      </Tarjeta>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Total por artículo</h3>
        {filas.length === 0 ? (
          <p className="rounded-lg border border-dashed border-borde px-3 py-4 text-center text-sm text-suave">Todavía no se cargó bebida abierta.</p>
        ) : (
          <Tarjeta className="divide-y divide-borde">
            {filas.map(([id, botellas]) => {
              const detalleArt = cargas.filter((c) => c.articulo_id === id)
              return (
                <div key={id}>
                  <button onClick={() => setAbierto(abierto === id ? null : id)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-realce">
                    <span>
                      <span className="font-medium">{nombre(id)}</span>
                      <span className="block text-xs text-suave">
                        {detalleArt.length} {detalleArt.length === 1 ? 'carga' : 'cargas'} · {abierto === id ? 'ocultar' : 'ver detalle'}
                      </span>
                    </span>
                    <span className="tabular texto-plata text-xl font-bold">
                      {formatoBotellas(botellas)} <span className="text-sm font-normal">{botellas > 1 ? 'botellas' : 'botella'}</span>
                    </span>
                  </button>
                  {abierto === id && (
                    <ul className="border-t border-borde bg-fondo/50 px-4 py-1">
                      {detalleArt.map((c) => (
                        <li key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span>
                            {etiquetaCuartos(c.cuartos)} · {formatoHora(c.hora)} · <span className="text-suave">{c.autor?.nombre ?? 'usuario'}</span>
                          </span>
                          <button onClick={() => borrar(c.id)} className="rounded px-2 text-suave hover:text-alerta" aria-label="Borrar">
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
            <div className="flex justify-between px-4 py-3 text-sm text-suave">
              <span>Total de botellas abiertas</span>
              <span className="tabular font-semibold text-tinta">{formatoBotellas(sumarFracciones(cargas))}</span>
            </div>
          </Tarjeta>
        )}
      </section>
    </div>
  )
}
