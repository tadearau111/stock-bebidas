import { describe, expect, it } from 'vitest'
import { armarLibro, cierreDesactualizado, mesActual, nombreMes, resumirPorMes } from './cajaFuerte'

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

describe('Resumen mensual de la caja fuerte', () => {
  const libro = armarLibro(
    [ev('Casamiento', '2026-11-14', 148_000, 8_500), ev('Fin de año', '2026-12-31', 200_000, 10_000)],
    [
      { id: 'i1', tipo: 'ingreso', monto: 50_000, detalle: 'Saldo inicial', fecha: '2026-11-01T10:00:00' },
      { id: 'r1', tipo: 'retiro', monto: 100_000, detalle: 'Pago proveedor', fecha: '2026-12-05T12:00:00' },
      { id: 'r2', tipo: 'retiro', monto: 30_000, detalle: 'Sueldos', fecha: '2027-01-10T12:00:00' },
    ],
  )
  const meses = resumirPorMes(libro, new Date(2027, 1, 15)) // estamos en febrero 2027

  it('un resumen por mes, del más viejo al actual (aunque el actual esté vacío)', () => {
    expect(meses.map((m) => m.clave)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
  it('noviembre: arranca en 0 y cierra con ingreso + efectivo − gastos', () => {
    const nov = meses[0]
    expect([nov.saldo_inicial, nov.ingresos, nov.efectivo, nov.gastos, nov.saldo_final]).toEqual([0, 50_000, 148_000, 8_500, 189_500])
  })
  it('diciembre arranca con el saldo con que cerró noviembre', () => {
    const dic = meses[1]
    expect(dic.saldo_inicial).toBe(189_500)
    expect(dic.retiros).toBe(100_000)
    expect(dic.saldo_final).toBe(189_500 - 100_000 + 200_000 - 10_000)
  })
  it('un mes sin movimientos mantiene el saldo', () => {
    const feb = meses[3]
    expect(feb.renglones).toHaveLength(0)
    expect(feb.saldo_inicial).toBe(feb.saldo_final)
    expect(feb.saldo_final).toBe(libro.saldo)
  })
  it('los renglones guardan título, detalle y evento', () => {
    expect(meses[0].renglones.map((r) => [r.titulo, r.detalle, r.monto])).toEqual([
      ['Ingreso', 'Saldo inicial', 50_000],
      ['Efectivo real', 'Casamiento', 148_000],
      ['Gastos', 'Casamiento', -8_500],
    ])
  })
  it('detecta si un cierre guardado quedó desactualizado', () => {
    const nov = meses[0]
    expect(cierreDesactualizado({ ...nov }, nov)).toBe(false)
    expect(cierreDesactualizado({ ...nov, efectivo: 140_000 }, nov)).toBe(true)
  })
  it('nombres de los meses', () => {
    expect(nombreMes(11)).toBe('Noviembre')
    expect(mesActual(new Date(2027, 1, 15))).toBe('2027-02')
  })
})

describe('Detalle de gastos en el resumen mensual', () => {
  it('cada renglón de gastos guarda para qué fue cada gasto', () => {
    const libro = armarLibro(
      [{ evento_id: 'e', fecha: '2026-11-14', nombre: 'Casamiento', efectivo: 100, gastos: 30, gastos_detalle: [{ detalle: 'Hielo', monto: 20 }, { detalle: 'Propina DJ', monto: 10 }] }],
      [],
    )
    const nov = resumirPorMes(libro, new Date(2026, 10, 20))[0]
    expect(nov.renglones.find((r) => r.clase === 'gastos')?.items).toEqual([
      { detalle: 'Hielo', monto: 20 },
      { detalle: 'Propina DJ', monto: 10 },
    ])
    expect(nov.renglones.find((r) => r.clase === 'efectivo')?.items).toBeUndefined()
  })
})
