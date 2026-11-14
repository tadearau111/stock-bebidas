// Prueba de seguridad contra el Supabase LOCAL (no se usa en producción).
import { createClient } from '@supabase/supabase-js'
const URL = 'http://127.0.0.1:54321'
const { PUBLISHABLE_KEY, SECRET_KEY } = process.env
const adminApi = createClient(URL, SECRET_KEY, { auth: { persistSession: false } })

async function usuario(email, nombre) {
  await adminApi.auth.admin.createUser({ email, password: 'prueba1234', email_confirm: true, user_metadata: { nombre } })
  const c = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'prueba1234' })
  if (error) throw error
  return c
}
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✘ ') + msg); if (!cond) process.exitCode = 1 }

const admin = await usuario('admin@prueba.local', 'Administradora')
const otro = await usuario('otro@prueba.local', 'Sin rol')

const { data: acceso } = await admin.rpc('mi_acceso')
ok(acceso?.[0]?.rol === 'Administrador', 'El primer usuario queda como Administrador')
const { data: accesoOtro } = await otro.rpc('mi_acceso')
ok(accesoOtro?.length === 0, 'El segundo usuario queda sin acceso')

const { data: arts } = await admin.from('stock_articulos').select('*').order('nombre')
ok(arts.length === 31, 'La administradora ve los 31 artículos')
const coca = arts.find(a => a.nombre === 'Coca Cola 2.0 L')

const r1 = await admin.from('movimientos').insert({ articulo_id: coca.id, tipo: 'ingreso', cantidad: 24, local_id: coca.local_id })
ok(!r1.error, 'Puede cargar un ingreso de 24 ' + (r1.error?.message ?? ''))
const r2 = await admin.from('movimientos').insert({ articulo_id: coca.id, tipo: 'ajuste', cantidad: -2, motivo: 'rotura', local_id: coca.local_id })
ok(!r2.error, 'Puede cargar un ajuste de -2 por rotura')
const r3 = await admin.from('movimientos').insert({ articulo_id: coca.id, tipo: 'ajuste', cantidad: -1, motivo: '  ', local_id: coca.local_id })
ok(!!r3.error, 'Un ajuste sin motivo es rechazado')
const r4 = await admin.from('movimientos').insert({ articulo_id: coca.id, tipo: 'ingreso', cantidad: -5, local_id: coca.local_id })
ok(!!r4.error, 'Un ingreso negativo es rechazado')

await admin.from('articulos').update({ stock_minimo: 30 }).eq('id', coca.id)
const { data: c2 } = await admin.from('stock_articulos').select('*').eq('id', coca.id).single()
ok(c2.stock_actual === 22, `Stock calculado = 24 - 2 = 22 (dio ${c2.stock_actual})`)
ok(c2.bajo_minimo === true && c2.faltante === 8, 'Queda bajo mínimo (30) con faltante 8')

const del = await admin.from('articulos').delete().eq('id', coca.id)
ok(!!del.error, 'No se puede borrar un artículo con historial')

const { data: hist } = await admin.from('auditoria').select('*').eq('articulo_id', coca.id)
const cambioMin = hist.find(h => h.tabla === 'articulos' && h.cambios.stock_minimo)
ok(cambioMin?.cambios.stock_minimo.antes === 0 && cambioMin?.cambios.stock_minimo.despues === 30,
  'El historial guarda el stock mínimo anterior (0) y el nuevo (30)')
ok(hist.filter(h => h.tabla === 'movimientos').length === 2, 'El historial registra los 2 movimientos')

const { data: vistoOtro } = await otro.from('stock_articulos').select('*')
ok(vistoOtro.length === 0, 'El usuario sin rol no ve artículos')
const o1 = await otro.from('movimientos').insert({ articulo_id: coca.id, tipo: 'ingreso', cantidad: 5, local_id: coca.local_id })
ok(!!o1.error, 'El usuario sin rol no puede cargar ingresos')
const o2 = await otro.from('articulos').update({ precio_venta: 1 }).eq('id', coca.id).select()
ok((o2.data ?? []).length === 0, 'El usuario sin rol no puede cambiar precios')
const { data: histOtro } = await otro.from('auditoria').select('*')
ok(histOtro.length === 0, 'El usuario sin rol no ve el historial')
const anon = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
const a1 = await anon.from('articulos').select('*')
ok(!!a1.error || a1.data.length === 0, 'Sin login no se ve nada')
