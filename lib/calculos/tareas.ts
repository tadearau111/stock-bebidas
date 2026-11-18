// Tareas de la semana: pagos a empleados (salen del efectivo de la caja fuerte).

import type { MovimientoManual, RenglonResumen } from './cajaFuerte'
import { semanaDe } from './info'

export interface PersonaSemana {
  persona: string
  total: number
  horas: number
  pagos: number
}

const centavos = (v: number) => Math.round(v * 100) / 100
const dia = (fecha: string) => fecha.slice(0, 10)

/** Nombres ya usados en pagos anteriores (para sugerir al escribir), los más recientes primero. */
export function nombresUsados(movimientos: MovimientoManual[]): string[] {
  const vistos = new Map<string, string>()
  for (const m of [...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    const n = (m.persona ?? '').trim()
    if (m.tipo === 'pago' && n && !vistos.has(n.toLocaleLowerCase('es'))) vistos.set(n.toLocaleLowerCase('es'), n)
  }
  return [...vistos.values()]
}

// ------------------------------------------------------------------ Resumen mensual

/** Un pago tal como queda guardado en el resumen del mes. */
export interface PagoGuardado {
  ref?: string
  fecha: string
  persona: string
  tareas: string
  horas: number | null
  monto: number // positivo
}

export interface ResumenMesTareas {
  pagos: PagoGuardado[]
  total: number
  horas: number
  porPersona: PersonaSemana[]
  /** Los pagos del mes agrupados por semana (lunes a domingo) */
  porSemana: SemanaDelMes[]
}

export interface SemanaDelMes {
  desde: string
  hasta: string
  total: number
  horas: number
  pagos: number
  lista: PagoGuardado[]
}

/** Toma los renglones del mes de la caja fuerte (los guardados o los de hoy) y arma el resumen de pagos. */
export function resumirMesTareas(renglones: RenglonResumen[]): ResumenMesTareas {
  const pagos: PagoGuardado[] = renglones
    .filter((r) => r.clase === 'pago')
    .map((r) => ({
      ref: r.ref,
      fecha: r.fecha,
      persona: (r.persona ?? '').trim() || r.detalle.split(':')[0] || 'Sin nombre',
      tareas: r.tareas ?? r.detalle,
      horas: r.horas ?? null,
      monto: Math.abs(r.monto),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  const personas = new Map<string, PersonaSemana>()
  for (const p of pagos) {
    const clave = p.persona.toLocaleLowerCase('es')
    const actual = personas.get(clave) ?? { persona: p.persona, total: 0, horas: 0, pagos: 0 }
    actual.total = centavos(actual.total + p.monto)
    actual.horas = centavos(actual.horas + (p.horas ?? 0))
    actual.pagos += 1
    personas.set(clave, actual)
  }

  const semanas = new Map<string, SemanaDelMes>()
  for (const p of pagos) {
    const [a, m, d] = dia(p.fecha).split('-').map(Number)
    const { desde, hasta } = semanaDe(new Date(a, m - 1, d))
    const s = semanas.get(desde) ?? { desde, hasta, total: 0, horas: 0, pagos: 0, lista: [] }
    s.total = centavos(s.total + p.monto)
    s.horas = centavos(s.horas + (p.horas ?? 0))
    s.pagos += 1
    s.lista.push(p)
    semanas.set(desde, s)
  }

  return {
    pagos,
    total: centavos(pagos.reduce((t, p) => t + p.monto, 0)),
    horas: centavos(pagos.reduce((t, p) => t + (p.horas ?? 0), 0)),
    porPersona: [...personas.values()].sort((a, b) => b.total - a.total || a.persona.localeCompare(b.persona, 'es')),
    porSemana: [...semanas.values()].sort((a, b) => a.desde.localeCompare(b.desde)),
  }
}
