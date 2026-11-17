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
  precio_mayorista: number | null
}

/** Barra propia → se calcula con precio de costo. Barra concesionada → con precio mayorista. */
export type TipoBarra = 'propia' | 'concesionada'

export const TIPOS_BARRA: Record<TipoBarra, { nombre: string; precio: string }> = {
  propia: { nombre: 'Barra propia', precio: 'precio costo' },
  concesionada: { nombre: 'Barra concesionada', precio: 'precio mayorista' },
}

/** El precio que corresponde según el tipo de barra del evento. */
export function precioSegun(a: Pick<ArticuloPrecio, 'precio_costo' | 'precio_mayorista'>, tipo: TipoBarra): number | null {
  return tipo === 'concesionada' ? a.precio_mayorista : a.precio_costo
}

const sinPrecio = (id: string): ArticuloPrecio => ({ id, nombre: '¿?', unidad: 'unidad', precio_costo: null, precio_mayorista: null })

export interface FilaResumen {
  articulo: ArticuloPrecio
  llevado: number
  consumido: number
  pendiente: boolean // alguna barra sin stock final
  retirosPersonal: number
  cortesias: number
  ventaEstimada: number // unidades: consumido − retiros
  porPersona: number | null
  total: number | null // consumido × precio (costo o mayorista según el tipo de barra)
}

export interface ResumenEvento {
  filas: FilaResumen[]
  barrasSinFinal: number
  totales: {
    retirosPersonal: number
    cortesias: number
    total: number | null
  }
}

/**
 * Consumido total = Venta estimada + Retiros personal + Cortesías
 *  → Venta estimada = Consumido − Retiros (en unidades).
 * Total = Consumido × precio (costo si es barra propia, mayorista si es concesionada).
 * Solo se cuentan como consumidas las líneas con stock final cargado.
 */
export function resumirEvento(
  lineas: LineaBarra[],
  retiros: Retiro[],
  articulos: ArticuloPrecio[],
  personas: number,
  tipo: TipoBarra = 'propia',
): ResumenEvento {
  const porId = new Map(articulos.map((a) => [a.id, a]))
  const filas = new Map<string, FilaResumen>()

  const fila = (id: string) => {
    let f = filas.get(id)
    if (!f) {
      f = {
        articulo: porId.get(id) ?? sinPrecio(id),
        llevado: 0, consumido: 0, pendiente: false, retirosPersonal: 0, cortesias: 0,
        ventaEstimada: 0, porPersona: null, total: null,
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

  let total: number | null = null
  let personal = 0
  let cortesias = 0
  for (const f of filas.values()) {
    f.ventaEstimada = f.consumido - f.retirosPersonal - f.cortesias
    f.porPersona = personas > 0 ? f.consumido / personas : null
    const precio = precioSegun(f.articulo, tipo)
    if (precio != null) {
      f.total = f.consumido * precio
      total = (total ?? 0) + f.total
    }
    personal += f.retirosPersonal
    cortesias += f.cortesias
  }

  return {
    filas: [...filas.values()].sort((a, b) => a.articulo.nombre.localeCompare(b.articulo.nombre, 'es')),
    barrasSinFinal: lineas.filter((l) => l.stock_final == null).length,
    totales: { retirosPersonal: personal, cortesias, total },
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
  pendiente: boolean // falta el stock final
  precio: number | null // costo o mayorista, según el tipo de barra
  total: number | null // consumido × precio
}

export interface CostosBarra {
  barra_id: string
  filas: FilaCosto[]
  total: number
}

export interface CostosEvento {
  tipo: TipoBarra
  barras: CostosBarra[]
  total: number
  sinPrecio: string[] // artículos consumidos sin el precio que corresponde
  lineasPendientes: number
}

/**
 * Total de cada barra y del evento = lo consumido × el precio que corresponde:
 *  · barra propia → precio de costo
 *  · barra concesionada → precio mayorista
 * Ejemplo: 10 cocas consumidas a $1 de costo → barra propia: $10.
 */
export function costosDelEvento(
  barras: { id: string }[],
  lineas: LineaConBarra[],
  _retiros: RetiroConBarra[],
  articulos: ArticuloPrecio[],
  tipo: TipoBarra = 'propia',
): CostosEvento {
  const porId = new Map(articulos.map((a) => [a.id, a]))
  const faltan = new Set<string>()
  let total = 0

  const resultado = barras.map((b) => {
    const filas: FilaCosto[] = lineas
      .filter((l) => l.barra_id === b.id)
      .map((l) => {
        const articulo = porId.get(l.articulo_id) ?? sinPrecio(l.articulo_id)
        const c = consumido(l)
        const cons = c ?? 0
        const precio = precioSegun(articulo, tipo)
        if (cons > 0 && precio == null) faltan.add(articulo.nombre)
        return { articulo, consumido: cons, pendiente: c == null, precio, total: precio == null ? null : cons * precio }
      })
      .sort((x, y) => x.articulo.nombre.localeCompare(y.articulo.nombre, 'es'))
    const tb = filas.reduce((t, f) => t + (f.total ?? 0), 0)
    total += tb
    return { barra_id: b.id, filas, total: tb }
  })

  return {
    tipo,
    barras: resultado,
    total,
    sinPrecio: [...faltan].sort(),
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

// ------------------------------------------------------------------ Detalle de retiros

export interface RetiroParaDetalle {
  barra_id: string
  articulo_id: string | null
  trago_id: string | null
  tipo: TipoRetiro
  cantidad: number
  retirado_por: string
  hora: string
  articulo?: { nombre: string; unidad?: 'unidad' | 'bolsa' } | null
  trago?: { nombre: string } | null
}

export interface DetalleRetiros<T> {
  lista: T[] // ordenada por hora
  cantidadRetiros: number
  unidades: number // botellas / unidades del depósito
  vasos: number // tragos y vasos
}

/**
 * Todos los retiros de un tipo (personal o cortesía), botellas Y tragos,
 * con los totales separados: las unidades de botella y los vasos no se suman entre sí.
 */
export function detalleRetiros<T extends RetiroParaDetalle>(retiros: T[], tipo: TipoRetiro): DetalleRetiros<T> {
  const lista = retiros.filter((r) => r.tipo === tipo).sort((a, b) => a.hora.localeCompare(b.hora))
  return {
    lista,
    cantidadRetiros: lista.length,
    unidades: lista.filter((r) => !r.trago_id).reduce((t, r) => t + r.cantidad, 0),
    vasos: lista.filter((r) => r.trago_id).reduce((t, r) => t + r.cantidad, 0),
  }
}

/** "3 u. y 2 vasos", "3 u.", "2 vasos" o "—" */
export function textoTotalRetiros(d: { unidades: number; vasos: number }): string {
  const partes: string[] = []
  if (d.unidades) partes.push(`${d.unidades} u.`)
  if (d.vasos) partes.push(`${d.vasos} ${d.vasos === 1 ? 'vaso' : 'vasos'}`)
  return partes.join(' y ') || '—'
}
