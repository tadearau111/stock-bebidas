// Caja fuerte: libro de efectivo armado con la caja de cada evento
// (efectivo real − gastos) y los retiros / ingresos manuales.

export interface AporteEvento {
  evento_id: string
  fecha: string // AAAA-MM-DD del evento
  nombre: string
  efectivo: number
  gastos: number
}

export interface MovimientoManual {
  id: string
  tipo: 'retiro' | 'ingreso'
  monto: number
  detalle: string
  fecha: string // ISO
  autor?: string | null
}

export type Renglon =
  | { clase: 'efectivo'; clave: string; fecha: string; evento: AporteEvento; monto: number; saldo: number }
  | { clase: 'gastos'; clave: string; fecha: string; evento: AporteEvento; monto: number; saldo: number }
  | { clase: 'retiro' | 'ingreso'; clave: string; fecha: string; mov: MovimientoManual; monto: number; saldo: number }

export interface LibroCajaFuerte {
  renglones: Renglon[] // en orden cronológico, con el saldo después de cada uno
  saldo: number
  totalEfectivo: number
  totalGastos: number
  totalRetiros: number
  totalIngresos: number
}

const centavos = (v: number) => Math.round(v * 100) / 100

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
    const monto = m.tipo === 'retiro' ? -centavos(m.monto) : centavos(m.monto)
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
  }
}
