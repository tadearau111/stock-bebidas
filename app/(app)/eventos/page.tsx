'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { FormEvento } from '@/components/eventos/FormEvento'
import { IconoBuscar } from '@/components/marca'
import { Aviso, Boton, Cargando, Etiqueta, Tarjeta, Ventana } from '@/components/ui'
import { coincideBusqueda } from '@/lib/calculos/stock'
import { useEventos } from '@/lib/eventos'
import { eventoPasado, formatoFechaEvento, formatoNumero, hoyISO, mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'

export default function PaginaEventos() {
  const { puede } = useSesion()
  const router = useRouter()
  const { data: eventos, isPending, error } = useEventos()
  const [busqueda, setBusqueda] = useState('')
  const [nuevo, setNuevo] = useState(false)

  const lista = useMemo(
    () => (eventos ?? []).filter((e) => coincideBusqueda(busqueda, [e.nombre, formatoFechaEvento(e.fecha), e.fecha])),
    [eventos, busqueda],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Eventos</h1>
        {puede('eventos.gestionar') && <Boton onClick={() => setNuevo(true)}>+ Evento</Boton>}
      </div>

      <div className="relative">
        <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-suave" width={18} height={18} />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o fecha"
          className="min-h-11 w-full rounded-lg border border-borde bg-superficie pl-10 pr-3 outline-none focus:border-marca-500 focus:ring-2 focus:ring-marca-100"
        />
      </div>

      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : lista.length === 0 ? (
        <Tarjeta className="px-4 py-10 text-center text-suave">
          {(eventos?.length ?? 0) === 0
            ? puede('eventos.gestionar')
              ? 'Todavía no hay eventos. Creá el primero con "+ Evento".'
              : 'Todavía no tenés eventos asignados.'
            : 'No hay eventos que coincidan.'}
        </Tarjeta>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {lista.map((ev) => (
            <Link key={ev.id} href={`/evento?id=${ev.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-realce">
              <div className="min-w-0">
                <p className="truncate font-medium">{ev.nombre}</p>
                <p className="text-sm text-suave">
                  {formatoFechaEvento(ev.fecha)} · {formatoNumero(ev.personas)} personas
                </p>
              </div>
              {ev.fecha === hoyISO() ? (
                <Etiqueta color="verde">Hoy</Etiqueta>
              ) : !eventoPasado(ev.fecha) ? (
                <Etiqueta>Próximo</Etiqueta>
              ) : (
                <span className="text-suave">›</span>
              )}
            </Link>
          ))}
        </Tarjeta>
      )}

      <Ventana abierta={nuevo} alCerrar={() => setNuevo(false)} titulo="Nuevo evento">
        {nuevo && (
          <FormEvento
            alTerminar={(id) => {
              setNuevo(false)
              if (id) router.push(`/evento?id=${id}`)
            }}
          />
        )}
      </Ventana>
    </div>
  )
}
