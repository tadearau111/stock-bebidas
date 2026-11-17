'use client'

import { useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Selector, cx } from '@/components/ui'
import { TIPOS_BARRA, type TipoBarra } from '@/lib/calculos/evento'
import { useEventos, useGuardarEvento } from '@/lib/eventos'
import { formatoFechaEvento, hoyISO, mensajeError } from '@/lib/formato'
import type { Evento } from '@/lib/tipos'

export function FormEvento({ evento, alTerminar }: { evento?: Evento; alTerminar: (id?: string) => void }) {
  const guardar = useGuardarEvento()
  const { data: eventos } = useEventos()
  const [fecha, setFecha] = useState(evento?.fecha ?? hoyISO())
  const [nombre, setNombre] = useState(evento?.nombre ?? '')
  const [personas, setPersonas] = useState(String(evento?.personas ?? ''))
  const [notas, setNotas] = useState(evento?.notas ?? '')
  const [tipoBarra, setTipoBarra] = useState<TipoBarra>(evento?.tipo_barra ?? 'propia')
  const [copiarDe, setCopiarDe] = useState('')
  const [error, setError] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const p = Number(personas || 0)
    if (!nombre.trim()) return setError('Poné un nombre para el evento.')
    if (!fecha) return setError('Elegí la fecha.')
    if (!Number.isInteger(p) || p < 0) return setError('La cantidad de personas tiene que ser un número entero.')
    try {
      const id = await guardar.mutateAsync({
        id: evento?.id,
        datos: { fecha, nombre: nombre.trim(), personas: p, notas: notas.trim() || null, tipo_barra: tipoBarra },
        copiarDe: copiarDe || undefined,
      })
      alTerminar(id)
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo etiqueta="Nombre del evento *" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Casamiento Pérez" autoFocus={!evento} />
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Fecha *" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        <Campo
          etiqueta="Cantidad de personas"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={personas}
          onChange={(e) => setPersonas(e.target.value)}
        />
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Tipo de barra</p>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-realce p-1 text-sm">
          {(Object.keys(TIPOS_BARRA) as TipoBarra[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipoBarra(t)}
              className={cx('rounded-md px-2 py-2 leading-tight', tipoBarra === t ? 'plata font-semibold' : 'text-suave')}
            >
              {TIPOS_BARRA[t].nombre}
              <span className="block text-[11px] font-normal opacity-80">con {TIPOS_BARRA[t].precio}</span>
            </button>
          ))}
        </div>
      </div>
      <Campo etiqueta="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
      {!evento && (eventos?.length ?? 0) > 0 && (
        <Selector etiqueta="Barras y artículos" value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)}>
          <option value="">Empezar con una barra vacía</option>
          {eventos!.map((ev) => (
            <option key={ev.id} value={ev.id}>
              Copiar de: {ev.nombre} ({formatoFechaEvento(ev.fecha)})
            </option>
          ))}
        </Selector>
      )}
      {copiarDe && <Aviso tipo="info">Se copian las barras y qué artículos lleva cada una. Las cantidades arrancan en 0.</Aviso>}
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2 pt-2">
        <Boton variante="secundario" className="flex-1" onClick={() => alTerminar()}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={guardar.isPending}>
          {evento ? 'Guardar cambios' : 'Crear evento'}
        </Boton>
      </div>
    </form>
  )
}
