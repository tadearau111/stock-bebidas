'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'
import type { Articulo, ArticuloEditable, Movimiento } from './tipos'

// Todas las lecturas y escrituras pasan por acá. En la Fase 5 este es el
// lugar donde se agrega el guardado sin conexión.

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

// ---------------------------------------------------------------- Artículos

export function useArticulos() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['articulos', localId],
    enabled: !!localId,
    queryFn: async () =>
      lanzar(
        await supabase().from('stock_articulos').select('*').eq('local_id', localId).order('nombre'),
      ) as Articulo[],
  })
}

function useRefrescarDeposito() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['articulos'] })
    qc.invalidateQueries({ queryKey: ['movimientos'] })
  }
}

export function useGuardarArticulo() {
  const localId = useLocalId()
  const refrescar = useRefrescarDeposito()
  return useMutation({
    mutationFn: async ({ id, datos }: { id?: string; datos: Partial<ArticuloEditable> & { activo?: boolean } }) => {
      const sb = supabase()
      if (id) {
        lanzar(await sb.from('articulos').update(datos).eq('id', id).select('id').single())
      } else {
        lanzar(await sb.from('articulos').insert({ ...datos, local_id: localId }).select('id').single())
      }
    },
    onSuccess: refrescar,
  })
}

export function useBorrarArticulo() {
  const refrescar = useRefrescarDeposito()
  return useMutation({
    mutationFn: async (id: string) => {
      lanzar(await supabase().from('articulos').delete().eq('id', id))
    },
    onSuccess: refrescar,
  })
}

// ---------------------------------------------------------------- Movimientos

export function useMovimientos(filtro: { articuloId?: string; limite?: number } = {}) {
  const localId = useLocalId()
  const { articuloId, limite = 200 } = filtro
  return useQuery({
    queryKey: ['movimientos', localId, articuloId ?? null, limite],
    enabled: !!localId,
    queryFn: async () => {
      let q = supabase()
        .from('movimientos')
        .select('*, articulo:articulos(nombre, unidad), autor:perfiles(nombre)')
        .eq('local_id', localId)
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false })
        .limit(limite)
      if (articuloId) q = q.eq('articulo_id', articuloId)
      return lanzar(await q) as Movimiento[]
    },
  })
}

export interface NuevoMovimiento {
  articulo_id: string
  tipo: 'ingreso' | 'ajuste'
  cantidad: number
  motivo?: string | null
  fecha?: string
}

export function useCargarMovimientos() {
  const localId = useLocalId()
  const refrescar = useRefrescarDeposito()
  return useMutation({
    mutationFn: async (movs: NuevoMovimiento[]) => {
      const sb = supabase()
      const { data } = await sb.auth.getUser()
      const filas = movs.map((m) => ({
        id: crypto.randomUUID(),
        local_id: localId,
        creado_por: data.user?.id,
        motivo: m.motivo?.trim() || null,
        ...m,
      }))
      lanzar(await sb.from('movimientos').insert(filas))
    },
    onSuccess: refrescar,
  })
}

export function useCorregirMovimiento() {
  const refrescar = useRefrescarDeposito()
  return useMutation({
    mutationFn: async ({ id, cantidad, motivo }: { id: string; cantidad: number; motivo: string | null }) => {
      lanzar(await supabase().from('movimientos').update({ cantidad, motivo }).eq('id', id).select('id').single())
    },
    onSuccess: refrescar,
  })
}

export function useAnularMovimiento() {
  const refrescar = useRefrescarDeposito()
  return useMutation({
    mutationFn: async (id: string) => {
      lanzar(await supabase().from('movimientos').delete().eq('id', id))
    },
    onSuccess: refrescar,
  })
}
