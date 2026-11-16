'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Fragment, Suspense, useState } from 'react'
import { FormEvento } from '@/components/eventos/FormEvento'
import { PestanaBarra } from '@/components/eventos/PestanaBarra'
import { PestanaBebidaAbierta } from '@/components/eventos/PestanaBebidaAbierta'
import { PestanaCostos } from '@/components/eventos/PestanaCostos'
import { PestanaResumen } from '@/components/eventos/PestanaResumen'
import { Aviso, Boton, Cargando, Ventana, cx } from '@/components/ui'
import { ejecutar, useBorrarEvento, useCambioEvento, useEvento } from '@/lib/eventos'
import { formatoFechaEvento, formatoNumero, mensajeError } from '@/lib/formato'
import { useLocalId, useSesion } from '@/lib/sesion'

export default function PaginaEvento() {
  return (
    <Suspense fallback={<Cargando />}>
      <Evento />
    </Suspense>
  )
}

function Evento() {
  const params = useSearchParams()
  const router = useRouter()
  const ruta = usePathname()
  const id = params.get('id') ?? ''
  const pestana = params.get('p') ?? ''
  const { puede } = useSesion()
  const localId = useLocalId()
  const { data: detalle, isPending, error } = useEvento(id)
  const cambio = useCambioEvento(id)
  const borrar = useBorrarEvento()
  const [editando, setEditando] = useState(false)
  const [errorAccion, setErrorAccion] = useState('')

  const irA = (p: string) => router.replace(`${ruta}?id=${id}&p=${p}`, { scroll: false })

  if (!id) return <Aviso>Falta el evento.</Aviso>
  if (isPending) return <Cargando />
  if (error) return <Aviso>{mensajeError(error)}</Aviso>
  if (!detalle)
    return (
      <div className="space-y-3">
        <Aviso>No encontramos este evento, o no tenés acceso.</Aviso>
        <Link href="/eventos" className="text-marca-700 underline">
          Volver a eventos
        </Link>
      </div>
    )

  const { evento, barras } = detalle
  const barraActiva = barras.find((b) => b.id === pestana)
  // La pestaña Costos la ve quien gestiona eventos (los encargados de la noche no ven precios ahí)
  const verCostos = puede('eventos.gestionar')
  const fijas = ['abierta', 'resumen', ...(verCostos ? ['costos'] : [])]
  const actual = barraActiva ? barraActiva.id : fijas.includes(pestana) ? pestana : (barras[0]?.id ?? 'resumen')
  const barraMostrada = barras.find((b) => b.id === actual)

  async function agregarBarra() {
    setErrorAccion('')
    const orden = Math.max(0, ...barras.map((b) => b.orden)) + 1
    try {
      const nueva = (await cambio.mutateAsync((sb) =>
        ejecutar(sb.from('barras').insert({ evento_id: id, local_id: localId, nombre: `Barra ${barras.length + 1}`, orden }).select('id').single()),
      )) as { id: string }
      irA(nueva.id)
    } catch (e) {
      setErrorAccion(mensajeError(e))
    }
  }

  async function borrarEvento() {
    if (!confirm(`¿Borrar el evento "${evento.nombre}"? Se borra todo lo cargado y el stock vuelve al depósito. No se puede deshacer.`)) return
    try {
      await borrar.mutateAsync(id)
      router.replace('/eventos')
    } catch (e) {
      setErrorAccion(mensajeError(e))
    }
  }

  const pestanas = [
    ...barras.map((b) => ({ id: b.id, nombre: b.nombre })),
    { id: 'abierta', nombre: 'Bebida abierta' },
    { id: 'resumen', nombre: 'Resumen' },
    ...(verCostos ? [{ id: 'costos', nombre: 'Costos' }] : []),
  ]

  return (
    <div className="space-y-4">
      <div>
        <Link href="/eventos" className="text-sm text-suave hover:text-tinta">
          ‹ Eventos
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{evento.nombre}</h1>
            <p className="text-suave">
              {formatoFechaEvento(evento.fecha)} · {formatoNumero(evento.personas)} personas
            </p>
            {evento.notas && <p className="mt-1 text-sm text-suave">{evento.notas}</p>}
          </div>
          {puede('eventos.gestionar') && (
            <div className="flex gap-2">
              <Boton variante="secundario" onClick={() => setEditando(true)}>
                Editar
              </Boton>
              <Boton variante="peligro" onClick={borrarEvento} cargando={borrar.isPending} textoCargando="Borrando…">
                Borrar
              </Boton>
            </div>
          )}
        </div>
      </div>

      {errorAccion && <Aviso>{errorAccion}</Aviso>}

      {/* Pestañas */}
      <div className="sticky top-[57px] z-[5] -mx-4 border-b border-borde bg-fondo/90 px-4 backdrop-blur md:top-0 md:mx-0 md:px-0">
        <div className="flex gap-1 overflow-x-auto py-2">
          {pestanas.map((p) => (
            <Fragment key={p.id}>
              {p.id === 'abierta' && (
                <button
                  onClick={agregarBarra}
                  disabled={cambio.isPending}
                  className="mr-2 shrink-0 whitespace-nowrap rounded-lg border border-dashed border-borde px-3 py-2 text-sm text-suave hover:border-marca-500 hover:text-tinta"
                >
                  +1 Barra
                </button>
              )}
              <button
                onClick={() => irA(p.id)}
                className={cx(
                  'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
                  actual === p.id ? 'plata font-semibold' : 'text-suave hover:bg-realce hover:text-tinta',
                )}
              >
                {p.nombre}
              </button>
            </Fragment>
          ))}
        </div>
      </div>

      {barraMostrada ? (
        <PestanaBarra key={barraMostrada.id} detalle={detalle} barra={barraMostrada} alBorrar={() => irA('resumen')} />
      ) : actual === 'abierta' ? (
        <PestanaBebidaAbierta detalle={detalle} />
      ) : (
        actual === 'costos' ? <PestanaCostos detalle={detalle} /> : <PestanaResumen detalle={detalle} />
      )}

      <Ventana abierta={editando} alCerrar={() => setEditando(false)} titulo="Editar evento">
        {editando && <FormEvento evento={evento} alTerminar={() => setEditando(false)} />}
      </Ventana>
    </div>
  )
}
