// Cálculos del depósito. La base de datos hace la misma cuenta (vista
// stock_articulos); estas funciones se usan en la pantalla y en las pruebas.

export type TipoMovimiento = 'ingreso' | 'ajuste'

export interface MovimientoBasico {
  tipo: TipoMovimiento
  cantidad: number
}

/** Stock del depósito = suma de ingresos y ajustes (los ajustes pueden ser negativos). */
export function calcularStock(movimientos: MovimientoBasico[]): number {
  return movimientos.reduce((total, m) => total + m.cantidad, 0)
}

/** Un artículo está bajo mínimo cuando su stock es MENOR al mínimo (igual no alcanza para alertar). */
export function estaBajoMinimo(stock: number, minimo: number): boolean {
  return stock < minimo
}

/** Cuántas unidades faltan para llegar al mínimo (nunca negativo). */
export function faltante(stock: number, minimo: number): number {
  return Math.max(minimo - stock, 0)
}

/**
 * Ajuste por conteo físico: si en el sistema hay 22 y contaste 20,
 * el ajuste a registrar es -2.
 */
export function ajustePorConteo(stockSistema: number, stockContado: number): number {
  return stockContado - stockSistema
}

/** Valida que una cantidad sea un número entero de unidades. */
export function esCantidadValida(valor: number, { permitirNegativo = false } = {}): boolean {
  if (!Number.isInteger(valor) || valor === 0) return false
  return permitirNegativo || valor > 0
}

/** Pasa a minúsculas y saca acentos, para que "tonica" encuentre "Tónica". */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Coincide si TODAS las palabras buscadas aparecen en alguno de los campos. */
export function coincideBusqueda(busqueda: string, campos: (string | null | undefined)[]): boolean {
  const palabras = normalizarTexto(busqueda).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return true
  const texto = normalizarTexto(campos.filter(Boolean).join(' '))
  return palabras.every((p) => texto.includes(p))
}
