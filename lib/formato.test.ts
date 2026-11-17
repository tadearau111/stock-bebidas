import { describe, expect, it } from 'vitest'
import { formatoCantidad, formatoFechaEvento, leerPrecio } from './formato'

describe('Precios', () => {
  it('entiende el formato argentino', () => {
    expect(leerPrecio('1.234,50')).toBe(1234.5)
    expect(leerPrecio('$ 2500')).toBe(2500)
    expect(leerPrecio('99.9')).toBe(99.9)
    expect(leerPrecio('100.000')).toBe(100000)
    expect(leerPrecio('1.500')).toBe(1500)
    expect(leerPrecio('1.250.000')).toBe(1250000)
    expect(leerPrecio('1.250.000,75')).toBe(1250000.75)
    expect(leerPrecio('3500,50')).toBe(3500.5)
  })
  it('vacío es "sin precio"', () => {
    expect(leerPrecio('  ')).toBeNull()
  })
  it('texto inválido no es un número', () => {
    expect(leerPrecio('abc')).toBeNaN()
  })
})

describe('Cantidades', () => {
  it('el hielo se muestra en bolsas', () => {
    expect(formatoCantidad(1, 'bolsa')).toBe('1 bolsa')
    expect(formatoCantidad(3, 'bolsa')).toBe('3 bolsas')
  })
  it('el resto en unidades', () => {
    expect(formatoCantidad(1500)).toBe('1.500 u.')
  })
})

describe('Fechas de eventos', () => {
  it('no se corre un día por la zona horaria', () => {
    expect(formatoFechaEvento('2026-11-20')).toContain('20')
  })
})
