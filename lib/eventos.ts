'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'
import type { DetalleEvento, Evento } from './tipos'

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

// ------------------------------------------------------------------ Lecturas

export function useEventos() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['eventos', localId],
    enabled: !!localId,
    queryFn: async () =>
      lanzar(
        await supabase()
          .from('eventos')
          .select('*')
          .eq('local_id', localId)
          .order('fecha', { ascending: false })
          .order('creado_en', { ascending: false }),
      ) as Evento[],
  })
}

export function useEvento(id: string) {
  return useQuery({
    queryKey: ['evento', id],
    enabled: !!id,
    queryFn: async (): Promise<DetalleEvento | null> => {
      const sb = supabase()
      const [ev, barras, lineas, retiros, abierta, caja, gastos] = await Promise.all([
        sb.from('eventos').select('*').eq('id', id).maybeSingle(),
        sb.from('barras').select('*').eq('evento_id', id).order('orden').order('creado_en'),
        sb
          .from('barra_articulos')
          .select(
            '*, articulo:articulos(nombre, unidad, marca, tamano), reposiciones(id, barra_articulo_id, tipo, cantidad, hora, autor:perfiles(nombre))',
          )
          .eq('evento_id', id),
        sb
          .from('retiros')
          .select('*, articulo:articulos(nombre, unidad), trago:tragos(nombre), autor:perfiles(nombre)')
          .eq('evento_id', id)
          .order('hora', { ascending: false }),
        sb
          .from('bebida_abierta')
          .select('*, articulo:articulos(nombre), autor:perfiles(nombre)')
          .eq('evento_id', id)
          .order('hora', { ascending: false }),
        sb.from('evento_caja').select('*').eq('evento_id', id).maybeSingle(),
        sb.from('evento_gastos').select('*, autor:perfiles(nombre)').eq('evento_id', id).order('hora'),
      ])
      const evento = lanzar(ev)
      if (!evento) return null
      const ls = lanzar(lineas) as DetalleEvento['lineas']
      ls.sort((a, b) => a.articulo.nombre.localeCompare(b.articulo.nombre, 'es'))
      for (const l of ls) l.reposiciones.sort((a, b) => a.hora.localeCompare(b.hora))
      return {
        evento: evento as Evento,
        barras: lanzar(barras) as DetalleEvento['barras'],
        lineas: ls,
        retiros: lanzar(retiros) as DetalleEvento['retiros'],
        bebidaAbierta: lanzar(abierta) as DetalleEvento['bebidaAbierta'],
        caja: lanzar(caja) as DetalleEvento['caja'],
        gastos: lanzar(gastos) as DetalleEvento['gastos'],
      }
    },
  })
}

/** Stock del depósito por artículo (para avisar si no alcanza). */
export function useStockLocal() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['stock-local', localId],
    enabled: !!localId,
    queryFn: async () => {
      const filas = lanzar(await supabase().rpc('stock_del_local', { p_local: localId })) as {
        articulo_id: string
        stock_actual: number
      }[]
      return new Map(filas.map((f) => [f.articulo_id, f.stock_actual]))
    },
  })
}

// ------------------------------------------------------------------ Escrituras

/** Ejecuta un cambio dentro de un evento y refresca todo lo que depende de él. */
export function useCambioEvento(eventoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fn: (sb: ReturnType<typeof supabase>) => Promise<unknown>) => fn(supabase()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['evento', eventoId] })
      qc.invalidateQueries({ queryKey: ['eventos'] })
      qc.invalidateQueries({ queryKey: ['articulos'] })
      qc.invalidateQueries({ queryKey: ['stock-local'] })
    },
  })
}

/** Atajo para que cada operación lance el error si falla. */
export async function ejecutar<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  return lanzar(await p)
}

export interface DatosEvento {
  fecha: string
  nombre: string
  personas: number
  notas: string | null
}

export function useGuardarEvento() {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, datos, copiarDe }: { id?: string; datos: DatosEvento; copiarDe?: string }) => {
      const sb = supabase()
      if (id) {
        await ejecutar(sb.from('eventos').update(datos).eq('id', id).select('id').single())
        return id
      }
      const nuevo = (await ejecutar(sb.from('eventos').insert({ ...datos, local_id: localId }).select('id').single())) as { id: string }

      if (copiarDe) {
        // Copia las barras y qué artículos lleva cada una (sin cantidades)
        const barras = (await ejecutar(sb.from('barras').select('id, nombre, orden').eq('evento_id', copiarDe).order('orden'))) as {
          id: string
          nombre: string
          orden: number
        }[]
        const lineas = (await ejecutar(sb.from('barra_articulos').select('barra_id, articulo_id, articulo:articulos(activo)').eq('evento_id', copiarDe))) as unknown as {
          barra_id: string
          articulo_id: string
          articulo: { activo: boolean } | null
        }[]
        for (const b of barras) {
          const nb = (await ejecutar(
            sb.from('barras').insert({ evento_id: nuevo.id, local_id: localId, nombre: b.nombre, orden: b.orden }).select('id').single(),
          )) as { id: string }
          const filas = lineas
            .filter((l) => l.barra_id === b.id && l.articulo?.activo !== false)
            .map((l) => ({ barra_id: nb.id, evento_id: nuevo.id, local_id: localId, articulo_id: l.articulo_id }))
          if (filas.length) await ejecutar(sb.from('barra_articulos').insert(filas))
        }
      }
      if (!copiarDe) {
        await ejecutar(sb.from('barras').insert({ evento_id: nuevo.id, local_id: localId, nombre: 'Barra 1', orden: 1 }))
      }
      return nuevo.id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['eventos'] })
      qc.invalidateQueries({ queryKey: ['evento', id] })
    },
  })
}

export function useBorrarEvento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => ejecutar(supabase().from('eventos').delete().eq('id', id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eventos'] })
      qc.invalidateQueries({ queryKey: ['articulos'] })
      qc.invalidateQueries({ queryKey: ['stock-local'] })
    },
  })
}

/** Archivar / desarchivar: el evento no se borra, así el stock del depósito no cambia. */
export function useArchivarEvento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archivado }: { id: string; archivado: boolean }) =>
      ejecutar(
        supabase()
          .from('eventos')
          .update({ archivado, archivado_en: archivado ? new Date().toISOString() : null })
          .eq('id', id)
          .select('id')
          .single(),
      ),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['eventos'] })
      qc.invalidateQueries({ queryKey: ['evento', id] })
    },
  })
}
