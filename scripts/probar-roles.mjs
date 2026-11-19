// Prueba de los roles de la noche contra el Supabase LOCAL (no se usa en producción).
// Uso: PUBLISHABLE_KEY=... SECRET_KEY=... node scripts/probar-roles.mjs
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
const rol = async (n) => (await servicio.from('roles').select('id').eq('nombre', n).single()).data?.id
ok(!!(await rol('Administrador de la noche')), 'el rol se llama "Administrador de la noche"')
ok(!(await rol('Encargado de la noche')), 'ya no existe "Encargado de la noche"')

// Evento con barra, artículo, caja, gasto, cajero y bebida abierta
const ev = (await admin.from('eventos').insert({ local_id: local, nombre: 'Prueba roles ' + sufijo, fecha: '2026-11-20', personas: 10 }).select('id').single()).data.id
const barra = (await admin.from('barras').insert({ evento_id: ev, nombre: 'Barra 1', orden: 1 }).select('id').single()).data.id
const art = (await admin.from('articulos').select('id').eq('local_id', local).limit(1).single()).data.id
const linea = (await admin.from('barra_articulos').insert({ barra_id: barra, articulo_id: art, stock_inicial: 5 }).select('id').single()).data.id
await admin.from('evento_caja').insert({ evento_id: ev, efectivo_real: 1000 })
const gasto = (await admin.from('evento_gastos').insert({ evento_id: ev, monto: 100, detalle: 'Hielo' }).select('id').single()).data.id
const cajero = (await admin.from('evento_cajeros').insert({ evento_id: ev, nombre: 'Sofía' }).select('id').single()).data.id
await admin.from('bebida_abierta').insert({ evento_id: ev, articulo_id: art, cuartos: 2 })

async function usuario(nombreRol, email) {
  const u = await entrar(email, nombreRol)
  await servicio.from('miembros').insert({ usuario_id: u.id, local_id: local, rol_id: await rol(nombreRol) })
  await admin.from('evento_asignaciones').insert({ evento_id: ev, usuario_id: u.id, local_id: local })
  return u.c
}
const filas = async (c, t) => ((await c.from(t).select('id').eq('evento_id', ev)).data ?? []).length

// ---- Encargado de depósito
const dep = await usuario('Encargado de depósito', `dep-${sufijo}@salon.local`)
ok((await filas(dep, 'barra_articulos')) === 1, 'depósito: ve las barras del evento asignado')
ok(!(await dep.from('reposiciones').insert({ barra_articulo_id: linea, cantidad: 2, tipo: 'detalle' })).error, 'depósito: carga reposiciones')
ok(!(await dep.from('barra_articulos').update({ stock_final: 1 }).eq('id', linea)).error, 'depósito: carga stock final')
ok(((await dep.from('evento_caja').select('evento_id').eq('evento_id', ev)).data ?? []).length === 0, 'depósito: NO ve la caja')
ok((await filas(dep, 'evento_gastos')) === 0, 'depósito: NO ve los gastos')
ok((await filas(dep, 'evento_cajeros')) === 0, 'depósito: NO ve los cajeros')
ok((await filas(dep, 'bebida_abierta')) === 0, 'depósito: NO ve la bebida abierta')
ok(!!(await dep.from('evento_gastos').insert({ evento_id: ev, monto: 5, detalle: 'X' })).error, 'depósito: NO puede cargar gastos')
ok(!!(await dep.from('cajero_retiros').insert({ cajero_id: cajero, monto: 5 })).error, 'depósito: NO puede cargar retiros de cajeros')
ok(!!(await dep.rpc('mandar_a_papelera', { p_tipo: 'gasto', p_id: gasto })).error, 'depósito: NO puede borrar gastos')
ok(((await dep.from('stock_articulos').select('id').eq('local_id', local)).data ?? []).length > 0, 'depósito: ve el depósito general')

// ---- Precios: solo con permiso
await admin.from('articulos').update({ precio_costo: 1234, precio_mayorista: 1500 }).eq('id', art)
const precioDe = async (c) => (await c.from('stock_articulos').select('precio_costo, precio_mayorista').eq('id', art).single()).data
ok((await precioDe(admin))?.precio_costo == 1234, 'admin: ve los precios en el depósito')
const pDep = await precioDe(dep)
ok(pDep && pDep.precio_costo === null && pDep.precio_mayorista === null, 'depósito: ve el artículo pero SIN precios')
ok(!!(await dep.from('articulos').select('precio_costo').eq('id', art)).error, 'depósito: NO puede leer los precios directo de la tabla')
ok(!(await dep.from('articulos').select('id, nombre').eq('id', art)).error, 'depósito: sí lee nombre y datos del artículo')

// ---- Administrador de la noche: todo como antes
const noche = await usuario('Administrador de la noche', `noche-${sufijo}@salon.local`)
ok(((await noche.from('evento_caja').select('evento_id').eq('evento_id', ev)).data ?? []).length === 1, 'noche: ve la caja')
ok((await filas(noche, 'evento_cajeros')) === 1 && (await filas(noche, 'bebida_abierta')) === 1, 'noche: ve cajeros y bebida abierta')
ok(!(await noche.from('cajero_retiros').insert({ cajero_id: cajero, monto: 5 })).error, 'noche: carga retiros de cajeros')

await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev })
