// Notas de Info: agrupar por semana y armar la lista de personal.

export const ROLES_PERSONAL = ['Seguridad', 'Limpieza', 'Bartenders', 'Cajeros', 'Técnico'] as const

export interface PersonalNota {
  rol: string
  cantidad: number | null
  detalle: string
}

export interface NotaBasica {
  fecha: string // AAAA-MM-DD
}

const aISO = (d: Date) => {
  const c = new Date(d)
  c.setMinutes(c.getMinutes() - c.getTimezoneOffset())
  return c.toISOString().slice(0, 10)
}

/** Lunes y domingo de la semana de una fecha (semana de lunes a domingo). */
export function semanaDe(hoy: Date): { desde: string; hasta: string } {
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const diaSemana = (d.getDay() + 6) % 7 // lunes = 0
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - diaSemana)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  return { desde: aISO(lunes), hasta: aISO(domingo) }
}

/** Separa las notas en: esta semana, próximas (después del domingo) y pasadas (antes del lunes). */
export function agruparNotas<T extends NotaBasica>(notas: T[], hoy = new Date()) {
  const { desde, hasta } = semanaDe(hoy)
  const porFecha = (a: T, b: T) => a.fecha.localeCompare(b.fecha)
  return {
    semana: notas.filter((n) => n.fecha >= desde && n.fecha <= hasta).sort(porFecha),
    proximas: notas.filter((n) => n.fecha > hasta).sort(porFecha),
    pasadas: notas.filter((n) => n.fecha < desde).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    desde,
    hasta,
  }
}

/** Personal para una nota nueva: los roles de siempre, vacíos. */
export function personalInicial(): PersonalNota[] {
  return ROLES_PERSONAL.map((rol) => ({ rol, cantidad: null, detalle: '' }))
}

/** Limpia la lista antes de guardar: saca los roles sin cantidad ni detalle. */
export function limpiarPersonal(lista: PersonalNota[]): PersonalNota[] {
  return lista
    .map((p) => ({ rol: p.rol.trim(), cantidad: p.cantidad, detalle: p.detalle.trim() }))
    .filter((p) => p.rol && (p.cantidad != null || p.detalle))
}

/** Total de personas a convocar. */
export const totalPersonal = (lista: PersonalNota[]) => lista.reduce((t, p) => t + (p.cantidad ?? 0), 0)

/** Al editar, se muestran siempre los roles de siempre (completados con lo guardado) + los extra. */
export function personalParaEditar(guardado: PersonalNota[]): PersonalNota[] {
  const base = personalInicial().map((p) => guardado.find((g) => g.rol.toLowerCase() === p.rol.toLowerCase()) ?? p)
  const extra = guardado.filter((g) => !ROLES_PERSONAL.some((r) => r.toLowerCase() === g.rol.toLowerCase()))
  return [...base, ...extra]
}
