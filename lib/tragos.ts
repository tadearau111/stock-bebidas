'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'
import type { Trago } from './tipos'

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

export function useTragos() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['tragos', localId],
    enabled: !!localId,
    queryFn: async () => lanzar(await supabase().from('tragos').select('*').eq('local_id', localId).order('nombre')) as Trago[],
  })
}

export function useGuardarTrago() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, activo }: { id?: string; nombre?: string; activo?: boolean }) => {
      const sb = supabase()
      if (id) return lanzar(await sb.from('tragos').update({ nombre, activo }).eq('id', id).select().single()) as Trago
      return lanzar(await sb.from('tragos').insert({ local_id: localId, nombre }).select().single()) as Trago
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tragos'] }),
  })
}
