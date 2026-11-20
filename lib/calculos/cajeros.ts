// Cajeros de la noche: retiros de dinero de cada caja y su cierre
// (solo control: no suma ni resta en la venta ni en la Caja del evento).
//
// Efectivo real de un cajero = el total de sus retiros de la noche
// (el último retiro, al cerrar, es lo que quedó en la caja).
// Diferencia efectivo = efectivo real − efectivo sistema (negativo: falta plata)
// Diferencia tarjetas = cierre de lotes − tarjetas sistema

import type { CajeroDB, RetiroCajeroDB } from '../tipos'

export interface ResumenCajero {
  cajero: CajeroDB
  retiros: RetiroCajeroDB[] // de más viejo a más nuevo
  /** Total retirado = efectivo real */
  total: number
  efectivoSistema: number | null
  tarjetasSistema: number | null
  cierreLotes: number | null
  /** null mientras no se cargó lo del sistema */
  diferenciaEfectivo: number | null
  /** null mientras no se cargó nada de tarjetas */
  diferenciaTarjetas: number | null
}

export interface ResumenCajeros {
  cajeros: ResumenCajero[]
  total: number
  cantidad: number
  /** Sumas de todos los cajeros */
  efectivoSistema: number
  tarjetasSistema: number
  cierreLotes: number
  diferenciaEfectivo: number | null
  diferenciaTarjetas: number | null
}

const centavos = (v: number) => Math.round(v * 100) / 100
const num = (v: number | null | undefined) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))
const suma = (vs: (number | null)[]) => centavos(vs.reduce<number>((t, v) => t + (v ?? 0), 0))

export function resumirCajeros(cajeros: CajeroDB[], retiros: RetiroCajeroDB[]): ResumenCajeros {
  const lista: ResumenCajero[] = cajeros.map((c) => {
    const rs = retiros.filter((r) => r.cajero_id === c.id).sort((a, b) => a.hora.localeCompare(b.hora))
    const total = centavos(rs.reduce((t, r) => t + Number(r.monto), 0))
    const efectivoSistema = num(c.efectivo_sistema)
    const tarjetasSistema = num(c.tarjetas_sistema)
    const cierreLotes = num(c.cierre_lotes)
    return {
      cajero: c,
      retiros: rs,
      total,
      efectivoSistema,
      tarjetasSistema,
      cierreLotes,
      diferenciaEfectivo: efectivoSistema == null ? null : centavos(total - efectivoSistema),
      diferenciaTarjetas: tarjetasSistema == null && cierreLotes == null ? null : centavos((cierreLotes ?? 0) - (tarjetasSistema ?? 0)),
    }
  })
  const conEfectivo = lista.filter((c) => c.diferenciaEfectivo != null)
  const conTarjetas = lista.filter((c) => c.diferenciaTarjetas != null)
  return {
    cajeros: lista,
    total: suma(lista.map((c) => c.total)),
    cantidad: lista.reduce((t, c) => t + c.retiros.length, 0),
    efectivoSistema: suma(lista.map((c) => c.efectivoSistema)),
    tarjetasSistema: suma(lista.map((c) => c.tarjetasSistema)),
    cierreLotes: suma(lista.map((c) => c.cierreLotes)),
    diferenciaEfectivo: conEfectivo.length ? suma(conEfectivo.map((c) => c.diferenciaEfectivo)) : null,
    diferenciaTarjetas: conTarjetas.length ? suma(conTarjetas.map((c) => c.diferenciaTarjetas)) : null,
  }
}
