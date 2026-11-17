'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { mandarAPapelera } from './papelera'
import { useLocalId } from './sesion'
import type { NotaInfo } from './tipos'

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

export function useNotasInfo() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['notas-info', localId],
    enabled: !!localId,
    queryFn: async () =>
      lanzar(await supabase().from('notas_info').select('*, evento:eventos(nombre)').eq('local_id', localId).order('fecha')) as NotaInfo[],
  })
}

export type DatosNota = Pick<NotaInfo, 'fecha' | 'evento_id' | 'titulo' | 'hora_apertura' | 'hora_cierre' | 'personal' | 'notas'>

export function useGuardarNota() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, datos }: { id?: string; datos: DatosNota }) => {
      const sb = supabase()
      if (id) lanzar(await sb.from('notas_info').update(datos).eq('id', id).select('id').single())
      else lanzar(await sb.from('notas_info').insert({ ...datos, local_id: localId }).select('id').single())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notas-info'] }),
  })
}

export function useBorrarNota() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => mandarAPapelera('nota', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notas-info'] }),
  })
}
