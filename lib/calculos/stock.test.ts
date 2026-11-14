import { describe, expect, it } from 'vitest'
import {
  ajustePorConteo,
  calcularStock,
  coincideBusqueda,
  esCantidadValida,
  estaBajoMinimo,
  faltante,
} from './stock'

describe('Stock del depósito', () => {
  it('sin movimientos el stock es 0', () => {
    expect(calcularStock([])).toBe(0)
  })

  it('suma ingresos y descuenta ajustes negativos', () => {
    expect(
      calcularStock([
        { tipo: 'ingreso', cantidad: 24 },
        { tipo: 'ingreso', cantidad: 12 },
        { tipo: 'ajuste', cantidad: -2 }, // rotura
        { tipo: 'ajuste', cantidad: 1 }, // conteo físico encontró una más
      ]),
    ).toBe(35)
  })
})

describe('Alertas de mínimo', () => {
  it('marca en rojo cuando el stock es menor al mínimo', () => {
    expect(estaBajoMinimo(5, 10)).toBe(true)
  })
  it('no alerta si el stock es igual al mínimo', () => {
    expect(estaBajoMinimo(10, 10)).toBe(false)
  })
  it('no alerta si el mínimo es 0 y no hay stock', () => {
    expect(estaBajoMinimo(0, 0)).toBe(false)
  })
  it('calcula cuánto falta para llegar al mínimo', () => {
    expect(faltante(22, 30)).toBe(8)
    expect(faltante(40, 30)).toBe(0)
    expect(faltante(-3, 10)).toBe(13)
  })
})

describe('Ajuste por conteo físico', () => {
  it('si contaste menos, el ajuste es negativo', () => {
    expect(ajustePorConteo(22, 20)).toBe(-2)
  })
  it('si contaste más, el ajuste es positivo', () => {
    expect(ajustePorConteo(22, 25)).toBe(3)
  })
  it('después del ajuste el stock queda igual a lo contado', () => {
    const movs = [{ tipo: 'ingreso' as const, cantidad: 22 }]
    const ajuste = ajustePorConteo(calcularStock(movs), 19)
    expect(calcularStock([...movs, { tipo: 'ajuste', cantidad: ajuste }])).toBe(19)
  })
})

describe('Cantidades', () => {
  it('solo acepta unidades enteras', () => {
    expect(esCantidadValida(6)).toBe(true)
    expect(esCantidadValida(1.5)).toBe(false)
    expect(esCantidadValida(0)).toBe(false)
    expect(esCantidadValida(-3)).toBe(false)
    expect(esCantidadValida(-3, { permitirNegativo: true })).toBe(true)
  })
})

describe('Buscador', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(coincideBusqueda('tonica', ['Tónica'])).toBe(true)
    expect(coincideBusqueda('JAGER', ['Jägermeister'])).toBe(true)
  })
  it('busca en nombre, marca y tamaño', () => {
    expect(coincideBusqueda('branca 1 l', ['Fernet 1 L', 'Fernet Branca', '1 L'])).toBe(true)
    expect(coincideBusqueda('coca 1.5', ['Coca Cola 2.0 L', 'Coca Cola', '2.0 L'])).toBe(false)
  })
  it('búsqueda vacía muestra todo', () => {
    expect(coincideBusqueda('  ', ['Miller'])).toBe(true)
  })
})
