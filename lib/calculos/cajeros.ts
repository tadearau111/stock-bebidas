// Cajeros de la noche: retiros de dinero de cada caja (solo control, no suma ni resta en la venta).

import type { CajeroDB, RetiroCajeroDB } from '../tipos'

export interface ResumenCajero {
  cajero: CajeroDB
  retiros: RetiroCajeroDB[] // de más viejo a más nuevo
  total: number
}

const centavos = (v: number) => Math.round(v * 100) / 100

export function resumirCajeros(cajeros: CajeroDB[], retiros: RetiroCajeroDB[]): { cajeros: ResumenCajero[]; total: number; cantidad: number } {
  const lista = cajeros.map((c) => {
    const rs = retiros.filter((r) => r.cajero_id === c.id).sort((a, b) => a.hora.localeCompare(b.hora))
    return { cajero: c, retiros: rs, total: centavos(rs.reduce((t, r) => t + Number(r.monto), 0)) }
  })
  return {
    cajeros: lista,
    total: centavos(lista.reduce((t, c) => t + c.total, 0)),
    cantidad: lista.reduce((t, c) => t + c.retiros.length, 0),
  }
}
