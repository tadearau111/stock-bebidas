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

// Administrador de la noche: sin asignar no ve ni carga; asignado sí
const rolEnc = (await servicio.from('roles').select('id').eq('nombre', 'Administrador de la noche').single()).data.id
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

// ---- La Caja (bloque Barras) se suma sola desde los cajeros
{
  const ev2 = (await admin.from('eventos').insert({ local_id: local, nombre: 'Prueba caja automática ' + sufijo, fecha: '2026-11-20', personas: 10 }).select('id').single()).data.id
  const caja = async () => (await admin.from('evento_caja').select('*').eq('evento_id', ev2).maybeSingle()).data
  const c1 = (await admin.from('evento_cajeros').insert({ evento_id: ev2, nombre: 'Sofía' }).select('id').single()).data.id
  const c2 = (await admin.from('evento_cajeros').insert({ evento_id: ev2, nombre: 'Martín' }).select('id').single()).data.id
  await admin.from('cajero_retiros').insert([{ cajero_id: c1, monto: 200000 }, { cajero_id: c1, monto: 150000 }, { cajero_id: c2, monto: 80000 }])
  await admin.from('evento_cajeros').update({ efectivo_sistema: 360000, cierre_lotes: 498000, tarjetas_sistema: 500000 }).eq('id', c1)
  await admin.from('evento_cajeros').update({ efectivo_sistema: 80000, cierre_lotes: 100000 }).eq('id', c2)
  let k = await caja()
  ok(Number(k?.efectivo_real) === 430000, 'caja: efectivo real = total retirado a los cajeros')
  ok(Number(k?.efectivo_sistema) === 440000 && Number(k?.cierre_lotes) === 598000 && Number(k?.tarjetas_sistema) === 500000, 'caja: sistema, lotes y tarjetas = suma de los cajeros')
  // Guardar la caja con otros números en Barras no los pisa (los calcula la base); boletería sí se guarda
  await admin.from('evento_caja').upsert({ evento_id: ev2, efectivo_real: 1, boleteria_efectivo: 5000 }, { onConflict: 'evento_id' })
  k = await caja()
  ok(Number(k?.efectivo_real) === 430000 && Number(k?.boleteria_efectivo) === 5000, 'caja: guardar a mano no pisa lo automático y guarda el resto')
  // Borrar un retiro se descuenta solo
  const r = (await admin.from('cajero_retiros').select('id').eq('cajero_id', c2).single()).data.id
  await admin.rpc('mandar_a_papelera', { p_tipo: 'retiro_cajero', p_id: r })
  ok(Number((await caja())?.efectivo_real) === 350000, 'caja: borrar un retiro se descuenta solo')
  // La caja fuerte toma lo calculado
  const cf = ((await admin.rpc('caja_fuerte_eventos', { p_local: local })).data ?? []).find((e) => e.evento_id === ev2)
  ok(Number(cf?.efectivo) === 355000, 'caja fuerte: toma el efectivo de los cajeros + boletería')
  await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev2 })

  // Evento con Barras cargada a mano y SIN cajeros: al agregar cajeros, NO se pisa
  const ev3 = (await admin.from('eventos').insert({ local_id: local, nombre: 'Prueba caja a mano ' + sufijo, fecha: '2026-11-20', personas: 10 }).select('id').single()).data.id
  await admin.from('evento_caja').insert({ evento_id: ev3, efectivo_real: 777000, efectivo_sistema: 770000 })
  const c3 = (await admin.from('evento_cajeros').insert({ evento_id: ev3, nombre: 'Ana' }).select('id').single()).data.id
  await admin.from('cajero_retiros').insert({ cajero_id: c3, monto: 1000 })
  let k3 = (await admin.from('evento_caja').select('*').eq('evento_id', ev3).single()).data
  ok(Number(k3.efectivo_real) === 777000 && k3.barras_automatico === false, 'caja a mano: lo cargado se respeta al agregar cajeros')
  await admin.from('evento_caja').update({ barras_automatico: true }).eq('evento_id', ev3)
  k3 = (await admin.from('evento_caja').select('*').eq('evento_id', ev3).single()).data
  ok(Number(k3.efectivo_real) === 1000 && k3.efectivo_sistema === null, 'caja a mano: "Usar el resumen de cajeros" la pasa a automática')
  // Borrar y restaurar el evento entero sigue funcionando
  const p = (await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev3 })).data
  ok(!!p, 'borrar un evento con caja automática funciona')
  ok(!(await admin.rpc('restaurar_de_papelera', { p_id: p })).error && Number((await admin.from('evento_caja').select('efectivo_real').eq('evento_id', ev3).single()).data?.efectivo_real) === 1000, 'restaurarlo deja la caja igual')
  await admin.rpc('mandar_a_papelera', { p_tipo: 'evento', p_id: ev3 })
}
