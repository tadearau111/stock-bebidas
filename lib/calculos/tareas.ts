// Tareas de la semana: pagos a empleados (salen del efectivo de la caja fuerte).

import type { MovimientoManual } from './cajaFuerte'
import { semanaDe } from './info'

export interface PersonaSemana {
  persona: string
  total: number
  horas: number
  pagos: number
}

export interface ResumenSemana {
  desde: string // AAAA-MM-DD (lunes)
  hasta: string // AAAA-MM-DD (domingo)
  pagos: MovimientoManual[] // ordenados por día
  total: number
  horas: number
  porPersona: PersonaSemana[]
  porDia: { dia: string; pagos: MovimientoManual[]; total: number }[]
}

const centavos = (v: number) => Math.round(v * 100) / 100
const dia = (fecha: string) => fecha.slice(0, 10)

/** Los pagos de la semana (lunes a domingo) que contiene `fecha`. */
export function resumirSemana(movimientos: MovimientoManual[], fecha: Date): ResumenSemana {
  const { desde, hasta } = semanaDe(fecha)
  const pagos = movimientos
    .filter((m) => m.tipo === 'pago' && dia(m.fecha) >= desde && dia(m.fecha) <= hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  const personas = new Map<string, PersonaSemana>()
  for (const p of pagos) {
    const nombre = (p.persona ?? '').trim() || 'Sin nombre'
    const clave = nombre.toLocaleLowerCase('es')
    const actual = personas.get(clave) ?? { persona: nombre, total: 0, horas: 0, pagos: 0 }
    actual.total = centavos(actual.total + p.monto)
    actual.horas = centavos(actual.horas + (p.horas ?? 0))
    actual.pagos += 1
    personas.set(clave, actual)
  }

  const dias = new Map<string, MovimientoManual[]>()
  for (const p of pagos) dias.set(dia(p.fecha), [...(dias.get(dia(p.fecha)) ?? []), p])

  return {
    desde,
    hasta,
    pagos,
    total: centavos(pagos.reduce((t, p) => t + p.monto, 0)),
    horas: centavos(pagos.reduce((t, p) => t + (p.horas ?? 0), 0)),
    porPersona: [...personas.values()].sort((a, b) => b.total - a.total || a.persona.localeCompare(b.persona, 'es')),
    porDia: [...dias.entries()].map(([d, ps]) => ({ dia: d, pagos: ps, total: centavos(ps.reduce((t, p) => t + p.monto, 0)) })),
  }
}

/** Nombres ya usados en pagos anteriores (para sugerir al escribir), los más recientes primero. */
export function nombresUsados(movimientos: MovimientoManual[]): string[] {
  const vistos = new Map<string, string>()
  for (const m of [...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    const n = (m.persona ?? '').trim()
    if (m.tipo === 'pago' && n && !vistos.has(n.toLocaleLowerCase('es'))) vistos.set(n.toLocaleLowerCase('es'), n)
  }
  return [...vistos.values()]
}

/** Mueve una fecha AAAA-MM-DD `n` semanas. */
export function moverSemanas(desde: string, n: number): Date {
  const [a, m, d] = desde.split('-').map(Number)
  return new Date(a, m - 1, d + 7 * n)
}
