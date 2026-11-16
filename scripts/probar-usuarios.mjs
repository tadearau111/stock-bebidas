// Prueba de usuarios, roles y permisos contra el Supabase LOCAL.
// Uso: PUBLISHABLE_KEY=... SECRET_KEY=... node scripts/probar-usuarios.mjs
import { createClient } from '@supabase/supabase-js'
const URL = 'http://127.0.0.1:54321'
const { PUBLISHABLE_KEY, SECRET_KEY } = process.env
const servicio = createClient(URL, SECRET_KEY, { auth: { persistSession: false } })
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✘ ') + msg); if (!cond) process.exitCode = 1 }
const sufijo = Date.now()

async function entrar(email, nombre) {
  if (nombre) await servicio.auth.admin.createUser({ email, password: 'prueba1234', email_confirm: true, user_metadata: { nombre } })
  const c = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'prueba1234' })
  if (error) throw error
  return { c, id: data.user.id }
}

const admin = await entrar('admin@salon.local')
const local = (await admin.c.rpc('mi_acceso')).data[0].local_id
const { data: roles } = await admin.c.from('roles').select('*')
const rolAdmin = roles.find((r) => r.nombre === 'Administrador')

// 1) Rol nuevo configurable: Encargado de depósito → solo ingresos
const { data: rolDep, error: e1 } = await admin.c.from('roles').insert({ nombre: `Encargado de depósito ${sufijo}` }).select().single()
ok(!e1, 'La administradora crea un rol nuevo')
await admin.c.from('rol_permisos').insert([{ rol_id: rolDep.id, permiso_codigo: 'deposito.ver' }, { rol_id: rolDep.id, permiso_codigo: 'ingresos.cargar' }])
const dep = await entrar(`dep${sufijo}@prueba.local`, 'Depósito')
await admin.c.from('miembros').insert({ usuario_id: dep.id, local_id: local, rol_id: rolDep.id })
const { data: art } = await admin.c.from('articulos').select('id').eq('nombre', 'Miller').single()
const i1 = await dep.c.from('movimientos').insert({ articulo_id: art.id, tipo: 'ingreso', cantidad: 6, local_id: local, creado_por: dep.id })
ok(!i1.error, 'El encargado de depósito carga un ingreso ' + (i1.error?.message ?? ''))
const i2 = await dep.c.from('movimientos').insert({ articulo_id: art.id, tipo: 'ajuste', cantidad: -1, motivo: 'x', local_id: local, creado_por: dep.id })
ok(!!i2.error, 'Pero no puede hacer ajustes')
const i3 = await dep.c.from('eventos').select('id')
ok(i3.data.length === 0, 'Ni ve eventos')
const i4 = await dep.c.from('articulos').update({ precio_venta: 1 }).eq('id', art.id).select()
ok(i4.data.length === 0, 'Ni toca precios')
// Se le suma un permiso y funciona al instante
await admin.c.from('rol_permisos').insert({ rol_id: rolDep.id, permiso_codigo: 'deposito.ajustar' })
const i5 = await dep.c.from('movimientos').insert({ articulo_id: art.id, tipo: 'ajuste', cantidad: -1, motivo: 'rotura', local_id: local, creado_por: dep.id })
ok(!i5.error, 'Al sumarle el permiso de ajustes, ya puede ajustar')

// 2) Protecciones
const p1 = await admin.c.from('rol_permisos').delete().eq('rol_id', rolAdmin.id).eq('permiso_codigo', 'usuarios.gestionar')
ok(!!p1.error, 'No se le pueden quitar permisos al Administrador')
const p2 = await admin.c.from('roles').delete().eq('id', rolAdmin.id)
ok(!!p2.error, 'No se puede borrar el rol Administrador')
const p3 = await admin.c.from('miembros').update({ rol_id: rolDep.id }).eq('usuario_id', admin.id).eq('local_id', local)
ok(!!p3.error && /administrador/i.test(p3.error.message), 'La única administradora no puede sacarse el rol')
const p4 = await admin.c.from('perfiles').update({ activo: false }).eq('id', admin.id)
ok(!!p4.error, 'La única administradora no puede desactivarse')
const p5 = await dep.c.from('roles').insert({ nombre: 'hack' })
ok(!!p5.error, 'Un usuario sin permiso no puede crear roles')
const p6 = await dep.c.from('miembros').update({ rol_id: rolAdmin.id }).eq('usuario_id', dep.id).select()
ok((p6.data ?? []).length === 0, 'Nadie puede darse a sí mismo el rol de Administrador')
const p7 = await admin.c.from('roles').delete().eq('id', rolDep.id)
ok(!!p7.error, 'No se puede borrar un rol que tiene usuarios')

// 3) Desactivar
await admin.c.from('perfiles').update({ activo: false }).eq('id', dep.id)
const { data: accesoDep } = await dep.c.rpc('mi_acceso')
const d1 = await dep.c.from('movimientos').insert({ articulo_id: art.id, tipo: 'ingreso', cantidad: 6, local_id: local, creado_por: dep.id })
ok(accesoDep.length === 0 && !!d1.error, 'Un usuario desactivado pierde el acceso al instante')

// 4) Historial
const { data: h } = await admin.c.from('auditoria').select('*').eq('tabla', 'perfiles').eq('registro_id', dep.id).order('id', { ascending: false }).limit(1)
ok(h[0]?.cambios?.activo?.despues === false && h[0].usuario_id === admin.id, 'El historial registra quién desactivó al usuario')
const { data: h2 } = await admin.c.from('auditoria').select('*').eq('tabla', 'rol_permisos').eq('registro_id', rolDep.id)
ok(h2.length >= 3, 'El historial registra los cambios de permisos')
const { data: h3 } = await dep.c.from('auditoria').select('id')
ok(h3.length === 0, 'Sin permiso no se ve el historial')

// Limpieza
await servicio.from('movimientos').delete().eq('creado_por', dep.id)
await servicio.auth.admin.deleteUser(dep.id)
await servicio.from('roles').delete().eq('id', rolDep.id)
