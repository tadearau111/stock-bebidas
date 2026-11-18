'use client'

import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Boton, Ventana } from '@/components/ui'
import { useArticulos } from '@/lib/datos'
import { opcionesEvento, useEventos, useStockLocal } from '@/lib/eventos'
import { formatoFechaHora, hoyISO } from '@/lib/formato'
import { cola } from '@/lib/offline/cola'
import { sincronizar, usePendientes } from '@/lib/offline/sincronizar'
import { useSesion } from '@/lib/sesion'
import { useTragos } from '@/lib/tragos'

// ------------------------------------------------------------------ ¿Hay internet?

function suscribirConexion(f: () => void) {
  window.addEventListener('online', f)
  window.addEventListener('offline', f)
  return () => {
    window.removeEventListener('online', f)
    window.removeEventListener('offline', f)
  }
}

/** true si el dispositivo tiene conexión (en el servidor, siempre true). */
export function useEnLinea(): boolean {
  return useSyncExternalStore(
    suscribirConexion,
    () => navigator.onLine,
    () => true,
  )
}

// ------------------------------------------------------------------ Envío automático

/** Manda solo los cambios guardados: al abrir, al volver internet, al volver a la app y cada 20 segundos. */
export function Sincronizador() {
  const qc = useQueryClient()
  const { session } = useSesion()
  const usuarioId = session?.user.id
  const pendientes = usePendientes()
  const hay = pendientes.some((p) => p.estado === 'pendiente' && p.usuarioId === usuarioId)

  useEffect(() => {
    if (!usuarioId) return
    const enviar = () => {
      if (navigator.onLine) void sincronizar(qc, usuarioId)
    }
    enviar()
    window.addEventListener('online', enviar)
    document.addEventListener('visibilitychange', enviar)
    return () => {
      window.removeEventListener('online', enviar)
      document.removeEventListener('visibilitychange', enviar)
    }
  }, [qc, usuarioId])

  useEffect(() => {
    if (!hay || !usuarioId) return
    const t = setInterval(() => {
      if (navigator.onLine) void sincronizar(qc, usuarioId)
    }, 20_000)
    return () => clearInterval(t)
  }, [hay, qc, usuarioId])

  return <Precarga />
}

/**
 * Deja guardado en el dispositivo lo necesario para trabajar sin conexión:
 * artículos, tragos, stock y los eventos de estos días (de 3 días atrás a 2 semanas adelante).
 */
function Precarga() {
  const enLinea = useEnLinea()
  useArticulos()
  useTragos()
  useStockLocal()
  const { data: eventos } = useEventos()
  const hoy = hoyISO()
  const desde = sumarDias(hoy, -3)
  const hasta = sumarDias(hoy, 14)
  const cercanos = (eventos ?? []).filter((e) => !e.archivado && e.fecha >= desde && e.fecha <= hasta).slice(0, 10)
  useQueries({ queries: cercanos.map((e) => ({ ...opcionesEvento(e.id), enabled: enLinea })) })
  return null
}

function sumarDias(iso: string, n: number) {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(a, m - 1, d + n)
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
}

// ------------------------------------------------------------------ Aviso en pantalla

/** Franja arriba de todo: sin conexión, cambios esperando para mandarse o cambios con error. */
export function EstadoConexion() {
  const enLinea = useEnLinea()
  const { session } = useSesion()
  const pendientes = usePendientes().filter((p) => p.usuarioId === session?.user.id)
  const esperando = pendientes.filter((p) => p.estado === 'pendiente').length
  const conError = pendientes.filter((p) => p.estado === 'error')
  const [viendo, setViendo] = useState(false)

  if (enLinea && !esperando && !conError.length) return null

  const cambios = (n: number) => `${n} ${n === 1 ? 'cambio' : 'cambios'}`
  return (
    <>
      <div
        role="status"
        className={
          !enLinea
            ? 'border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200'
            : conError.length
              ? 'border-b border-alerta/30 bg-alerta-50 px-4 py-2 text-sm text-alerta'
              : 'border-b border-borde bg-realce px-4 py-2 text-sm text-suave'
        }
      >
        {!enLinea ? (
          <>
            <b>Sin conexión.</b> Lo que cargues en los eventos se guarda en este celular y se manda solo cuando vuelva internet.
            {esperando > 0 && <> ({cambios(esperando)} esperando)</>}
          </>
        ) : esperando > 0 ? (
          <>Enviando {cambios(esperando)} guardados sin conexión…</>
        ) : null}
        {conError.length > 0 && (
          <>
            {' '}
            {conError.length === 1 ? '1 cambio no se pudo guardar.' : `${conError.length} cambios no se pudieron guardar.`}{' '}
            <button className="font-semibold underline" onClick={() => setViendo(true)}>
              Ver
            </button>
          </>
        )}
      </div>
      <Ventana abierta={viendo} alCerrar={() => setViendo(false)} titulo="Cambios que no se pudieron guardar">
        {viendo && (
          <div className="space-y-3">
            <p className="text-sm text-suave">
              Estos cambios se cargaron sin conexión, pero al mandarlos la base los rechazó (por ejemplo, porque mientras tanto alguien borró ese dato).
              Revisalos y volvé a cargarlos si hace falta.
            </p>
            <ul className="divide-y divide-borde rounded-lg border border-borde">
              {conError.map((p) => (
                <li key={p.clave} className="space-y-1 px-3 py-2.5">
                  <p className="font-medium">{p.descripcion}</p>
                  <p className="text-xs text-suave">Cargado el {formatoFechaHora(p.creado)}</p>
                  <p className="text-xs text-alerta">{p.error}</p>
                  <button className="text-xs text-suave underline" onClick={() => cola.quitar([p.clave])}>
                    Descartar
                  </button>
                </li>
              ))}
            </ul>
            <Boton variante="secundario" className="w-full" onClick={() => cola.quitar(conError.map((p) => p.clave))}>
              Descartar todos
            </Boton>
          </div>
        )}
      </Ventana>
    </>
  )
}
