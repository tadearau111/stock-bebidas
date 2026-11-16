import { describe, expect, it } from 'vitest'
import {
  bebidaAbiertaPorArticulo,
  consumido,
  faltaEnDeposito,
  formatoBotellas,
  resumirEvento,
  salidaDelDeposito,
  stockDeposito,
  stockFinalValido,
  sumarFracciones,
  totalReposiciones,
  type LineaBarra,
} from './evento'

const linea = (inicial: number, repos: number[], final: number | null, articulo_id = 'coca'): LineaBarra => ({
  articulo_id,
  stock_inicial: inicial,
  stock_final: final,
  reposiciones: repos.map((cantidad) => ({ cantidad })),
})

describe('Fórmula de consumo: Inicial + Reposiciones − Final', () => {
  it('ejemplo básico', () => {
    expect(consumido(linea(24, [12, 6], 10))).toBe(32) // 24 + 18 − 10
  })
  it('sin reposiciones', () => {
    expect(consumido(linea(10, [], 4))).toBe(6)
  })
  it('suma reposiciones detalladas', () => {
    expect(totalReposiciones(linea(0, [6, 6, 12], null))).toBe(24)
  })
  it('un total directo cuenta igual que una reposición', () => {
    expect(consumido(linea(10, [20], 5))).toBe(25)
  })
  it('si no se cargó el stock final, el consumo queda pendiente', () => {
    expect(consumido(linea(10, [5], null))).toBeNull()
  })
  it('si sobró todo, el consumo es 0', () => {
    expect(consumido(linea(10, [], 10))).toBe(0)
  })
  it('el stock final no puede superar lo llevado', () => {
    expect(stockFinalValido(linea(10, [5], null), 15)).toBe(true)
    expect(stockFinalValido(linea(10, [5], null), 16)).toBe(false)
    expect(stockFinalValido(linea(10, [5], null), -1)).toBe(false)
  })
})

describe('Impacto en el depósito', () => {
  const ingresos = [{ cantidad: 100 }]

  it('al cargar el stock inicial, esas unidades salen del depósito', () => {
    expect(stockDeposito(ingresos, [linea(24, [], null)])).toBe(76)
  })
  it('cada reposición también sale', () => {
    expect(stockDeposito(ingresos, [linea(24, [12], null)])).toBe(64)
  })
  it('el stock final vuelve: el depósito se descuenta solo por lo consumido', () => {
    const l = linea(24, [12], 10)
    expect(stockDeposito(ingresos, [l])).toBe(100 - consumido(l)!)
    expect(stockDeposito(ingresos, [l])).toBe(74)
  })
  it('varias barras del mismo artículo se suman', () => {
    expect(stockDeposito(ingresos, [linea(20, [], 5), linea(10, [5], 0)])).toBe(100 - 15 - 15)
  })
  it('los retiros NO se descuentan dos veces (ya están dentro del consumido)', () => {
    const l = linea(24, [], 10)
    const r = resumirEvento([l], [{ articulo_id: 'coca', tipo: 'personal', cantidad: 3 }], [], 100)
    expect(stockDeposito(ingresos, [l])).toBe(86) // solo el consumido (14)
    expect(r.filas[0].consumido).toBe(14)
    expect(r.filas[0].ventaEstimada).toBe(11)
  })
  it('la salida al depósito con stock final cargado es igual al consumido', () => {
    const l = linea(30, [6, 6], 7)
    expect(salidaDelDeposito(l)).toBe(consumido(l))
  })
})

describe('Edición de un evento ya terminado (los eventos nunca se bloquean)', () => {
  it('corregir el stock final recalcula el depósito', () => {
    const ingresos = [{ cantidad: 100 }]
    const l = linea(24, [12], 10)
    expect(stockDeposito(ingresos, [l])).toBe(74)
    // Una semana después se corrige: en realidad sobraron 12
    const corregida = { ...l, stock_final: 12 }
    expect(stockDeposito(ingresos, [corregida])).toBe(76)
    expect(consumido(corregida)).toBe(24)
  })
  it('agregar una reposición olvidada recalcula consumo y depósito', () => {
    const ingresos = [{ cantidad: 50 }]
    const l = linea(10, [], 2)
    const conRepo = { ...l, reposiciones: [{ cantidad: 6 }] }
    expect(consumido(conRepo)).toBe(14)
    expect(stockDeposito(ingresos, [conRepo])).toBe(36)
  })
  it('borrar una línea devuelve todo al depósito', () => {
    expect(stockDeposito([{ cantidad: 40 }], [])).toBe(40)
  })
})

describe('¿Alcanza el depósito?', () => {
  it('avisa cuánto falta', () => {
    expect(faltaEnDeposito(5, 0, 8)).toBe(3)
  })
  it('si se baja un valor, nunca falta', () => {
    expect(faltaEnDeposito(0, 10, 6)).toBe(0)
  })
  it('compara solo la diferencia con lo ya cargado', () => {
    // la línea tenía 10 (ya descontados), quedan 4 en depósito y se pasa a 14
    expect(faltaEnDeposito(4, 10, 14)).toBe(0)
    expect(faltaEnDeposito(4, 10, 15)).toBe(1)
  })
})

describe('Bebida abierta: suma de fracciones', () => {
  it('dos mitades de fernet son 1 botella', () => {
    expect(sumarFracciones([{ cuartos: 2 }, { cuartos: 2 }])).toBe(1)
  })
  it('¼ + ½ + ¾ = 1 ½', () => {
    const total = sumarFracciones([{ cuartos: 1 }, { cuartos: 2 }, { cuartos: 3 }])
    expect(total).toBe(1.5)
    expect(formatoBotellas(total)).toBe('1 ½')
  })
  it('formatos', () => {
    expect(formatoBotellas(0.25)).toBe('¼')
    expect(formatoBotellas(0.75)).toBe('¾')
    expect(formatoBotellas(3)).toBe('3')
    expect(formatoBotellas(2.25)).toBe('2 ¼')
    expect(formatoBotellas(0)).toBe('0')
  })
  it('agrupa por artículo', () => {
    const m = bebidaAbiertaPorArticulo([
      { articulo_id: 'fernet', cuartos: 2 },
      { articulo_id: 'campari', cuartos: 4 },
      { articulo_id: 'fernet', cuartos: 2 },
      { articulo_id: 'fernet', cuartos: 1 },
    ])
    expect(m.get('fernet')).toBe(1.25)
    expect(m.get('campari')).toBe(1)
  })
})

describe('Resumen del evento', () => {
  const articulos = [
    { id: 'coca', nombre: 'Coca Cola', unidad: 'unidad' as const, precio_costo: 1000, precio_venta: 3000 },
    { id: 'hielo', nombre: 'Hielo', unidad: 'bolsa' as const, precio_costo: null, precio_venta: null },
  ]

  it('suma todas las barras y detalla retiros, venta, costo y facturación', () => {
    const r = resumirEvento(
      [linea(24, [12], 6, 'coca'), linea(12, [], 2, 'coca'), linea(10, [], 3, 'hielo')],
      [
        { articulo_id: 'coca', tipo: 'personal', cantidad: 4 },
        { articulo_id: 'coca', tipo: 'cortesia', cantidad: 2 },
      ],
      articulos,
      40,
    )
    const coca = r.filas.find((f) => f.articulo.id === 'coca')!
    expect(coca.consumido).toBe(40) // (24+12−6) + (12−2)
    expect(coca.retirosPersonal).toBe(4)
    expect(coca.cortesias).toBe(2)
    expect(coca.ventaEstimada).toBe(34) // 40 − 4 − 2
    expect(coca.porPersona).toBe(1)
    expect(coca.costo).toBe(40_000)
    expect(coca.facturacion).toBe(102_000)
    const hielo = r.filas.find((f) => f.articulo.id === 'hielo')!
    expect(hielo.consumido).toBe(7)
    expect(hielo.costo).toBeNull()
    expect(r.totales.costo).toBe(40_000) // el hielo sin precio no suma
    expect(r.totales.facturacion).toBe(102_000)
    expect(r.barrasSinFinal).toBe(0)
  })

  it('avisa si falta cargar algún stock final', () => {
    const r = resumirEvento([linea(24, [], null, 'coca'), linea(5, [], 1, 'coca')], [], articulos, 10)
    expect(r.barrasSinFinal).toBe(1)
    expect(r.filas[0].pendiente).toBe(true)
    expect(r.filas[0].consumido).toBe(4) // solo cuenta la barra con final cargado
  })

  it('sin personas cargadas no calcula consumo por persona', () => {
    const r = resumirEvento([linea(10, [], 5, 'coca')], [], articulos, 0)
    expect(r.filas[0].porPersona).toBeNull()
  })

  it('sin precios cargados, costo y facturación quedan vacíos', () => {
    const r = resumirEvento([linea(10, [], 5, 'hielo')], [], articulos, 10)
    expect(r.totales.costo).toBeNull()
    expect(r.totales.facturacion).toBeNull()
  })
})
