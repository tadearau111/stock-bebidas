import { describe, expect, it } from 'vitest'
import { armarLibro, resumirPorMes } from './cajaFuerte'
import { moverSemanas, nombresUsados, resumirSemana } from './tareas'

const pago = (id: string, fecha: string, persona: string, monto: number, horas: number | null = null) => ({
  id,
  tipo: 'pago' as const,
  monto,
  detalle: 'Limpieza',
  fecha: `${fecha}T12:00:00`,
  persona,
  horas,
})

const movs = [
  pago('p1', '2026-11-16', 'Juan Pérez', 20_000, 4),
  pago('p2', '2026-11-18', 'Ana', 15_000, 3),
  pago('p3', '2026-11-22', 'juan pérez', 10_000, 2.5),
  pago('p4', '2026-11-23', 'Juan Pérez', 99_000), // semana siguiente
  { id: 'r1', tipo: 'retiro' as const, monto: 5_000, detalle: 'Otro', fecha: '2026-11-17T10:00:00' },
]

describe('Tareas de la semana', () => {
  const s = resumirSemana(movs, new Date(2026, 10, 18))
  it('toma solo los pagos de lunes a domingo', () => {
    expect([s.desde, s.hasta]).toEqual(['2026-11-16', '2026-11-22'])
    expect(s.pagos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(s.total).toBe(45_000)
    expect(s.horas).toBe(9.5)
  })
  it('suma por persona (sin importar mayúsculas)', () => {
    expect(s.porPersona).toEqual([
      { persona: 'Juan Pérez', total: 30_000, horas: 6.5, pagos: 2 },
      { persona: 'Ana', total: 15_000, horas: 3, pagos: 1 },
    ])
  })
  it('agrupa por día', () => {
    expect(s.porDia.map((d) => [d.dia, d.total])).toEqual([
      ['2026-11-16', 20_000],
      ['2026-11-18', 15_000],
      ['2026-11-22', 10_000],
    ])
  })
  it('sugiere los nombres usados', () => {
    expect(nombresUsados(movs)).toEqual(['Juan Pérez', 'Ana'])
  })
  it('mueve de semana', () => {
    expect(resumirSemana(movs, moverSemanas(s.desde, 1)).pagos.map((p) => p.id)).toEqual(['p4'])
  })
  it('los pagos se restan del efectivo de la caja fuerte', () => {
    const libro = armarLibro([{ evento_id: 'e', fecha: '2026-11-14', nombre: 'Casamiento', efectivo: 200_000, gastos: 0 }], movs)
    expect(libro.totalPagos).toBe(144_000)
    expect(libro.saldo).toBe(200_000 - 144_000 - 5_000)
    const [nov] = resumirPorMes(libro, new Date(2026, 10, 18))
    expect(nov.pagos).toBe(144_000)
    expect(nov.renglones.find((r) => r.ref === 'p1')).toMatchObject({ clase: 'pago', titulo: 'Pago de tareas', detalle: 'Juan Pérez: Limpieza (4 h)', monto: -20_000 })
  })
})
