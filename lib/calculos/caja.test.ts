import { describe, expect, it } from 'vitest'
import { CAJA_VACIA, cajaCargada, calcularCaja, textoDiferencia } from './caja'

const caja = {
  ...CAJA_VACIA,
  efectivo_real: 100_000,
  efectivo_sistema: 102_000,
  cierre_lotes: 250_000,
  tarjetas_sistema: 250_000,
  boleteria_efectivo: 40_000,
  boleteria_lotes: 60_000,
  guardarropas_efectivo: 8_000,
  guardarropas_lotes: 2_000,
  cambio_proxima_caja: 20_000,
}
const gastos = [{ monto: 5_000 }, { monto: 3_500.5 }]

describe('Caja del evento', () => {
  const r = calcularCaja(caja, gastos)

  it('diferencia de efectivo: real − sistema (negativo = falta plata)', () => {
    expect(r.diferenciaEfectivo).toBe(-2_000)
  })
  it('diferencia de tarjetas: cierre de lotes − tarjetas sistema', () => {
    expect(r.diferenciaTarjetas).toBe(0)
  })
  it('venta total caja de barras = efectivo real + cierre de lotes', () => {
    expect(r.ventaCaja).toBe(350_000)
  })
  it('boletería y guardarropas: efectivo + cierre de lotes', () => {
    expect(r.totalBoleteria).toBe(100_000)
    expect(r.totalGuardarropas).toBe(10_000)
  })
  it('gastos totales = suma de los gastos de la noche', () => {
    expect(r.totalGastos).toBe(8_500.5)
  })
  it('retiro a caja fuerte = todo el efectivo − gastos − cambio para la próxima caja', () => {
    // efectivo: 100.000 + 40.000 + 8.000 = 148.000
    expect(r.efectivoTotal).toBe(148_000)
    expect(r.retiroCajaFuerte).toBe(148_000 - 8_500.5 - 20_000)
  })
  it('venta total + boletería + guardarropas', () => {
    expect(r.ventaTotalGeneral).toBe(460_000)
  })
  it('los campos vacíos cuentan como 0', () => {
    const v = calcularCaja(CAJA_VACIA, [])
    expect(v.ventaTotalGeneral).toBe(0)
    expect(v.retiroCajaFuerte).toBe(0)
  })
  it('sin errores de decimales', () => {
    expect(calcularCaja(CAJA_VACIA, [{ monto: 0.1 }, { monto: 0.2 }]).totalGastos).toBe(0.3)
  })
  it('sabe si se cargó algo', () => {
    expect(cajaCargada(CAJA_VACIA, [])).toBe(false)
    expect(cajaCargada(null, [{}])).toBe(true)
    expect(cajaCargada({ ...CAJA_VACIA, vasos_no_devueltos: 3 }, [])).toBe(true)
  })
  it('texto de la diferencia', () => {
    const f = (v: number) => `$${v}`
    expect(textoDiferencia(-2000, f)).toBe('Faltan $2000')
    expect(textoDiferencia(500, f)).toBe('Sobran $500')
    expect(textoDiferencia(0, f)).toBe('Coincide')
  })
})
