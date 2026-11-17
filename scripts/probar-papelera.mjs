// Prueba de la papelera contra el Supabase LOCAL (no se usa en producción).
// Uso: PUBLISHABLE_KEY=... SECRET_KEY=... node scripts/probar-papelera.mjs
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

const { c: admin, id: adminId } = await entrar('admin@salon.local')
const local = (await admin.rpc('mi_acceso')).data[0].local_id
const stock = async (id) => (await admin.from('stock_articulos').select('stock_actual').eq('id', id).single()).data.stock_actual

// Datos: artículo con 100, evento con barra, línea, reposición, retiro, bebida abierta, caja y gasto
const { data: art } = await admin.from('articulos').insert({ local_id: local, nombre: `Papelera ${sufijo}` }).select().single()
await admin.from('movimientos').insert({ articulo_id: art.id, tipo: 'ingreso', cantidad: 100, local_id: local, creado_por: adminId })
const { data: ev } = await admin.from('eventos').insert({ local_id: local, fecha: '2026-12-01', nombre: `Evento papelera ${sufijo}`, personas: 50 }).select().single()
const { data: barra } = await admin.from('barras').insert({ evento_id: ev.id, local_id: local, nombre: 'Barra 1' }).select().single()
const { data: lin } = await admin.from('barra_articulos').insert({ barra_id: barra.id, evento_id: ev.id, local_id: local, articulo_id: art.id, stock_inicial: 20, stock_final: 5 }).select().single()
const { data: repo } = await admin.from('reposiciones').insert({ barra_articulo_id: lin.id, evento_id: ev.id, local_id: local, articulo_id: art.id, cantidad: 10 }).select().single()
await admin.from('retiros').insert({ barra_id: barra.id, evento_id: ev.id, local_id: local, articulo_id: art.id, tipo: 'personal', cantidad: 2, retirado_por: 'Juan' })
await admin.from('bebida_abierta').insert({ evento_id: ev.id, local_id: local, articulo_id: art.id, cuartos: 2 })
await admin.from('evento_caja').insert({ evento_id: ev.id, local_id: local, efectivo_real: 1000 })
await admin.from('evento_gastos').insert({ evento_id: ev.id, local_id: local, monto: 50, detalle: 'Hielo' })
ok((await stock(art.id)) === 75, 'Depósito: 100 − consumido 25 = 75')

// 1) Una reposición a la papelera y de vuelta
const r1 = await admin.rpc('mandar_a_papelera', { p_tipo: 'reposicion', p_id: repo.id })
ok(!r1.error, 'La reposición va a la papelera ' + (r1.error?.message ?? ''))
ok((await stock(art.id)) === 85, 'Sin la reposición, el depósito sube a 85')
const res1 = await admin.rpc('restaurar_de_papelera', { p_id: r1.data })
ok(!res1.error, 'Se restaura la reposición ' + (res1.error?.message ?? ''))
ok((await stock(art.id)) === 75, 'Y el depósito vuelve a 75')

// 2) El evento entero a la papelera
const r2 = await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev.id })
ok(!r2.error, 'El evento va a la papelera ' + (r2.error?.message ?? ''))
ok((await admin.from('eventos').select('id').eq('id', ev.id)).data.length === 0, 'El evento ya no está')
ok((await stock(art.id)) === 100, 'Mientras está en la papelera, lo consumido vuelve al depósito (100)')
const { data: item } = await admin.from('papelera').select('*').eq('id', r2.data).single()
ok(item.titulo === ev.nombre && item.evento_nombre === ev.nombre, 'La papelera muestra el nombre del evento')
ok(Math.round((new Date(item.expira_en) - new Date(item.borrado_en)) / 86400000) === 30, 'Se guarda 30 días')

const res2 = await admin.rpc('restaurar_de_papelera', { p_id: r2.data })
ok(!res2.error, 'Se restaura el evento ' + (res2.error?.message ?? ''))
ok((await stock(art.id)) === 75, 'Al restaurarlo, el depósito vuelve a 75')
const cuenta = async (t) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('evento_id', ev.id)).count
ok((await cuenta('barras')) === 1 && (await cuenta('barra_articulos')) === 1 && (await cuenta('reposiciones')) === 1, 'Vuelven la barra, el artículo y la reposición')
ok((await cuenta('retiros')) === 1 && (await cuenta('bebida_abierta')) === 1 && (await cuenta('evento_gastos')) === 1, 'Vuelven el retiro, la bebida abierta y el gasto')
ok((await admin.from('evento_caja').select('efectivo_real').eq('evento_id', ev.id).single()).data?.efectivo_real === 1000, 'Vuelve la caja con sus montos')
ok((await admin.from('papelera').select('id').eq('id', r2.data)).data.length === 0, 'Y sale de la papelera')

// 3) Restaurar algo cuyo "padre" está borrado → mensaje claro
const r3 = await admin.rpc('mandar_a_papelera', { p_tipo: 'reposicion', p_id: repo.id })
const r4 = await admin.rpc('mandar_a_papelera', { p_tipo: 'linea', p_id: lin.id })
const res3 = await admin.rpc('restaurar_de_papelera', { p_id: r3.data })
ok(!!res3.error && /Restaurá eso primero/.test(res3.error.message), 'Si se borró lo que lo contenía, avisa que se restaure primero eso')
await admin.rpc('restaurar_de_papelera', { p_id: r4.data })
const res4 = await admin.rpc('restaurar_de_papelera', { p_id: r3.data })
ok(!res4.error, 'Restaurando primero el artículo de barra, después la reposición vuelve')

// 4) Permisos: un encargado puede mandar sus cargas a la papelera pero no ver ni restaurar
const { data: rolEnc } = await servicio.from('roles').select('id').eq('nombre', 'Encargado de la noche').single()
const enc = await entrar(`pap${sufijo}@prueba.local`, 'Encargado papelera')
await servicio.from('miembros').insert({ usuario_id: enc.id, local_id: local, rol_id: rolEnc.id })
await admin.from('evento_asignaciones').insert({ evento_id: ev.id, usuario_id: enc.id, local_id: local })
const { data: ret } = await admin.from('retiros').select('id').eq('evento_id', ev.id).single()
const e1 = await enc.c.rpc('mandar_a_papelera', { p_tipo: 'retiro', p_id: ret.id })
ok(!e1.error, 'El encargado manda un retiro a la papelera ' + (e1.error?.message ?? ''))
const e2 = await enc.c.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev.id })
ok(!!e2.error, 'Pero no puede mandar el evento entero')
ok((await enc.c.from('papelera').select('id')).data.length === 0, 'Y no ve la papelera')
const e3 = await enc.c.rpc('restaurar_de_papelera', { p_id: e1.data })
ok(!!e3.error, 'Ni puede restaurar')
ok(!(await admin.rpc('restaurar_de_papelera', { p_id: e1.data })).error, 'La administradora sí lo restaura')

// 5) Borrar definitivamente y vencidos
const r5 = await admin.rpc('mandar_a_papelera', { p_tipo: 'gasto', p_id: (await admin.from('evento_gastos').select('id').eq('evento_id', ev.id).single()).data.id })
await admin.rpc('borrar_de_papelera', { p_id: r5.data })
ok((await admin.from('papelera').select('id').eq('id', r5.data)).data.length === 0, 'Borrar definitivamente lo saca de la papelera')
const r6 = await admin.rpc('mandar_a_papelera', { p_tipo: 'retiro', p_id: ret.id })
await servicio.from('papelera').update({ expira_en: new Date(Date.now() - 1000).toISOString() }).eq('id', r6.data)
await admin.rpc('limpiar_papelera')
ok((await admin.from('papelera').select('id').eq('id', r6.data)).data.length === 0, 'Lo que pasó los 30 días se borra solo')
const an = await admin.from('papelera').insert({ local_id: local, tipo: 'x', registro_id: ev.id, titulo: 'x', datos: [] })
ok(!!an.error, 'Nadie puede escribir la papelera a mano')

// Limpieza
await servicio.from('eventos').delete().eq('id', ev.id)
await servicio.from('movimientos').delete().eq('articulo_id', art.id)
await servicio.from('articulos').delete().eq('id', art.id)
await servicio.from('papelera').delete().eq('local_id', local)
await servicio.auth.admin.deleteUser(enc.id)
