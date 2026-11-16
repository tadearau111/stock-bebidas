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
