import { describe, expect, it } from 'vitest'
import { resumirCajeros } from './cajeros'

const cajero = (id: string, nombre: string) => ({ id, evento_id: 'e', nombre, orden: 0 })
const retiro = (id: string, cajero_id: string, monto: number, hora: string) => ({ id, cajero_id, evento_id: 'e', monto, hora, notas: null })

describe('Cajeros', () => {
  const r = resumirCajeros(
    [cajero('c1', 'Sofía'), cajero('c2', 'Martín'), cajero('c3', 'Sin retiros')],
    [retiro('r2', 'c1', 150_000, '2026-11-21T03:00:00Z'), retiro('r1', 'c1', 200_000, '2026-11-21T01:30:00Z'), retiro('r3', 'c2', 80_000.5, '2026-11-21T02:00:00Z')],
  )
  it('suma los retiros de cada cajero, en orden de hora', () => {
    expect(r.cajeros.map((c) => [c.cajero.nombre, c.total, c.retiros.map((x) => x.id)])).toEqual([
      ['Sofía', 350_000, ['r1', 'r2']],
      ['Martín', 80_000.5, ['r3']],
      ['Sin retiros', 0, []],
    ])
  })
  it('total de la noche', () => {
    expect(r.total).toBe(430_000.5)
    expect(r.cantidad).toBe(3)
  })
})

describe('Cierre de cada cajero', () => {
  const r = resumirCajeros(
    [
      { ...cajero('c1', 'Sofía'), efectivo_sistema: 360_000, tarjetas_sistema: 500_000, cierre_lotes: 498_000 },
      { ...cajero('c2', 'Martín'), efectivo_sistema: 80_000.5, tarjetas_sistema: null, cierre_lotes: 120_000 },
      cajero('c3', 'Sin cierre'),
    ],
    [retiro('r1', 'c1', 200_000, '2026-11-21T01:30:00Z'), retiro('r2', 'c1', 150_000, '2026-11-21T03:00:00Z'), retiro('r3', 'c2', 80_000.5, '2026-11-21T02:00:00Z')],
  )
  it('efectivo real (total retirado) contra el sistema: negativo es que falta plata', () => {
    expect(r.cajeros.map((c) => c.diferenciaEfectivo)).toEqual([-10_000, 0, null])
  })
  it('cierre de lotes contra tarjetas del sistema', () => {
    expect(r.cajeros.map((c) => c.diferenciaTarjetas)).toEqual([-2_000, 120_000, null])
  })
  it('suma todos los cajeros', () => {
    expect([r.efectivoSistema, r.tarjetasSistema, r.cierreLotes]).toEqual([440_000.5, 500_000, 618_000])
    expect(r.diferenciaEfectivo).toBe(-10_000)
    expect(r.diferenciaTarjetas).toBe(118_000)
  })
})
