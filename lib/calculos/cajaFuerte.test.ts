import { describe, expect, it } from 'vitest'
import { armarLibro } from './cajaFuerte'

const ev = (id: string, fecha: string, efectivo: number, gastos: number) => ({ evento_id: id, fecha, nombre: id, efectivo, gastos })

describe('Caja fuerte', () => {
  const libro = armarLibro(
    [ev('Casamiento', '2026-11-14', 148_000, 8_500.5), ev('Cumple', '2026-11-21', 90_000, 0)],
    [
      { id: 'i1', tipo: 'ingreso', monto: 50_000, detalle: 'Saldo inicial', fecha: '2026-11-01T10:00:00' },
      { id: 'r1', tipo: 'retiro', monto: 100_000, detalle: 'Retiró Laura para pago a proveedor', fecha: '2026-11-16T12:00:00' },
      { id: 'r2', tipo: 'retiro', monto: 15_000, detalle: 'Arreglo de la heladera del salón', fecha: '2026-11-22T09:00:00' },
    ],
  )

  it('cada evento suma su efectivo y resta sus gastos', () => {
    expect(libro.totalEfectivo).toBe(238_000)
    expect(libro.totalGastos).toBe(8_500.5)
  })
  it('los retiros restan y los ingresos manuales suman', () => {
    expect(libro.totalRetiros).toBe(115_000)
    expect(libro.totalIngresos).toBe(50_000)
  })
  it('saldo = ingresos + efectivo − gastos − retiros', () => {
    expect(libro.saldo).toBe(50_000 + 238_000 - 8_500.5 - 115_000)
  })
  it('ordena por fecha y muestra el saldo después de cada renglón', () => {
    expect(libro.renglones.map((r) => [r.clase, r.monto, r.saldo])).toEqual([
      ['ingreso', 50_000, 50_000],
      ['efectivo', 148_000, 198_000],
      ['gastos', -8_500.5, 189_499.5],
      ['retiro', -100_000, 89_499.5],
      ['efectivo', 90_000, 179_499.5],
      ['retiro', -15_000, 164_499.5],
    ])
  })
  it('un evento sin gastos no muestra el renglón de gastos', () => {
    expect(libro.renglones.filter((r) => r.clase === 'gastos')).toHaveLength(1)
  })
  it('un retiro del mismo día que un evento va antes (el evento cierra el día)', () => {
    const l = armarLibro([ev('E', '2026-11-14', 100, 0)], [{ id: 'r', tipo: 'retiro', monto: 10, detalle: 'x', fecha: '2026-11-14T20:00:00' }])
    expect(l.renglones.map((r) => r.clase)).toEqual(['retiro', 'efectivo'])
  })
  it('vacío', () => {
    expect(armarLibro([], []).saldo).toBe(0)
  })
})
