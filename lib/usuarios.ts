'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase/cliente'
import { useLocalId } from './sesion'

function lanzar<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

export interface UsuarioLocal {
  usuario_id: string
  nombre: string
  email: string | null
  perfil_activo: boolean
  rol_id: string
  rol: string
  miembro_activo: boolean
  creado_en: string
}

export interface Rol {
  id: string
  nombre: string
  descripcion: string | null
  es_sistema: boolean
  permisos: string[]
}

export interface PermisoDef {
  codigo: string
  descripcion: string
  grupo: string
  orden: number
}

// ------------------------------------------------------------------ Lecturas

export function useUsuarios() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['usuarios', localId],
    enabled: !!localId,
    queryFn: async () => lanzar(await supabase().rpc('usuarios_del_local', { p_local: localId })) as UsuarioLocal[],
  })
}

/** Nombres de todos los usuarios del local (para el historial). */
export function useNombresUsuarios() {
  const localId = useLocalId()
  return useQuery({
    queryKey: ['nombres-usuarios', localId],
    enabled: !!localId,
    queryFn: async () => {
      const filas = lanzar(await supabase().rpc('nombres_usuarios', { p_local: localId })) as { usuario_id: string; nombre: string }[]
      return new Map(filas.map((f) => [f.usuario_id, f.nombre]))
    },
  })
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const sb = supabase()
      const [roles, rp] = await Promise.all([
        sb.from('roles').select('id, nombre, descripcion, es_sistema').order('es_sistema', { ascending: false }).order('nombre'),
        sb.from('rol_permisos').select('rol_id, permiso_codigo'),
      ])
      const permisos = lanzar(rp) as { rol_id: string; permiso_codigo: string }[]
      return (lanzar(roles) as Omit<Rol, 'permisos'>[]).map((r) => ({
        ...r,
        permisos: permisos.filter((p) => p.rol_id === r.id).map((p) => p.permiso_codigo),
      })) as Rol[]
    },
  })
}

export function usePermisosDisponibles() {
  return useQuery({
    queryKey: ['permisos'],
    queryFn: async () => lanzar(await supabase().from('permisos').select('*').order('orden')) as PermisoDef[],
  })
}

export function useAsignaciones(usuarioId: string) {
  return useQuery({
    queryKey: ['asignaciones', usuarioId],
    enabled: !!usuarioId,
    queryFn: async () => {
      const filas = lanzar(await supabase().from('evento_asignaciones').select('evento_id').eq('usuario_id', usuarioId)) as { evento_id: string }[]
      return new Set(filas.map((f) => f.evento_id))
    },
  })
}

// ------------------------------------------------------------------ Escrituras

/** Llama al servidor para lo que necesita la clave secreta (crear, contraseña, activar). */
async function llamarServidor(cuerpo: Record<string, unknown>) {
  const { data } = await supabase().auth.getSession()
  const token = data.session?.access_token
  const r = await fetch('/api/usuarios', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(cuerpo),
  })
  const json = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(json.error ?? 'No se pudo completar la operación.')
  return json
}

function useRefrescarUsuarios() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['usuarios'] })
    qc.invalidateQueries({ queryKey: ['nombres-usuarios'] })
    qc.invalidateQueries({ queryKey: ['acceso'] })
  }
}

export function useCrearUsuario() {
  const localId = useLocalId()
  const refrescar = useRefrescarUsuarios()
  return useMutation({
    mutationFn: (d: { email: string; nombre: string; clave: string; rol_id: string }) => llamarServidor({ accion: 'crear', local_id: localId, ...d }),
    onSuccess: refrescar,
  })
}

export function useCambiarClave() {
  const localId = useLocalId()
  return useMutation({
    mutationFn: (d: { usuario_id: string; clave: string }) => llamarServidor({ accion: 'clave', local_id: localId, ...d }),
  })
}

export function useActivarUsuario() {
  const localId = useLocalId()
  const refrescar = useRefrescarUsuarios()
  return useMutation({
    mutationFn: (d: { usuario_id: string; activo: boolean }) => llamarServidor({ accion: 'activo', local_id: localId, ...d }),
    onSuccess: refrescar,
  })
}

export function useEditarUsuario() {
  const localId = useLocalId()
  const refrescar = useRefrescarUsuarios()
  return useMutation({
    mutationFn: async ({ usuario_id, nombre, rol_id }: { usuario_id: string; nombre?: string; rol_id?: string }) => {
      const sb = supabase()
      if (nombre != null) lanzar(await sb.from('perfiles').update({ nombre }).eq('id', usuario_id).select('id').single())
      if (rol_id) lanzar(await sb.from('miembros').update({ rol_id }).eq('usuario_id', usuario_id).eq('local_id', localId).select('usuario_id').single())
    },
    onSuccess: refrescar,
  })
}

export function useAsignarEvento(usuarioId: string) {
  const localId = useLocalId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ eventoId, asignado }: { eventoId: string; asignado: boolean }) => {
      const sb = supabase()
      if (asignado) lanzar(await sb.from('evento_asignaciones').insert({ evento_id: eventoId, usuario_id: usuarioId, local_id: localId }))
      else lanzar(await sb.from('evento_asignaciones').delete().eq('evento_id', eventoId).eq('usuario_id', usuarioId))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['asignaciones', usuarioId] }),
  })
}

/** Marca o desmarca un evento al instante en pantalla; si falla al guardar, vuelve atrás. */
export function useMarcarEvento(usuarioId: string) {
  const qc = useQueryClient()
  const asignar = useAsignarEvento(usuarioId)
  return async (eventoId: string, asignado: boolean) => {
    const clave = ['asignaciones', usuarioId]
    const anterior = qc.getQueryData<Set<string>>(clave)
    const nuevo = new Set(anterior)
    if (asignado) nuevo.add(eventoId)
    else nuevo.delete(eventoId)
    qc.setQueryData(clave, nuevo)
    try {
      await asignar.mutateAsync({ eventoId, asignado })
    } catch (e) {
      qc.setQueryData(clave, anterior)
      throw e
    }
  }
}

export function useGuardarRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, descripcion }: { id?: string; nombre: string; descripcion: string | null }) => {
      const sb = supabase()
      if (id) lanzar(await sb.from('roles').update({ nombre, descripcion }).eq('id', id).select('id').single())
      else lanzar(await sb.from('roles').insert({ nombre, descripcion }).select('id').single())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useBorrarRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => lanzar(await supabase().from('roles').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useCambiarPermiso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ rolId, codigo, activo }: { rolId: string; codigo: string; activo: boolean }) => {
      const sb = supabase()
      if (activo) lanzar(await sb.from('rol_permisos').insert({ rol_id: rolId, permiso_codigo: codigo }))
      else lanzar(await sb.from('rol_permisos').delete().eq('rol_id', rolId).eq('permiso_codigo', codigo))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['acceso'] })
    },
  })
}
