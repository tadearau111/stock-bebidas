// Caja del evento. Los campos vacíos cuentan como 0.

export interface DatosCaja {
  efectivo_real: number | null
  efectivo_sistema: number | null
  cierre_lotes: number | null
  tarjetas_sistema: number | null
  boleteria_efectivo: number | null
  boleteria_lotes: number | null
  guardarropas_efectivo: number | null
  guardarropas_lotes: number | null
  cambio_proxima_caja: number | null
  vasos_no_devueltos: number | null
}

export const CAJA_VACIA: DatosCaja = {
  efectivo_real: null,
  efectivo_sistema: null,
  cierre_lotes: null,
  tarjetas_sistema: null,
  boleteria_efectivo: null,
  boleteria_lotes: null,
  guardarropas_efectivo: null,
  guardarropas_lotes: null,
  cambio_proxima_caja: null,
  vasos_no_devueltos: null,
}

export interface ResultadoCaja {
  diferenciaEfectivo: number // efectivo real − efectivo sistema (negativo = falta plata)
  diferenciaTarjetas: number // cierre de lotes − tarjetas sistema
  ventaCaja: number // barras: efectivo real + cierre de lotes
  totalBoleteria: number
  totalGuardarropas: number
  totalGastos: number
  efectivoTotal: number // efectivo de barras + boletería + guardarropas
  retiroCajaFuerte: number // efectivo total − gastos − cambio para la próxima caja
  ventaTotalGeneral: number // venta caja + boletería + guardarropas
}

const n = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? 0 : Number(v))

/** Redondea a centavos para evitar errores de decimales (0,1 + 0,2). */
const centavos = (v: number) => Math.round(v * 100) / 100

export function calcularCaja(c: DatosCaja, gastos: { monto: number }[]): ResultadoCaja {
  const totalGastos = centavos(gastos.reduce((t, g) => t + n(g.monto), 0))
  const ventaCaja = centavos(n(c.efectivo_real) + n(c.cierre_lotes))
  const totalBoleteria = centavos(n(c.boleteria_efectivo) + n(c.boleteria_lotes))
  const totalGuardarropas = centavos(n(c.guardarropas_efectivo) + n(c.guardarropas_lotes))
  const efectivoTotal = centavos(n(c.efectivo_real) + n(c.boleteria_efectivo) + n(c.guardarropas_efectivo))
  return {
    diferenciaEfectivo: centavos(n(c.efectivo_real) - n(c.efectivo_sistema)),
    diferenciaTarjetas: centavos(n(c.cierre_lotes) - n(c.tarjetas_sistema)),
    ventaCaja,
    totalBoleteria,
    totalGuardarropas,
    totalGastos,
    efectivoTotal,
    retiroCajaFuerte: centavos(efectivoTotal - totalGastos - n(c.cambio_proxima_caja)),
    ventaTotalGeneral: centavos(ventaCaja + totalBoleteria + totalGuardarropas),
  }
}

/** ¿Se cargó algo en la caja? */
export function cajaCargada(c: DatosCaja | null | undefined, gastos: unknown[]): boolean {
  if (gastos.length) return true
  if (!c) return false
  return Object.values(c).some((v) => v != null)
}

/** "Sobran $500", "Faltan $500" o "Coincide" */
export function textoDiferencia(dif: number, formato: (v: number) => string): string {
  if (dif === 0) return 'Coincide'
  return dif > 0 ? `Sobran ${formato(dif)}` : `Faltan ${formato(-dif)}`
}
