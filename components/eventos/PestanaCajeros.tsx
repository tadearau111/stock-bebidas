'use client'

import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Aviso, Boton, Campo, Tarjeta } from '@/components/ui'
import { resumirCajeros, type ResumenCajero } from '@/lib/calculos/cajeros'
import { ejecutar, useCambioEvento } from '@/lib/eventos'
import { formatoHora, formatoPesos, leerPrecio, mensajeError } from '@/lib/formato'
import { mandarAPapelera } from '@/lib/papelera'
import { supabase } from '@/lib/supabase/cliente'
import { useLocalId } from '@/lib/sesion'
import type { DetalleEvento } from '@/lib/tipos'

/** Nombres de cajeros usados en otros eventos (para sugerir al escribir). */
function useNombresCajeros() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['nombres-cajeros', localId],
    enabled: !!localId,
    queryFn: async () => {
      const { data, error } = await supabase().from('evento_cajeros').select('nombre, creado_en').eq('local_id', localId).order('creado_en', { ascending: false }).limit(300)
      if (error) throw error
      const vistos = new Map<string, string>()
      for (const f of data as { nombre: string }[]) {
        const n = f.nombre.trim()
        if (n && !vistos.has(n.toLocaleLowerCase('es'))) vistos.set(n.toLocaleLowerCase('es'), n)
      }
      return [...vistos.values()]
    },
  })
}

/** "HH:MM" de ahora (hora local). */
const horaAhora = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Hora elegida → fecha completa: hoy, o ayer si esa hora todavía no llegó (eventos que pasan la medianoche). */
function horaAFecha(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  if (d.getTime() > Date.now() + 5 * 60_000) d.setDate(d.getDate() - 1)
  return d
}

export function PestanaCajeros({ detalle }: { detalle: DetalleEvento }) {
  const eventoId = detalle.evento.id
  const localId = useLocalId()
  const cambio = useCambioEvento(eventoId)
  const { data: sugeridos } = useNombresCajeros()
  const listaId = useId()
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState('')
  const resumen = resumirCajeros(detalle.cajeros, detalle.retirosCajeros)
  const yaEstan = new Set(detalle.cajeros.map((c) => c.nombre.trim().toLocaleLowerCase('es')))

  async function agregarCajero() {
    setError('')
    const n = nombre.trim()
    if (!n) return setError('Escribí el nombre del cajero.')
    if (yaEstan.has(n.toLocaleLowerCase('es'))) return setError('Ese cajero ya está en la lista.')
    const orden = Math.max(0, ...detalle.cajeros.map((c) => c.orden)) + 1
    try {
      await cambio.mutateAsync((sb) => ejecutar(sb.from('evento_cajeros').insert({ evento_id: eventoId, local_id: localId, nombre: n, orden }).select('id').single()))
      setNombre('')
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Cajeros</h2>
        <p className="text-sm text-suave">
          Anotá cada retiro de dinero que se le hace a un cajero durante la noche. Es <b>solo de control</b> (para que no se junte mucha plata en las
          cajas): <b>no suma ni resta</b> en la venta ni en la caja. La venta total se carga igual que siempre en la pestaña Caja.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tarjeta className="border-marca-500 px-4 py-3">
          <p className="text-xs text-suave">Total retirado en la noche</p>
          <p className="tabular texto-plata text-2xl font-semibold">{formatoPesos(resumen.total)}</p>
        </Tarjeta>
        <Tarjeta className="px-4 py-3">
          <p className="text-xs text-suave">Retiros</p>
          <p className="tabular text-2xl font-semibold">{resumen.cantidad}</p>
          <p className="text-xs text-suave">
            {detalle.cajeros.length} {detalle.cajeros.length === 1 ? 'cajero' : 'cajeros'}
          </p>
        </Tarjeta>
      </div>

      {resumen.cajeros.length === 0 && (
        <Aviso tipo="info">Todavía no hay cajeros en este evento. Agregá el nombre de cada uno abajo.</Aviso>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {resumen.cajeros.map((c) => (
          <TarjetaCajero key={c.cajero.id} c={c} eventoId={eventoId} />
        ))}
      </div>

      {/* Agregar cajero */}
      <Tarjeta className="space-y-3 p-4">
        <h3 className="text-lg font-semibold">Agregar cajero</h3>
        <div className="flex items-end gap-2">
          <Campo
            className="flex-1"
            etiqueta="Nombre"
            placeholder="Ej: Sofía"
            value={nombre}
            list={listaId}
            autoComplete="off"
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                agregarCajero()
              }
            }}
          />
          <Boton onClick={agregarCajero} cargando={cambio.isPending} textoCargando="…">
            + Agregar
          </Boton>
        </div>
        <datalist id={listaId}>
          {(sugeridos ?? [])
            .filter((n) => !yaEstan.has(n.toLocaleLowerCase('es')))
            .map((n) => (
              <option key={n} value={n} />
            ))}
        </datalist>
        {error && <Aviso>{error}</Aviso>}
      </Tarjeta>
    </div>
  )
}

function TarjetaCajero({ c, eventoId }: { c: ResumenCajero; eventoId: string }) {
  const cambio = useCambioEvento(eventoId)
  const [monto, setMonto] = useState('')
  const [hora, setHora] = useState(horaAhora)
  const [notas, setNotas] = useState('')
  const [error, setError] = useState('')

  async function registrar() {
    setError('')
    const m = leerPrecio(monto)
    if (m == null || Number.isNaN(m) || m <= 0) return setError('Poné un monto mayor a 0.')
    if (!/^\d{2}:\d{2}$/.test(hora)) return setError('Elegí la hora del retiro.')
    try {
      await cambio.mutateAsync((sb) =>
        ejecutar(
          sb
            .from('cajero_retiros')
            .insert({ cajero_id: c.cajero.id, evento_id: eventoId, monto: m, hora: horaAFecha(hora).toISOString(), notas: notas.trim() || null })
            .select('id')
            .single(),
        ),
      )
      setMonto('')
      setNotas('')
      setHora(horaAhora())
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function renombrar() {
    const nuevo = prompt('Nombre del cajero:', c.cajero.nombre)?.trim()
    if (!nuevo || nuevo === c.cajero.nombre) return
    try {
      await cambio.mutateAsync((sb) => ejecutar(sb.from('evento_cajeros').update({ nombre: nuevo }).eq('id', c.cajero.id).select('id').single()))
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function borrarCajero() {
    const aviso = c.retiros.length
      ? `¿Borrar a ${c.cajero.nombre} con sus ${c.retiros.length} retiros? Va a la papelera durante 30 días.`
      : `¿Borrar a ${c.cajero.nombre}? Va a la papelera durante 30 días.`
    if (!confirm(aviso)) return
    try {
      await cambio.mutateAsync(() => mandarAPapelera('cajero', c.cajero.id))
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function borrarRetiro(id: string, montoRetiro: number) {
    if (!confirm(`¿Borrar el retiro de ${formatoPesos(montoRetiro)}? Va a la papelera durante 30 días.`)) return
    try {
      await cambio.mutateAsync(() => mandarAPapelera('retiro_cajero', id))
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <Tarjeta className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{c.cajero.nombre}</h3>
          <p className="text-xs text-suave">
            <button type="button" onClick={renombrar} className="text-marca-700 underline">
              Cambiar nombre
            </button>{' '}
            ·{' '}
            <button type="button" onClick={borrarCajero} className="text-alerta underline">
              Borrar
            </button>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-suave">Retirado</p>
          <p className="tabular text-xl font-semibold">{formatoPesos(c.total)}</p>
        </div>
      </div>

      {c.retiros.length > 0 && (
        <ul className="divide-y divide-borde rounded-lg border border-borde">
          {c.retiros.map((r, i) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {i + 1}° retiro · {formatoHora(r.hora)}
                </p>
                <p className="truncate text-xs text-suave">
                  {r.notas ? `${r.notas} · ` : ''}cargó {r.autor?.nombre ?? 'usuario'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="tabular font-semibold">{formatoPesos(r.monto)}</span>
                <button
                  type="button"
                  onClick={() => borrarRetiro(r.id, r.monto)}
                  className="rounded px-2 py-1 text-suave hover:bg-realce hover:text-alerta"
                  aria-label="Borrar retiro"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
        <Campo etiqueta="Monto retirado" inputMode="decimal" placeholder="$ 0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        <Campo etiqueta="Hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
      </div>
      <Campo etiqueta="Notas (opcional)" placeholder="Ej: retiró Laura" value={notas} onChange={(e) => setNotas(e.target.value)} />
      <Boton variante="secundario" className="w-full" onClick={registrar} cargando={cambio.isPending}>
        + Registrar retiro
      </Boton>
      {error && <Aviso>{error}</Aviso>}
    </Tarjeta>
  )
}
