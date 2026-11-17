'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'
import type { Proveedor } from './tipos'

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

export function useProveedores() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['proveedores', localId],
    enabled: !!localId,
    queryFn: async () => lanzar(await supabase().from('proveedores').select('*').eq('local_id', localId).order('nombre')) as Proveedor[],
  })
}

export function useGuardarProveedor() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, activo }: { id?: string; nombre?: string; activo?: boolean }) => {
      const sb = supabase()
      if (id) return lanzar(await sb.from('proveedores').update({ nombre, activo }).eq('id', id).select().single()) as Proveedor
      return lanzar(await sb.from('proveedores').insert({ local_id: localId, nombre }).select().single()) as Proveedor
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
  })
}
