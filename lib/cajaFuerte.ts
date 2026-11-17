'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AporteEvento, MovimientoManual } from './calculos/cajaFuerte'
import { mandarAPapelera } from './papelera'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

/** ISO (UTC) → "AAAA-MM-DDTHH:mm:ss" en hora local, para ordenar junto a las fechas de los eventos. */
function aLocal(iso: string) {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 19)
}

export function useCajaFuerte(habilitada = true) {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['caja-fuerte', localId],
    enabled: !!localId && habilitada,
    queryFn: async () => {
      const sb = supabase()
      const [ev, mov] = await Promise.all([
        sb.rpc('caja_fuerte_eventos', { p_local: localId }),
        sb.from('caja_fuerte_movimientos').select('*, autor:perfiles(nombre)').eq('local_id', localId).order('fecha'),
      ])
      const eventos = (lanzar(ev) as { evento_id: string; fecha: string; nombre: string; efectivo: number; gastos: number }[]).map((e) => ({
        ...e,
        efectivo: Number(e.efectivo),
        gastos: Number(e.gastos),
      })) as AporteEvento[]
      const manuales = (lanzar(mov) as { id: string; tipo: 'retiro' | 'ingreso'; monto: number; detalle: string; fecha: string; autor?: { nombre: string } | null }[]).map(
        (m) => ({ id: m.id, tipo: m.tipo, monto: Number(m.monto), detalle: m.detalle, fecha: aLocal(m.fecha), autor: m.autor?.nombre ?? null }),
      ) as MovimientoManual[]
      return { eventos, manuales }
    },
  })
}

export function useMovimientoCajaFuerte() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: { id?: string; tipo: 'retiro' | 'ingreso'; monto: number; detalle: string; fecha: string }) => {
      const sb = supabase()
      const { id, ...datos } = m
      if (id) lanzar(await sb.from('caja_fuerte_movimientos').update(datos).eq('id', id).select('id').single())
      else lanzar(await sb.from('caja_fuerte_movimientos').insert({ ...datos, local_id: localId }).select('id').single())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caja-fuerte'] }),
  })
}

export function useBorrarMovimientoCajaFuerte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => mandarAPapelera('caja_fuerte', id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
      qc.invalidateQueries({ queryKey: ['papelera'] })
    },
  })
}
