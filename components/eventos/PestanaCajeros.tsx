'use client'

import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Aviso, Boton, Campo, Tarjeta, cx } from '@/components/ui'
import { textoDiferencia } from '@/lib/calculos/caja'
import { resumirCajeros, type ResumenCajero } from '@/lib/calculos/cajeros'
import { formatoHora, formatoPesos, leerPrecio, mensajeError } from '@/lib/formato'
import { actualizar, aPapelera, insertar } from '@/lib/offline/cola'
import { useCargaEvento } from '@/lib/offline/sincronizar'
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
  const carga = useCargaEvento(eventoId)
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
      await carga.guardar(`Cajero: ${n}`, [insertar('evento_cajeros', { evento_id: eventoId, local_id: localId, nombre: n, orden })])
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
          Anotá cada retiro de dinero que se le hace a un cajero durante la noche y, al cerrar, lo que dice el sistema y los posnet de su caja. Es{' '}
          <b>solo de control</b>: <b>no suma ni resta</b> en la venta ni en la caja. Los totales de la noche se cargan igual que siempre en la pestaña
          Caja (el resumen de abajo te sirve para controlarlos).
        </p>
      </div>

      {/* Resumen de todas las cajas (mismo orden que el bloque Barras de la pestaña Caja) */}
      <Tarjeta className="space-y-3 border-marca-500 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold">Resumen de todas las cajas</h3>
          <p className="text-xs text-suave">
            {detalle.cajeros.length} {detalle.cajeros.length === 1 ? 'cajero' : 'cajeros'} · {resumen.cantidad}{' '}
            {resumen.cantidad === 1 ? 'retiro' : 'retiros'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Dato titulo="Efectivo real (total retirado)" valor={formatoPesos(resumen.total)} destacado />
          <Dato titulo="Efectivo sistema" valor={formatoPesos(resumen.efectivoSistema)} />
          <Dato titulo="Cierre de lotes" valor={formatoPesos(resumen.cierreLotes)} />
          <Dato titulo="Tarjetas sistema" valor={formatoPesos(resumen.tarjetasSistema)} />
          <Diferencia titulo="Diferencia efectivo" valor={resumen.diferenciaEfectivo} />
          <Diferencia titulo="Diferencia tarjetas" valor={resumen.diferenciaTarjetas} />
        </div>
      </Tarjeta>

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
          <Boton onClick={agregarCajero} cargando={carga.guardando} textoCargando="…">
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
  const carga = useCargaEvento(eventoId)
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
      await carga.guardar(`Retiro a ${c.cajero.nombre}: ${formatoPesos(m)}`, [
        insertar('cajero_retiros', { cajero_id: c.cajero.id, evento_id: eventoId, monto: m, hora: horaAFecha(hora).toISOString(), notas: notas.trim() || null }),
      ])
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
      await carga.guardar(`Cambiar nombre del cajero a ${nuevo}`, [actualizar('evento_cajeros', c.cajero.id, { nombre: nuevo })])
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
      await carga.guardar(`Borrar al cajero ${c.cajero.nombre}`, [aPapelera('cajero', c.cajero.id)])
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function borrarRetiro(id: string, montoRetiro: number) {
    if (!confirm(`¿Borrar el retiro de ${formatoPesos(montoRetiro)}? Va a la papelera durante 30 días.`)) return
    try {
      await carga.guardar(`Borrar un retiro de ${c.cajero.nombre}`, [aPapelera('retiro_cajero', id)])
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
      <Boton variante="secundario" className="w-full" onClick={registrar} cargando={carga.guardando}>
        + Registrar retiro
      </Boton>
      {error && <Aviso>{error}</Aviso>}

      <CierreCajero key={`${c.cajero.efectivo_sistema}-${c.cajero.tarjetas_sistema}-${c.cajero.cierre_lotes}`} c={c} eventoId={eventoId} />
    </Tarjeta>
  )
}

// ------------------------------------------------------------------ Cierre de la caja de un cajero

const miles = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const aTexto = (v: number | null) => (v == null ? '' : miles.format(v))

function CierreCajero({ c, eventoId }: { c: ResumenCajero; eventoId: string }) {
  const carga = useCargaEvento(eventoId)
  const [efectivo, setEfectivo] = useState(aTexto(c.efectivoSistema))
  const [tarjetas, setTarjetas] = useState(aTexto(c.tarjetasSistema))
  const [lotes, setLotes] = useState(aTexto(c.cierreLotes))
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const hayCambios = efectivo !== aTexto(c.efectivoSistema) || tarjetas !== aTexto(c.tarjetasSistema) || lotes !== aTexto(c.cierreLotes)

  async function guardar() {
    setError('')
    setOk('')
    const valores = { efectivo_sistema: leerPrecio(efectivo), tarjetas_sistema: leerPrecio(tarjetas), cierre_lotes: leerPrecio(lotes) }
    if (Object.values(valores).some((v) => v != null && (Number.isNaN(v) || v < 0))) {
      return setError('Hay montos que no son válidos. Usá solo números (ej: 125.000 o 125000,50).')
    }
    try {
      const { sinConexion } = await carga.guardar(`Cierre de la caja de ${c.cajero.nombre}`, [actualizar('evento_cajeros', c.cajero.id, valores)])
      setOk(sinConexion ? 'Guardado en este celular (se manda solo cuando vuelva internet).' : 'Cierre guardado.')
      setTimeout(() => setOk(''), 4000)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-3 border-t border-borde pt-3">
      <div>
        <p className="font-semibold">Cierre de la caja</p>
        <p className="text-xs text-suave">Al terminar la noche: lo que dicen el sistema de venta y los posnet de esta caja.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Efectivo sistema" inputMode="decimal" placeholder="$ 0" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} />
        <Campo etiqueta="Cierre de lotes" inputMode="decimal" placeholder="$ 0" value={lotes} onChange={(e) => setLotes(e.target.value)} ayuda="Lo que dicen los posnet" />
        <Campo etiqueta="Tarjetas sistema" inputMode="decimal" placeholder="$ 0" value={tarjetas} onChange={(e) => setTarjetas(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Diferencia titulo="Diferencia efectivo" valor={c.diferenciaEfectivo} ayuda={`Retirado ${formatoPesos(c.total)} − sistema`} />
        <Diferencia titulo="Diferencia tarjetas" valor={c.diferenciaTarjetas} ayuda="Lotes − sistema" />
      </div>
      {hayCambios && (
        <Boton className="w-full" onClick={guardar} cargando={carga.guardando}>
          Guardar cierre
        </Boton>
      )}
      {ok && <Aviso tipo="ok">✓ {ok}</Aviso>}
      {error && <Aviso>{error}</Aviso>}
    </div>
  )
}

// ------------------------------------------------------------------ Piezas

function Dato({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className="rounded-lg bg-realce px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', destacado && 'texto-plata')}>{valor}</p>
    </div>
  )
}

/** Diferencia con colores, igual que en la pestaña Caja. Vacía mientras no se cargó lo del sistema. */
function Diferencia({ titulo, valor, ayuda }: { titulo: string; valor: number | null; ayuda?: string }) {
  const color = valor == null ? 'text-suave' : valor === 0 ? 'text-emerald-400' : valor < 0 ? 'text-alerta' : 'text-amber-300'
  return (
    <div className="rounded-lg bg-realce px-3 py-2.5">
      <p className="text-xs text-suave">{titulo}</p>
      <p className={cx('tabular text-lg font-semibold', color)}>{valor == null ? '—' : formatoPesos(valor)}</p>
      <p className={cx('text-[11px]', color)}>{valor == null ? 'Falta cargar el sistema' : textoDiferencia(valor, formatoPesos)}</p>
      {ayuda && <p className="text-[11px] text-suave">{ayuda}</p>}
    </div>
  )
}
