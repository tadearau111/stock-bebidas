// Caja fuerte: libro de efectivo armado con la caja de cada evento
// (efectivo real − gastos) y los retiros / ingresos manuales.

export interface AporteEvento {
  evento_id: string
  fecha: string // AAAA-MM-DD del evento
  nombre: string
  efectivo: number
  gastos: number
  /** Detalle de cada gasto del evento (para qué fue y cuánto) */
  gastos_detalle?: { detalle: string; monto: number }[]
}

export interface MovimientoManual {
  id: string
  tipo: 'retiro' | 'ingreso' | 'pago'
  monto: number
  detalle: string
  /** En los pagos de tareas: a quién se le pagó */
  persona?: string | null
  /** En los pagos de tareas: horas trabajadas (opcional) */
  horas?: number | null
  fecha: string // ISO
  autor?: string | null
}

export type Renglon =
  | { clase: 'efectivo'; clave: string; fecha: string; evento: AporteEvento; monto: number; saldo: number }
  | { clase: 'gastos'; clave: string; fecha: string; evento: AporteEvento; monto: number; saldo: number }
  | { clase: 'retiro' | 'ingreso' | 'pago'; clave: string; fecha: string; mov: MovimientoManual; monto: number; saldo: number }

export interface LibroCajaFuerte {
  renglones: Renglon[] // en orden cronológico, con el saldo después de cada uno
  saldo: number
  totalEfectivo: number
  totalGastos: number
  totalRetiros: number
  totalIngresos: number
  totalPagos: number
}

const centavos = (v: number) => Math.round(v * 100) / 100

/** 4 → "4 h", 1.5 → "1,5 h" */
export const textoHoras = (h: number) => `${h.toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`

/** Renglón todavía sin el saldo calculado (Omit que respeta cada variante). */
type SinSaldo<T> = T extends unknown ? Omit<T, 'saldo'> : never

/** Clave para ordenar: los eventos van al final de su día, los manuales por su hora. */
const claveOrden = (fecha: string) => (fecha.length === 10 ? `${fecha}T23:59:59.999` : fecha)

export function armarLibro(eventos: AporteEvento[], manuales: MovimientoManual[]): LibroCajaFuerte {
  type Base = { fecha: string; orden: string; filas: SinSaldo<Renglon>[] }
  const bloques: Base[] = []

  for (const e of eventos) {
    const filas: SinSaldo<Renglon>[] = []
    if (e.efectivo) filas.push({ clase: 'efectivo', clave: `${e.evento_id}-e`, fecha: e.fecha, evento: e, monto: centavos(e.efectivo) })
    if (e.gastos) filas.push({ clase: 'gastos', clave: `${e.evento_id}-g`, fecha: e.fecha, evento: e, monto: -centavos(e.gastos) })
    if (filas.length) bloques.push({ fecha: e.fecha, orden: claveOrden(e.fecha), filas })
  }
  for (const m of manuales) {
    const monto = m.tipo === 'ingreso' ? centavos(m.monto) : -centavos(m.monto)
    bloques.push({ fecha: m.fecha, orden: claveOrden(m.fecha), filas: [{ clase: m.tipo, clave: m.id, fecha: m.fecha, mov: m, monto }] })
  }
  bloques.sort((a, b) => a.orden.localeCompare(b.orden))

  let saldo = 0
  const renglones: Renglon[] = []
  for (const b of bloques) {
    for (const f of b.filas) {
      saldo = centavos(saldo + f.monto)
      renglones.push({ ...f, saldo } as Renglon)
    }
  }

  const suma = (clase: Renglon['clase']) => centavos(Math.abs(renglones.filter((r) => r.clase === clase).reduce((t, r) => t + r.monto, 0)))
  return {
    renglones,
    saldo,
    totalEfectivo: suma('efectivo'),
    totalGastos: suma('gastos'),
    totalRetiros: suma('retiro'),
    totalIngresos: suma('ingreso'),
    totalPagos: suma('pago'),
  }
}

// ------------------------------------------------------------------ Resumen mensual

/** Renglón en formato simple: el mismo para lo calculado en vivo y para lo guardado en un cierre. */
export interface RenglonResumen {
  clase: Renglon['clase']
  fecha: string
  titulo: string
  detalle: string
  monto: number
  saldo: number
  evento_id: string | null
  /** En los renglones de gastos: el detalle de cada gasto */
  items?: { detalle: string; monto: number }[]
  /** En retiros/ingresos/pagos: id del movimiento (para editarlo) */
  ref?: string
}

export interface ResumenMes {
  anio: number
  mes: number // 1..12
  clave: string // "2026-11"
  saldo_inicial: number
  efectivo: number
  gastos: number
  retiros: number
  ingresos: number
  /** Pagos de tareas de la semana (sueldos, changas) */
  pagos: number
  saldo_final: number
  renglones: RenglonResumen[]
}

export function aRenglonResumen(r: Renglon): RenglonResumen {
  if (r.clase === 'efectivo' || r.clase === 'gastos') {
    return {
      clase: r.clase,
      fecha: r.fecha,
      titulo: r.clase === 'efectivo' ? 'Efectivo real' : 'Gastos',
      detalle: r.evento.nombre,
      monto: r.monto,
      saldo: r.saldo,
      evento_id: r.evento.evento_id,
      ...(r.clase === 'gastos' ? { items: (r.evento.gastos_detalle ?? []).map((g) => ({ detalle: g.detalle, monto: Number(g.monto) })) } : {}),
    }
  }
  return {
    clase: r.clase,
    fecha: r.fecha,
    titulo: r.clase === 'retiro' ? 'Retiro' : r.clase === 'pago' ? 'Pago de tareas' : 'Ingreso',
    detalle:
      (r.clase === 'pago' && r.mov.persona ? `${r.mov.persona}: ` : '') +
      r.mov.detalle +
      (r.clase === 'pago' && r.mov.horas ? ` (${textoHoras(r.mov.horas)})` : '') +
      (r.mov.autor ? ` (cargó ${r.mov.autor})` : ''),
    monto: r.monto,
    saldo: r.saldo,
    evento_id: null,
    ref: r.mov.id,
  }
}

const claveMes = (fecha: string) => fecha.slice(0, 7)

/** "2026-11" del momento actual (hora local). */
export function mesActual(hoy = new Date()): string {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Agrupa el libro por mes (de más viejo a más nuevo). Incluye siempre el mes
 * actual aunque no tenga movimientos. El saldo inicial de cada mes es el
 * saldo con que cerró el anterior.
 */
export function resumirPorMes(libro: LibroCajaFuerte, hoy = new Date()): ResumenMes[] {
  const claves = new Set(libro.renglones.map((r) => claveMes(r.fecha)))
  claves.add(mesActual(hoy))
  const ordenadas = [...claves].sort()
  let saldo = 0
  return ordenadas.map((clave) => {
    const rs = libro.renglones.filter((r) => claveMes(r.fecha) === clave)
    const suma = (c: Renglon['clase']) => centavos(Math.abs(rs.filter((r) => r.clase === c).reduce((t, r) => t + r.monto, 0)))
    const inicial = saldo
    saldo = rs.length ? rs[rs.length - 1].saldo : saldo
    const [anio, mes] = clave.split('-').map(Number)
    return {
      anio,
      mes,
      clave,
      saldo_inicial: inicial,
      efectivo: suma('efectivo'),
      gastos: suma('gastos'),
      retiros: suma('retiro'),
      ingresos: suma('ingreso'),
      pagos: suma('pago'),
      saldo_final: saldo,
      renglones: rs.map(aRenglonResumen),
    }
  })
}

/** ¿Lo guardado en el cierre es distinto a lo que da hoy? (compara totales y saldos) */
export function cierreDesactualizado(guardado: Omit<ResumenMes, 'clave' | 'renglones' | 'pagos'> & { pagos?: number }, actual: ResumenMes): boolean {
  const campos = ['saldo_inicial', 'efectivo', 'gastos', 'retiros', 'ingresos', 'pagos', 'saldo_final'] as const
  return campos.some((c) => centavos(Number(guardado[c] ?? 0)) !== centavos(actual[c]))
}

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const nombreMes = (mes: number) => NOMBRES_MES[mes - 1]

// ------------------------------------------------------------------ Saldo arrastrado mes a mes

export interface CierreGuardado extends Omit<ResumenMes, 'clave'> {
  id?: string
}

export interface MesEncadenado {
  clave: string
  anio: number
  mes: number
  /** Lo que da con los datos de hoy, empezando con el saldo arrastrado del mes anterior */
  vivo: ResumenMes
  /** El resumen guardado al cerrar el mes (si existe) */
  guardado: CierreGuardado | null
  /** Lo que se muestra: lo guardado manda; si no hay, lo de hoy */
  mostrado: ResumenMes
  desactualizado: boolean
}

/** Rearma un mes empezando desde otro saldo inicial (recalcula el saldo de cada renglón). */
function desdeSaldo(m: ResumenMes, inicial: number): ResumenMes {
  let saldo = inicial
  const renglones = m.renglones.map((r) => {
    saldo = centavos(saldo + r.monto)
    return { ...r, saldo }
  })
  return { ...m, saldo_inicial: centavos(inicial), saldo_final: saldo, renglones }
}

/**
 * Encadena los meses: cada mes arranca con el saldo con que CERRÓ el anterior.
 * Si el mes anterior tiene un resumen guardado, manda lo guardado (así, si
 * después se borra un evento viejo, el saldo de los meses siguientes no cambia;
 * solo se avisa en ese mes que quedó desactualizado).
 */
export function encadenarMeses(meses: ResumenMes[], cierres: CierreGuardado[], hoy = new Date()): { meses: MesEncadenado[]; saldoActual: number } {
  const clave = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`
  const vivos = new Map(meses.map((m) => [m.clave, m]))
  const guardados = new Map(cierres.map((c) => [clave(c.anio, c.mes), c]))
  const claves = [...new Set([...vivos.keys(), ...guardados.keys(), mesActual(hoy)])].sort()

  let arrastre = 0
  const salida: MesEncadenado[] = []
  for (const k of claves) {
    const [anio, mes] = k.split('-').map(Number)
    const base: ResumenMes = vivos.get(k) ?? { anio, mes, clave: k, saldo_inicial: 0, efectivo: 0, gastos: 0, retiros: 0, ingresos: 0, pagos: 0, saldo_final: 0, renglones: [] }
    const vivo = desdeSaldo(base, arrastre)
    const guardado = guardados.get(k) ?? null
    const desactualizado = !!guardado && cierreDesactualizado(guardado, vivo)
    const mostrado: ResumenMes = guardado ? { ...guardado, pagos: Number(guardado.pagos ?? 0), clave: k } : vivo
    salida.push({ clave: k, anio, mes, vivo, guardado, mostrado, desactualizado })
    arrastre = mostrado.saldo_final
  }
  return { meses: salida, saldoActual: arrastre }
}
