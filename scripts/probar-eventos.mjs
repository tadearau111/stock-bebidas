// Prueba de eventos contra el Supabase LOCAL (no se usa en producción).
// Uso: PUBLISHABLE_KEY=... SECRET_KEY=... node scripts/probar-eventos.mjs
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
const { data: acceso } = await admin.rpc('mi_acceso')
const local = acceso[0].local_id
const { data: rolEnc } = await servicio.from('roles').select('id').eq('nombre', 'Encargado de la noche').single()
const enc = await entrar(`enc${sufijo}@prueba.local`, 'Encargado asignado')
const otro = await entrar(`otro${sufijo}@prueba.local`, 'Encargado no asignado')
await servicio.from('miembros').insert([
  { usuario_id: enc.id, local_id: local, rol_id: rolEnc.id },
  { usuario_id: otro.id, local_id: local, rol_id: rolEnc.id },
])

const stock = async (id) => (await admin.from('stock_articulos').select('stock_actual').eq('id', id).single()).data.stock_actual

// Artículo de prueba con 100 unidades
const { data: art } = await admin.from('articulos').insert({ local_id: local, nombre: `Prueba ${sufijo}` }).select().single()
await admin.from('movimientos').insert({ articulo_id: art.id, tipo: 'ingreso', cantidad: 100, local_id: local, creado_por: (await admin.auth.getUser()).data.user.id })
ok(await stock(art.id) === 100, 'Depósito arranca con 100')

// Evento y barra
const { data: ev, error: e1 } = await admin.from('eventos').insert({ local_id: local, fecha: '2026-11-20', nombre: 'Casamiento prueba', personas: 120 }).select().single()
ok(!e1, 'La administradora crea el evento ' + (e1?.message ?? ''))
const { data: barra } = await admin.from('barras').insert({ evento_id: ev.id, local_id: local, nombre: 'Barra 1' }).select().single()
const { data: lin } = await admin.from('barra_articulos').insert({ barra_id: barra.id, evento_id: ev.id, local_id: local, articulo_id: art.id, stock_inicial: 24 }).select().single()
ok(await stock(art.id) === 76, 'Stock inicial 24 → sale del depósito (76)')

await admin.from('reposiciones').insert({ barra_articulo_id: lin.id, evento_id: ev.id, local_id: local, articulo_id: art.id, cantidad: 12 })
ok(await stock(art.id) === 64, 'Reposición de 12 → sale del depósito (64)')

await admin.from('barra_articulos').update({ stock_final: 10 }).eq('id', lin.id)
ok(await stock(art.id) === 74, 'Stock final 10 vuelve → depósito descuenta solo lo consumido 26 (74)')

await admin.from('retiros').insert({ barra_id: barra.id, evento_id: ev.id, local_id: local, articulo_id: art.id, tipo: 'personal', cantidad: 3, retirado_por: 'Juan (mozo)' })
ok(await stock(art.id) === 74, 'Un retiro NO descuenta otra vez del depósito (sigue 74)')

await admin.from('bebida_abierta').insert([{ evento_id: ev.id, local_id: local, articulo_id: art.id, cuartos: 2 }, { evento_id: ev.id, local_id: local, articulo_id: art.id, cuartos: 2 }])
ok(await stock(art.id) === 74, 'La bebida abierta no toca el depósito (sigue 74)')
const { data: ba } = await admin.from('bebida_abierta').select('cuartos').eq('evento_id', ev.id)
ok(ba.reduce((t, x) => t + x.cuartos, 0) / 4 === 1, 'Dos mitades suman 1 botella')

// Edición posterior (evento "cerrado")
await admin.from('barra_articulos').update({ stock_final: 12 }).eq('id', lin.id)
ok(await stock(art.id) === 76, 'Corregir el final a 12 días después recalcula el depósito (76)')
const { data: hist } = await admin.from('auditoria').select('*').eq('tabla', 'barra_articulos').eq('registro_id', lin.id).order('id')
const cambio = hist.find((h) => h.cambios.stock_final?.antes === 10 && h.cambios.stock_final?.despues === 12)
ok(!!cambio && !!cambio.usuario_id && cambio.evento_id === ev.id, 'El historial guarda quién cambió el stock final, valor anterior (10) y nuevo (12)')

const r1 = await admin.from('barra_articulos').update({ stock_final: -1 }).eq('id', lin.id)
ok(!!r1.error, 'No acepta stock final negativo')
const r2 = await admin.from('reposiciones').insert({ barra_articulo_id: lin.id, evento_id: ev.id, local_id: local, articulo_id: art.id, cantidad: 0 })
ok(!!r2.error, 'No acepta reposición en 0')
const r3 = await admin.from('bebida_abierta').insert({ evento_id: ev.id, local_id: local, articulo_id: art.id, cuartos: 5 })
ok(!!r3.error, 'Bebida abierta solo acepta ¼, ½, ¾ o entera')

// Permisos del encargado
const { data: vistoAntes } = await enc.c.from('eventos').select('id').eq('id', ev.id)
ok(vistoAntes.length === 0, 'El encargado NO ve el evento si no está asignado')
await admin.from('evento_asignaciones').insert({ evento_id: ev.id, usuario_id: enc.id, local_id: local })
const { data: vistoDespues } = await enc.c.from('eventos').select('id').eq('id', ev.id)
ok(vistoDespues.length === 1, 'Una vez asignado, el encargado ve el evento')
const er = await enc.c.from('reposiciones').insert({ barra_articulo_id: lin.id, evento_id: ev.id, local_id: local, articulo_id: art.id, cantidad: 6 })
ok(!er.error, 'El encargado asignado carga una reposición ' + (er.error?.message ?? ''))
ok(await stock(art.id) === 70, 'Y el depósito se actualiza (70)')
const eb = await enc.c.from('barras').insert({ evento_id: ev.id, local_id: local, nombre: 'Barra VIP' }).select()
ok(!eb.error, 'El encargado asignado puede agregar una barra')
const ee = await enc.c.from('eventos').update({ nombre: 'hackeado' }).eq('id', ev.id).select()
ok((ee.data ?? []).length === 0, 'El encargado no puede cambiar los datos del evento')
const ei = await enc.c.from('movimientos').insert({ articulo_id: art.id, tipo: 'ingreso', cantidad: 5, local_id: local, creado_por: enc.id })
ok(!!ei.error, 'El encargado no puede cargar ingresos al depósito')
const ea = await enc.c.from('articulos').update({ precio_venta: 1 }).eq('id', art.id).select()
ok((ea.data ?? []).length === 0, 'El encargado no puede tocar precios')
const { data: st } = await enc.c.rpc('stock_del_local', { p_local: local })
ok(st.find((x) => x.articulo_id === art.id)?.stock_actual === 70, 'El encargado puede consultar el stock para saber si alcanza')
const { data: noVe } = await otro.c.from('barra_articulos').select('id').eq('evento_id', ev.id)
const on = await otro.c.from('reposiciones').insert({ barra_articulo_id: lin.id, evento_id: ev.id, local_id: local, articulo_id: art.id, cantidad: 6 })
ok(noVe.length === 0 && !!on.error, 'Un encargado NO asignado no ve ni carga nada en ese evento')

// Limpieza
await servicio.from('eventos').delete().eq('id', ev.id)
ok(await stock(art.id) === 100, 'Borrar el evento devuelve todo al depósito (100)')
await servicio.from('movimientos').delete().eq('articulo_id', art.id)
await servicio.from('articulos').delete().eq('id', art.id)
await servicio.from('auditoria').delete().eq('articulo_id', art.id)
for (const u of [enc.id, otro.id]) await servicio.auth.admin.deleteUser(u)
