// Cálculos de los eventos. La base de datos hace la misma cuenta para el
// stock del depósito (vista consumo_en_barras); acá se usan para la
// pantalla, el resumen y las pruebas.

export interface LineaBarra {
  articulo_id: string
  stock_inicial: number
  stock_final: number | null // null = todavía no se contó
  reposiciones: { cantidad: number }[]
}

export type TipoRetiro = 'personal' | 'cortesia'

export interface Retiro {
  articulo_id: string
  tipo: TipoRetiro
  cantidad: number
}

export interface CargaBebidaAbierta {
  articulo_id: string
  cuartos: number // 1 = 1/4, 2 = 1/2, 3 = 3/4, 4 = entera
}

/** Suma de reposiciones (detalladas o total directo). */
export function totalReposiciones(linea: Pick<LineaBarra, 'reposiciones'>): number {
  return linea.reposiciones.reduce((t, r) => t + r.cantidad, 0)
}

/** Lo que se llevó a la barra en total: stock inicial + reposiciones. */
export function totalLlevado(linea: LineaBarra): number {
  return linea.stock_inicial + totalReposiciones(linea)
}

/**
 * Consumido = Stock inicial + Reposiciones − Stock final.
 * Si todavía no se cargó el stock final, devuelve null (no se puede saber).
 */
export function consumido(linea: LineaBarra): number | null {
  if (linea.stock_final == null) return null
  return totalLlevado(linea) - linea.stock_final
}

/**
 * Cuánto sale del depósito por esta línea. Mientras no hay stock final,
 * se considera que todo lo llevado está afuera; cuando se carga, vuelve.
 */
export function salidaDelDeposito(linea: LineaBarra): number {
  return totalLlevado(linea) - (linea.stock_final ?? 0)
}

/** Stock del depósito = ingresos y ajustes − lo que salió a las barras. */
export function stockDeposito(movimientos: { cantidad: number }[], lineas: LineaBarra[]): number {
  const entradas = movimientos.reduce((t, m) => t + m.cantidad, 0)
  return entradas - lineas.reduce((t, l) => t + salidaDelDeposito(l), 0)
}

/** El stock final no puede ser mayor a lo que se llevó (daría consumo negativo). */
export function stockFinalValido(linea: LineaBarra, stockFinal: number): boolean {
  return Number.isInteger(stockFinal) && stockFinal >= 0 && stockFinal <= totalLlevado(linea)
}

/**
 * ¿Alcanza el depósito para un nuevo valor de esta línea?
 * stockActual ya tiene descontado lo que esta línea tiene cargado ahora,
 * así que se compara solo la diferencia.
 */
export function faltaEnDeposito(stockActual: number, cantidadAnterior: number, cantidadNueva: number): number {
  const necesita = cantidadNueva - cantidadAnterior
  return Math.max(necesita - Math.max(stockActual, 0), 0)
}

// ------------------------------------------------------------------ Bebida abierta

/** Suma las fracciones: dos mitades = 1 botella. Devuelve botellas (puede tener decimales de 0,25). */
export function sumarFracciones(cargas: Pick<CargaBebidaAbierta, 'cuartos'>[]): number {
  return cargas.reduce((t, c) => t + c.cuartos, 0) / 4
}

const FRACCION: Record<number, string> = { 0: '', 1: '¼', 2: '½', 3: '¾' }

/** 1.5 → "1 ½", 0.25 → "¼", 2 → "2" */
export function formatoBotellas(botellas: number): string {
  const cuartos = Math.round(botellas * 4)
  const enteras = Math.floor(cuartos / 4)
  const resto = FRACCION[cuartos % 4]
  if (enteras === 0) return resto || '0'
  return resto ? `${enteras} ${resto}` : String(enteras)
}

export function etiquetaCuartos(cuartos: number): string {
  return cuartos === 4 ? 'Entera' : `${FRACCION[cuartos]}`
}

/** Total de bebida abierta por artículo (en botellas). */
export function bebidaAbiertaPorArticulo(cargas: CargaBebidaAbierta[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cargas) m.set(c.articulo_id, (m.get(c.articulo_id) ?? 0) + c.cuartos)
  for (const [k, v] of m) m.set(k, v / 4)
  return m
}

// ------------------------------------------------------------------ Resumen del evento

export interface ArticuloPrecio {
  id: string
  nombre: string
  unidad: 'unidad' | 'bolsa'
  precio_costo: number | null
  precio_venta: number | null
}

export interface FilaResumen {
  articulo: ArticuloPrecio
  llevado: number
  consumido: number
  pendiente: boolean // alguna barra sin stock final
  retirosPersonal: number
  cortesias: number
  ventaEstimada: number
  porPersona: number | null
  costo: number | null
  facturacion: number | null
}

export interface ResumenEvento {
  filas: FilaResumen[]
  barrasSinFinal: number
  totales: {
    retirosPersonal: number
    cortesias: number
    costo: number | null
    facturacion: number | null
  }
}

/**
 * Consumido total = Venta estimada + Retiros personal + Cortesías
 *  → Venta estimada = Consumido − Retiros.
 * Solo se cuentan como consumidas las líneas con stock final cargado.
 */
export function resumirEvento(
  lineas: LineaBarra[],
  retiros: Retiro[],
  articulos: ArticuloPrecio[],
  personas: number,
): ResumenEvento {
  const porId = new Map(articulos.map((a) => [a.id, a]))
  const filas = new Map<string, FilaResumen>()

  const fila = (id: string) => {
    let f = filas.get(id)
    if (!f) {
      const articulo = porId.get(id) ?? { id, nombre: '¿?', unidad: 'unidad' as const, precio_costo: null, precio_venta: null }
      f = {
        articulo, llevado: 0, consumido: 0, pendiente: false, retirosPersonal: 0, cortesias: 0,
        ventaEstimada: 0, porPersona: null, costo: null, facturacion: null,
      }
      filas.set(id, f)
    }
    return f
  }

  for (const l of lineas) {
    const f = fila(l.articulo_id)
    f.llevado += totalLlevado(l)
    const c = consumido(l)
    if (c == null) f.pendiente = true
    else f.consumido += c
  }
  for (const r of retiros) {
    const f = fila(r.articulo_id)
    if (r.tipo === 'personal') f.retirosPersonal += r.cantidad
    else f.cortesias += r.cantidad
  }

  let costoTotal: number | null = null
  let facturacionTotal: number | null = null
  let personal = 0
  let cortesias = 0
  for (const f of filas.values()) {
    f.ventaEstimada = f.consumido - f.retirosPersonal - f.cortesias
    f.porPersona = personas > 0 ? f.consumido / personas : null
    if (f.articulo.precio_costo != null) {
      f.costo = f.consumido * f.articulo.precio_costo
      costoTotal = (costoTotal ?? 0) + f.costo
    }
    if (f.articulo.precio_venta != null) {
      f.facturacion = Math.max(f.ventaEstimada, 0) * f.articulo.precio_venta
      facturacionTotal = (facturacionTotal ?? 0) + f.facturacion
    }
    personal += f.retirosPersonal
    cortesias += f.cortesias
  }

  return {
    filas: [...filas.values()].sort((a, b) => a.articulo.nombre.localeCompare(b.articulo.nombre, 'es')),
    barrasSinFinal: lineas.filter((l) => l.stock_final == null).length,
    totales: { retirosPersonal: personal, cortesias, costo: costoTotal, facturacion: facturacionTotal },
  }
}

// ------------------------------------------------------------------ Costos por barra

export interface LineaConBarra extends LineaBarra {
  barra_id: string
}

export interface RetiroConBarra extends Retiro {
  barra_id: string
}

export interface FilaCosto {
  articulo: ArticuloPrecio
  consumido: number
  retiros: number // personal + cortesías (no se venden)
  vendido: number // consumido − retiros
  pendiente: boolean // falta el stock final
  totalCosto: number | null // consumido × precio de costo
  totalVenta: number | null // vendido × precio de venta
}

export interface CostosBarra {
  barra_id: string
  filas: FilaCosto[]
  totalCosto: number
  totalVenta: number
}

export interface CostosEvento {
  barras: CostosBarra[]
  totalCosto: number
  totalVenta: number
  diferencia: number // venta − costo
  sinPrecioCosto: string[] // nombres de artículos consumidos sin precio de costo
  sinPrecioVenta: string[]
  lineasPendientes: number
}

/**
 * Costo = lo consumido en la barra × precio de costo (todo lo que salió cuesta,
 * también lo del personal y las cortesías).
 * Venta = lo vendido (consumido − retiros) × precio de venta.
 * Ejemplo: 10 cocas a $1 de costo y $2 de venta → costo $10, venta $20.
 */
export function costosDelEvento(
  barras: { id: string }[],
  lineas: LineaConBarra[],
  retiros: RetiroConBarra[],
  articulos: ArticuloPrecio[],
): CostosEvento {
  const porId = new Map(articulos.map((a) => [a.id, a]))
  const sinCosto = new Set<string>()
  const sinVenta = new Set<string>()
  let totalCosto = 0
  let totalVenta = 0

  const resultado = barras.map((b) => {
    const filas: FilaCosto[] = lineas
      .filter((l) => l.barra_id === b.id)
      .map((l) => {
        const articulo = porId.get(l.articulo_id) ?? { id: l.articulo_id, nombre: '¿?', unidad: 'unidad' as const, precio_costo: null, precio_venta: null }
        const c = consumido(l)
        const cons = c ?? 0
        const ret = retiros
          .filter((r) => r.barra_id === b.id && r.articulo_id === l.articulo_id)
          .reduce((t, r) => t + r.cantidad, 0)
        const vendido = Math.max(cons - ret, 0)
        const totalCostoFila = articulo.precio_costo == null ? null : cons * articulo.precio_costo
        const totalVentaFila = articulo.precio_venta == null ? null : vendido * articulo.precio_venta
        if (cons > 0 && articulo.precio_costo == null) sinCosto.add(articulo.nombre)
        if (vendido > 0 && articulo.precio_venta == null) sinVenta.add(articulo.nombre)
        return { articulo, consumido: cons, retiros: ret, vendido, pendiente: c == null, totalCosto: totalCostoFila, totalVenta: totalVentaFila }
      })
      .sort((x, y) => x.articulo.nombre.localeCompare(y.articulo.nombre, 'es'))
    const tc = filas.reduce((t, f) => t + (f.totalCosto ?? 0), 0)
    const tv = filas.reduce((t, f) => t + (f.totalVenta ?? 0), 0)
    totalCosto += tc
    totalVenta += tv
    return { barra_id: b.id, filas, totalCosto: tc, totalVenta: tv }
  })

  return {
    barras: resultado,
    totalCosto,
    totalVenta,
    diferencia: totalVenta - totalCosto,
    sinPrecioCosto: [...sinCosto].sort(),
    sinPrecioVenta: [...sinVenta].sort(),
    lineasPendientes: lineas.filter((l) => l.stock_final == null).length,
  }
}

// ------------------------------------------------------------------ Tragos y vasos retirados

/** Separa los retiros de botellas (cuentan en el resumen) de los tragos/vasos (informativos). */
export function soloBotellas<T extends { articulo_id: string | null }>(retiros: T[]): (T & { articulo_id: string })[] {
  return retiros.filter((r): r is T & { articulo_id: string } => r.articulo_id != null)
}

/** Vasos por trago, separados en personal y cortesía: "Trago Absolut" → 2 personal, 3 cortesía. */
export function tragosRetirados(
  retiros: { trago_id: string | null; tipo: TipoRetiro; cantidad: number; trago?: { nombre: string } | null }[],
) {
  const m = new Map<string, { nombre: string; personal: number; cortesia: number; vasos: number }>()
  for (const r of retiros) {
    if (!r.trago_id) continue
    const actual = m.get(r.trago_id) ?? { nombre: r.trago?.nombre ?? 'Trago', personal: 0, cortesia: 0, vasos: 0 }
    if (r.tipo === 'personal') actual.personal += r.cantidad
    else actual.cortesia += r.cantidad
    actual.vasos += r.cantidad
    m.set(r.trago_id, actual)
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
