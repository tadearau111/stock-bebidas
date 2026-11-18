'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { armarLibro, encadenarMeses, mesActual, resumirPorMes } from './calculos/cajaFuerte'
import type { AporteEvento, MovimientoManual, RenglonResumen, ResumenMes } from './calculos/cajaFuerte'
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
      const eventos = (
        lanzar(ev) as { evento_id: string; fecha: string; nombre: string; efectivo: number; gastos: number; gastos_detalle?: { detalle: string; monto: number }[] }[]
      ).map((e) => ({
        ...e,
        efectivo: Number(e.efectivo),
        gastos: Number(e.gastos),
        gastos_detalle: (e.gastos_detalle ?? []).map((g) => ({ detalle: g.detalle, monto: Number(g.monto) })),
      })) as AporteEvento[]
      type Fila = Omit<MovimientoManual, 'autor'> & { autor?: { nombre: string } | null }
      const manuales = (lanzar(mov) as Fila[]).map((m) => ({
        id: m.id,
        tipo: m.tipo,
        monto: Number(m.monto),
        detalle: m.detalle,
        fecha: aLocal(m.fecha),
        persona: m.persona ?? null,
        horas: m.horas != null ? Number(m.horas) : null,
        autor: m.autor?.nombre ?? null,
      })) as MovimientoManual[]
      return { eventos, manuales }
    },
  })
}

export function useMovimientoCajaFuerte() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: { id?: string; tipo: MovimientoManual['tipo']; monto: number; detalle: string; fecha: string; persona?: string | null; horas?: number | null }) => {
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

// ------------------------------------------------------------------ Cierres mensuales (no se borran)

export interface CierreMes {
  id: string
  anio: number
  mes: number
  saldo_inicial: number
  efectivo: number
  gastos: number
  retiros: number
  ingresos: number
  pagos: number
  saldo_final: number
  renglones: RenglonResumen[]
  cerrado_en: string
  actualizado_en: string
}

export function useCierres(habilitada = true) {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['caja-fuerte-cierres', localId],
    enabled: !!localId && habilitada,
    queryFn: async () => {
      const filas = lanzar(await supabase().from('caja_fuerte_cierres').select('*').eq('local_id', localId).order('anio').order('mes')) as CierreMes[]
      const num = (v: unknown) => Number(v)
      return filas.map((c) => ({
        ...c,
        saldo_inicial: num(c.saldo_inicial),
        efectivo: num(c.efectivo),
        gastos: num(c.gastos),
        retiros: num(c.retiros),
        ingresos: num(c.ingresos),
        pagos: num(c.pagos ?? 0),
        saldo_final: num(c.saldo_final),
      }))
    },
  })
}

/** Guarda (o actualiza) el resumen fijo de un mes terminado. */
export function useGuardarCierre() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ resumen, id }: { resumen: ResumenMes; id?: string }) => {
      const { clave: _c, ...datos } = resumen
      void _c
      const sb = supabase()
      if (id) lanzar(await sb.from('caja_fuerte_cierres').update(datos).eq('id', id).select('id').single())
      else lanzar(await sb.from('caja_fuerte_cierres').insert({ ...datos, local_id: localId }).select('id').single())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caja-fuerte-cierres'] }),
  })
}

/**
 * Caja fuerte completa: libro, resúmenes guardados y meses encadenados
 * (cada mes arranca con el saldo con que cerró el anterior; manda lo guardado).
 * Cuando un mes terminó y todavía no tiene su resumen guardado, lo guarda solo.
 */
export function useCadenaCajaFuerte(habilitada = true) {
  const { data, isPending, error } = useCajaFuerte(habilitada)
  const { data: cierres } = useCierres(habilitada)
  const guardarCierre = useGuardarCierre()
  const intentados = useRef(new Set<string>())
  const actual = mesActual()

  const libro = useMemo(() => (data ? armarLibro(data.eventos, data.manuales) : null), [data])
  const cadena = useMemo(() => (libro && cierres ? encadenarMeses(resumirPorMes(libro), cierres) : null), [libro, cierres])

  useEffect(() => {
    if (!cadena) return
    for (const m of cadena.meses) {
      if (m.clave >= actual || m.guardado || intentados.current.has(m.clave)) continue
      intentados.current.add(m.clave)
      guardarCierre.mutate({ resumen: m.vivo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadena, actual])

  return { data, libro, cierres, cadena, guardarCierre, isPending: isPending || (!!data && !cierres), error }
}
