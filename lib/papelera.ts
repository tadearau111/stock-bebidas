'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'

export type TipoPapelera =
  | 'evento'
  | 'barra'
  | 'linea'
  | 'reposicion'
  | 'retiro'
  | 'bebida_abierta'
  | 'gasto'
  | 'movimiento'
  | 'nota'
  | 'articulo'
  | 'caja_fuerte'
  | 'cajero'
  | 'retiro_cajero'

export interface ItemPapelera {
  id: string
  tipo: TipoPapelera
  registro_id: string
  titulo: string
  detalle: string | null
  evento_id: string | null
  evento_nombre: string | null
  borrado_por: string | null
  borrado_en: string
  expira_en: string
  autor?: { nombre: string } | null
}

/** Días que faltan para que se borre solo. */
export function diasRestantes(expira: string, ahora = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expira).getTime() - ahora.getTime()) / 86_400_000))
}

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

/** Manda algo a la papelera (en vez de borrarlo para siempre). */
export async function mandarAPapelera(tipo: TipoPapelera, id: string) {
  return lanzar(await supabase().rpc('mandar_a_papelera', { p_tipo: tipo, p_id: id })) as string
}

export function usePapelera(habilitada = true) {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['papelera', localId],
    enabled: !!localId && habilitada,
    staleTime: 0,
    queryFn: async () => {
      const sb = supabase()
      await sb.rpc('limpiar_papelera') // lo que pasó los 30 días se borra solo
      return lanzar(
        await sb
          .from('papelera')
          .select('id, tipo, registro_id, titulo, detalle, evento_id, evento_nombre, borrado_por, borrado_en, expira_en, autor:perfiles(nombre)')
          .eq('local_id', localId)
          .order('borrado_en', { ascending: false }),
      ) as unknown as ItemPapelera[]
    },
  })
}

/** Restaurar o borrar cambia muchas cosas (stock, eventos…): se refresca todo. */
function useAccionPapelera<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries() })
}

export const useRestaurar = () => useAccionPapelera(async (id: string) => lanzar(await supabase().rpc('restaurar_de_papelera', { p_id: id })))
export const useBorrarDefinitivo = () => useAccionPapelera(async (id: string) => lanzar(await supabase().rpc('borrar_de_papelera', { p_id: id })))
export function useVaciarPapelera() {
  const localId = useLocalId()
  return useAccionPapelera(async () => lanzar(await supabase().rpc('vaciar_papelera', { p_local: localId })))
}
export const useMandarAPapelera = () => useAccionPapelera(async ({ tipo, id }: { tipo: TipoPapelera; id: string }) => mandarAPapelera(tipo, id))
