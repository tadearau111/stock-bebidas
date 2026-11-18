'use client'

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { supabase } from '../supabase/cliente'
import { mensajeError } from '../formato'
import { useSesion } from '../sesion'
import { cola, ejecutarOperacion, esErrorDeRed, nuevaClave, type Operacion, type Pendiente } from './cola'

const VACIA: Pendiente[] = []

/** Todos los cambios guardados en el dispositivo (se actualiza solo). */
export function usePendientes(): Pendiente[] {
  return useSyncExternalStore(cola.suscribir, cola.leer, () => VACIA)
}

let enCurso: Promise<void> | null = null

/**
 * Manda a la base, en orden, los cambios que esperan en la cola.
 * Si se corta la conexión, para y sigue la próxima vez. Si la base rechaza
 * un cambio (por ejemplo, porque ya no existe), queda marcado con el error.
 */
export function sincronizar(qc: QueryClient, usuarioId: string | undefined): Promise<void> {
  if (!usuarioId) return Promise.resolve()
  if (enCurso) return enCurso
  enCurso = (async () => {
    const eventos = new Set<string>()
    try {
      for (const p of cola.leer()) {
        if (p.estado !== 'pendiente' || p.usuarioId !== usuarioId) continue
        try {
          await ejecutarOperacion(supabase(), p.op)
          cola.cambiar(p.clave, { estado: 'enviado', enviadoEn: Date.now() })
          eventos.add(p.eventoId)
        } catch (e) {
          if (esErrorDeRed(e)) break
          cola.cambiar(p.clave, { estado: 'error', error: mensajeError(e) })
          eventos.add(p.eventoId)
        }
      }
    } finally {
      enCurso = null
      for (const id of eventos) qc.invalidateQueries({ queryKey: ['evento', id], refetchType: 'all' })
      if (eventos.size) {
        qc.invalidateQueries({ queryKey: ['eventos'] })
        qc.invalidateQueries({ queryKey: ['stock-local'] })
        qc.invalidateQueries({ queryKey: ['articulos'] })
      }
    }
  })()
  return enCurso
}

/**
 * Los cambios ya enviados se siguen mostrando hasta que los datos del evento
 * se vuelven a leer de la base (así no "desaparecen" un instante).
 */
export function limpiarEnviados(eventoId: string, leidoEn: number) {
  const listos = cola.leer().filter((p) => p.eventoId === eventoId && p.estado === 'enviado' && (p.enviadoEn ?? 0) < leidoEn)
  if (listos.length) cola.quitar(listos.map((p) => p.clave))
}

/**
 * Para guardar lo que se carga en un evento. Con internet se manda en el momento;
 * sin internet (o si ya hay cambios esperando) queda guardado en el dispositivo
 * y se manda solo cuando vuelve la conexión.
 */
export function useCargaEvento(eventoId: string) {
  const qc = useQueryClient()
  const { session } = useSesion()
  const usuarioId = session?.user.id
  const [guardando, setGuardando] = useState(false)

  const guardar = useCallback(
    async (descripcion: string, ops: Operacion[]): Promise<{ sinConexion: boolean }> => {
      if (!usuarioId) throw new Error('Tu sesión se cerró. Volvé a entrar.')
      const encolar = (lista: Operacion[]) =>
        cola.agregar(
          lista.map((op) => ({
            clave: nuevaClave(),
            eventoId,
            usuarioId,
            descripcion,
            op,
            creado: new Date().toISOString(),
            estado: 'pendiente' as const,
          })),
        )

      const hayEsperando = cola.leer().some((p) => p.estado === 'pendiente' && p.usuarioId === usuarioId)
      if (hayEsperando || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        encolar(ops)
        void sincronizar(qc, usuarioId)
        return { sinConexion: true }
      }

      setGuardando(true)
      try {
        for (let i = 0; i < ops.length; i++) {
          try {
            await ejecutarOperacion(supabase(), ops[i])
          } catch (e) {
            if (esErrorDeRed(e)) {
              encolar(ops.slice(i))
              return { sinConexion: true }
            }
            throw e
          }
        }
        return { sinConexion: false }
      } finally {
        setGuardando(false)
        qc.invalidateQueries({ queryKey: ['evento', eventoId] })
        qc.invalidateQueries({ queryKey: ['eventos'] })
        qc.invalidateQueries({ queryKey: ['stock-local'] })
        qc.invalidateQueries({ queryKey: ['articulos'] })
      }
    },
    [eventoId, qc, usuarioId],
  )

  return { guardar, guardando }
}
