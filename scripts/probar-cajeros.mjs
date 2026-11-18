// Prueba de cajeros y retiros contra el Supabase LOCAL (no se usa en producción).
// Uso: PUBLISHABLE_KEY=... SECRET_KEY=... node scripts/probar-cajeros.mjs
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

const { c: admin } = await entrar('admin@salon.local')
const local = (await admin.rpc('mi_acceso')).data[0].local_id
const ev = (await admin.from('eventos').insert({ local_id: local, nombre: 'Prueba cajeros ' + sufijo, fecha: '2026-11-20', personas: 10 }).select('id').single()).data.id

const caj = (await admin.from('evento_cajeros').insert({ evento_id: ev, nombre: 'Sofía' }).select('*').single()).data
ok(caj?.local_id === local, 'el cajero toma el local del evento')
const r1 = (await admin.from('cajero_retiros').insert({ cajero_id: caj.id, monto: 100000 }).select('*').single()).data
ok(r1?.evento_id === ev, 'el retiro toma el evento de su cajero')
ok((await admin.from('cajero_retiros').insert({ cajero_id: caj.id, monto: 0 })).error, 'no se puede cargar un retiro de $ 0')

// Encargado de la noche: sin asignar no ve ni carga; asignado sí
const rolEnc = (await servicio.from('roles').select('id').eq('nombre', 'Encargado de la noche').single()).data.id
const { c: enc, id: encId } = await entrar(`enc-caj-${sufijo}@salon.local`, 'Encargado prueba')
await servicio.from('miembros').insert({ usuario_id: encId, local_id: local, rol_id: rolEnc })
ok(((await enc.from('evento_cajeros').select('id').eq('evento_id', ev)).data ?? []).length === 0, 'encargado sin asignar no ve los cajeros')
ok((await enc.from('cajero_retiros').insert({ cajero_id: caj.id, monto: 5000 })).error, 'encargado sin asignar no puede cargar retiros')
await admin.from('evento_asignaciones').insert({ evento_id: ev, usuario_id: encId, local_id: local })
ok(!(await enc.from('cajero_retiros').insert({ cajero_id: caj.id, monto: 5000 })).error, 'encargado asignado sí puede cargar retiros')

// Papelera: retiro, cajero y evento completo
const total = async () => ((await admin.from('cajero_retiros').select('monto').eq('evento_id', ev)).data ?? []).reduce((t, r) => t + Number(r.monto), 0)
const p1 = (await admin.rpc('mandar_a_papelera', { p_tipo: 'retiro_cajero', p_id: r1.id })).data
ok(await total() === 5000, 'borrar un retiro lo saca')
ok(!(await admin.rpc('restaurar_de_papelera', { p_id: p1 })).error && (await total()) === 105000, 'restaurar el retiro lo vuelve a poner')
const p2 = (await admin.rpc('mandar_a_papelera', { p_tipo: 'cajero', p_id: caj.id })).data
ok(await total() === 0, 'borrar el cajero se lleva sus retiros')
ok(!(await admin.rpc('restaurar_de_papelera', { p_id: p2 })).error && (await total()) === 105000, 'restaurar el cajero vuelve con sus retiros')
const p3 = (await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev })).data
ok(!(await admin.rpc('restaurar_de_papelera', { p_id: p3 })).error && (await total()) === 105000, 'borrar y restaurar el evento conserva cajeros y retiros')

await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev })
