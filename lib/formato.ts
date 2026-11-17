import type { Unidad } from './tipos'

const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })
const fechaHora = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
const fechaCorta = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

export const formatoNumero = (n: number) => numero.format(n)
export const formatoPesos = (n: number | null | undefined) => (n == null ? '—' : pesos.format(n))
export const formatoFechaHora = (iso: string) => fechaHora.format(new Date(iso))
export const formatoFecha = (iso: string) => fechaCorta.format(new Date(iso))

/** "1 bolsa", "3 bolsas", "12 u." */
export function formatoCantidad(n: number, unidad: Unidad = 'unidad'): string {
  if (unidad === 'bolsa') return `${formatoNumero(n)} ${Math.abs(n) === 1 ? 'bolsa' : 'bolsas'}`
  return `${formatoNumero(n)} u.`
}

/** "1 vaso", "3 vasos" (tragos de cortesía) */
export const formatoVasos = (n: number) => `${formatoNumero(n)} ${Math.abs(n) === 1 ? 'vaso' : 'vasos'}`

/** "Coca Cola · 2.0 L" */
export function detalleArticulo(a: { marca: string | null; tamano: string | null }): string {
  return [a.marca, a.tamano].filter(Boolean).join(' · ')
}

/** Valor de un <input type="datetime-local"> para "ahora", en hora local. */
export function ahoraParaInput(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/** Convierte "1.234,50" o "1234.5" en número. Vacío = null. */
export function leerPrecio(texto: string): number | null {
  const limpio = texto.trim().replace(/\$/g, '').replace(/\s/g, '')
  if (!limpio) return null
  // Formato argentino: el punto separa miles ("100.000" = cien mil) y la coma, decimales
  const normal = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(limpio)
      ? limpio.replace(/\./g, '')
      : limpio
  const n = Number(normal)
  return Number.isFinite(n) ? n : NaN
}

/** Traduce errores técnicos de la base a mensajes entendibles. */
export function mensajeError(error: unknown): string {
  const e = error as { message?: string; code?: string } | null
  const msg = e?.message ?? String(error)
  if (msg.includes('roles_nombre_key')) return 'Ya existe un rol con ese nombre.'
  if (msg.includes('tragos_nombre_unico')) return 'Ya existe un trago con ese nombre.'
  if (msg.includes('evento_asignaciones_pkey')) return 'Ese evento ya estaba asignado.'
  if (e?.code === '23505' || msg.includes('articulos_nombre_unico')) return 'Ya existe un artículo con ese nombre.'
  if (e?.code === '23503' && msg.includes('miembros')) return 'No se puede borrar: hay usuarios con ese rol.'
  if (e?.code === '23503') return 'No se puede borrar porque tiene historial. Podés desactivarlo.'
  if (e?.code === '42501' || msg.includes('row-level security')) return 'No tenés permiso para hacer esto.'
  if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (/banned/i.test(msg)) return 'Tu usuario está desactivado. Hablá con la administradora.'
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'No hay conexión. Probá de nuevo en un momento.'
  return msg
}

/** Fecha de evento ("2026-11-20") sin correrse un día por la zona horaria. */
function fechaLocal(fecha: string): Date {
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(a, m - 1, d)
}
const fechaLarga = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const soloHora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' })

/** "sáb, 20 nov 2026" */
export const formatoFechaEvento = (fecha: string) => fechaLarga.format(fechaLocal(fecha))
/** "23:45" */
export const formatoHora = (iso: string) => soloHora.format(new Date(iso))

/** Hoy en formato AAAA-MM-DD (hora local). */
export function hoyISO(): string {
  return ahoraParaInput().slice(0, 10)
}

/** ¿El evento ya pasó? (anterior a hoy) */
export const eventoPasado = (fecha: string) => fecha < hoyISO()
