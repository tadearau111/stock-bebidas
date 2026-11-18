// Cola de cambios guardados en el dispositivo.
//
// Lo que se carga en un evento (barras, reposiciones, retiros, caja, cajeros…)
// se describe como una "operación" simple. Si hay internet se manda en el
// momento; si no hay (o ya hay cambios esperando), queda en esta cola y se
// manda solo, en el mismo orden, cuando vuelve la conexión.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoPapelera } from '../papelera'

/** Tablas de un evento que se pueden cargar sin conexión. */
export type TablaEvento =
  | 'barras'
  | 'barra_articulos'
  | 'reposiciones'
  | 'retiros'
  | 'bebida_abierta'
  | 'evento_gastos'
  | 'evento_cajeros'
  | 'cajero_retiros'

export type Fila = Record<string, unknown>

export type Operacion =
  | { tipo: 'insertar'; tabla: TablaEvento; filas: Fila[]; vista?: Fila[] }
  | { tipo: 'actualizar'; tabla: TablaEvento; id: string; cambios: Fila }
  | { tipo: 'caja'; fila: Fila }
  | { tipo: 'papelera'; papelera: TipoPapelera; id: string }

export interface Pendiente {
  clave: string
  eventoId: string
  usuarioId: string
  /** Para mostrar en la lista de pendientes (ej: "Reposición de 6 Coca Cola") */
  descripcion: string
  op: Operacion
  creado: string
  estado: 'pendiente' | 'enviado' | 'error'
  enviadoEn?: number
  error?: string
}

// ------------------------------------------------------------------ Armar operaciones

/** Tablas con hora: si no se indica, se anota la hora en que se cargó (no la de cuando se sincroniza). */
const CON_HORA = new Set<TablaEvento>(['reposiciones', 'retiros', 'bebida_abierta', 'evento_gastos', 'cajero_retiros'])

const nuevoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

/**
 * Alta de una o varias filas. Cada fila lleva su id desde el dispositivo, así
 * otros cambios hechos sin conexión pueden apuntar a ella (ej: un retiro de un
 * cajero recién creado). `vista` son datos solo para mostrar (ej: el nombre del artículo).
 */
export function insertar(tabla: TablaEvento, filas: Fila | Fila[], vista?: Fila | Fila[]): Operacion & { tipo: 'insertar' } {
  const ahora = new Date().toISOString()
  const lista = (Array.isArray(filas) ? filas : [filas]).map((f) => ({
    id: nuevoId(),
    ...(CON_HORA.has(tabla) ? { hora: ahora } : {}),
    ...f,
  }))
  const v = vista == null ? undefined : Array.isArray(vista) ? vista : lista.map(() => vista)
  return { tipo: 'insertar', tabla, filas: lista, vista: v }
}

export const actualizar = (tabla: TablaEvento, id: string, cambios: Fila): Operacion => ({ tipo: 'actualizar', tabla, id, cambios })
export const guardarCaja = (fila: Fila): Operacion => ({ tipo: 'caja', fila })
export const aPapelera = (papelera: TipoPapelera, id: string): Operacion => ({ tipo: 'papelera', papelera, id })

// ------------------------------------------------------------------ Mandar a la base

interface ErrorBase {
  message?: string
  code?: string
}

/** ¿El error es por falta de conexión (y no un error de la base)? */
export function esErrorDeRed(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const err = e as ErrorBase | null
  const msg = String(err?.message ?? e ?? '')
  return !err?.code && /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet|err_network/i.test(msg)
}

function lanzarSiError(r: { error: unknown }) {
  if (r.error) throw r.error
}

/** Ejecuta una operación en Supabase. Repetirla no duplica nada (por si se cortó justo después de guardar). */
export async function ejecutarOperacion(sb: SupabaseClient, op: Operacion): Promise<void> {
  switch (op.tipo) {
    case 'insertar': {
      const r = await sb.from(op.tabla).insert(op.filas)
      // Ya estaba guardado (se mandó, se cortó la conexión y se vuelve a mandar)
      if (r.error && (r.error as ErrorBase).code === '23505' && String((r.error as ErrorBase).message).includes(`${op.tabla}_pkey`)) return
      return lanzarSiError(r)
    }
    case 'actualizar': {
      const r = await sb.from(op.tabla).update(op.cambios).eq('id', op.id).select('id')
      lanzarSiError(r)
      if (!r.data?.length) throw new Error('No se pudo guardar: ese dato ya no existe (puede que lo hayan borrado).')
      return
    }
    case 'caja': {
      const r = await sb.from('evento_caja').upsert(op.fila, { onConflict: 'evento_id' })
      return lanzarSiError(r)
    }
    case 'papelera': {
      const r = await sb.rpc('mandar_a_papelera', { p_tipo: op.papelera, p_id: op.id })
      // Ya estaba borrado
      if (r.error && /ya no existe/i.test(String((r.error as ErrorBase).message))) return
      return lanzarSiError(r)
    }
  }
}

// ------------------------------------------------------------------ Guardado en el dispositivo

const CLAVE = 'stock-bebidas-cola'
let memoria: Pendiente[] | null = null
const oyentes = new Set<() => void>()

function cargar(): Pendiente[] {
  if (memoria) return memoria
  try {
    memoria = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as Pendiente[]
  } catch {
    memoria = []
  }
  return memoria
}

function guardar(lista: Pendiente[]) {
  memoria = lista
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista))
  } catch {}
  for (const f of oyentes) f()
}

const VACIA: Pendiente[] = []

export const cola = {
  leer: (): Pendiente[] => (typeof window === 'undefined' ? VACIA : cargar()),
  agregar(nuevos: Pendiente[]) {
    guardar([...cargar(), ...nuevos])
  },
  cambiar(clave: string, cambios: Partial<Pendiente>) {
    guardar(cargar().map((p) => (p.clave === clave ? { ...p, ...cambios } : p)))
  },
  quitar(claves: string[]) {
    const fuera = new Set(claves)
    guardar(cargar().filter((p) => !fuera.has(p.clave)))
  },
  suscribir(f: () => void) {
    oyentes.add(f)
    // Otra pestaña cambió la cola
    const alCambiar = (e: StorageEvent) => {
      if (e.key !== CLAVE) return
      memoria = null
      f()
    }
    window.addEventListener('storage', alCambiar)
    return () => {
      oyentes.delete(f)
      window.removeEventListener('storage', alCambiar)
    }
  },
}

export function nuevaClave() {
  return nuevoId()
}
