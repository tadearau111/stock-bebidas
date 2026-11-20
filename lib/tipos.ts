import type { DatosCaja } from './calculos/caja'
import type { TipoBarra } from './calculos/evento'
import type { TipoMovimiento } from './calculos/stock'

export type Unidad = 'unidad' | 'bolsa'

export interface Articulo {
  id: string
  local_id: string
  nombre: string
  marca: string | null
  tamano: string | null
  unidad: Unidad
  stock_minimo: number
  precio_costo: number | null
  precio_mayorista: number | null
  activo: boolean
  creado_en: string
  actualizado_en: string
  // calculados por la vista stock_articulos
  stock_actual: number
  bajo_minimo: boolean
  faltante: number
  cantidad_movimientos: number
}

export type ArticuloEditable = Pick<
  Articulo,
  'nombre' | 'marca' | 'tamano' | 'unidad' | 'stock_minimo' | 'precio_costo' | 'precio_mayorista'
>

export interface Movimiento {
  id: string
  local_id: string
  articulo_id: string
  tipo: TipoMovimiento
  cantidad: number
  motivo: string | null
  fecha: string
  creado_por: string | null
  creado_en: string
  proveedor_id: string | null
  articulo?: { nombre: string; unidad: Unidad } | null
  proveedor?: { nombre: string } | null
  autor?: { nombre: string } | null
}

export interface Proveedor {
  id: string
  local_id: string
  nombre: string
  activo: boolean
}

export interface AccesoLocal {
  local_id: string
  local_nombre: string
  rol: string
  permisos: string[]
}

export type Permiso =
  | 'deposito.ver'
  | 'ingresos.cargar'
  | 'deposito.ajustar'
  | 'articulos.editar'
  | 'eventos.gestionar'
  | 'eventos.cargar'
  | 'eventos.caja'
  | 'eventos.resumen'
  | 'precios.ver'
  | 'usuarios.gestionar'
  | 'historial.ver'
  | 'info.ver'
  | 'info.editar'
  | 'papelera.gestionar'
  | 'caja_fuerte.gestionar'

// ------------------------------------------------------------------ Eventos

export interface Evento {
  id: string
  local_id: string
  fecha: string // AAAA-MM-DD
  nombre: string
  personas: number
  notas: string | null
  creado_en: string
  tipo_barra: TipoBarra
  archivado: boolean
  archivado_en: string | null
}

export interface Barra {
  id: string
  evento_id: string
  nombre: string
  orden: number
}

export interface Reposicion {
  id: string
  barra_articulo_id: string
  tipo: 'detalle' | 'total'
  cantidad: number
  hora: string
  autor?: { nombre: string } | null
}

export interface LineaBarraDB {
  id: string
  barra_id: string
  articulo_id: string
  stock_inicial: number
  stock_final: number | null
  articulo: { nombre: string; unidad: Unidad; marca: string | null; tamano: string | null }
  reposiciones: Reposicion[]
}

export interface RetiroDB {
  id: string
  barra_id: string
  articulo_id: string | null // botella de la barra…
  trago_id: string | null // …o un trago/vaso (solo cortesías)
  tipo: 'personal' | 'cortesia'
  cantidad: number
  retirado_por: string
  hora: string
  articulo?: { nombre: string; unidad: Unidad } | null
  trago?: { nombre: string } | null
  autor?: { nombre: string } | null
}

/** Trago o vaso que se puede dar de cortesía (se cuenta en vasos). */
export interface Trago {
  id: string
  local_id: string
  nombre: string
  activo: boolean
}

export interface BebidaAbiertaDB {
  id: string
  articulo_id: string
  cuartos: number
  hora: string
  articulo?: { nombre: string } | null
  autor?: { nombre: string } | null
}

export interface CajaDB extends DatosCaja {
  evento_id: string
  notas: string | null
  actualizado_en: string
  actualizado_por: string | null
}

export interface GastoDB {
  id: string
  evento_id: string
  monto: number
  detalle: string
  hora: string
  autor?: { nombre: string } | null
}

/** Cajero de la noche (solo para controlar los retiros de dinero) */
export interface CajeroDB {
  id: string
  evento_id: string
  nombre: string
  orden: number
  /** Cierre de su caja (lo que dice el sistema de venta y los posnet) */
  efectivo_sistema?: number | null
  tarjetas_sistema?: number | null
  cierre_lotes?: number | null
}

/** Retiro de dinero que se le hace a un cajero durante la noche (solo control) */
export interface RetiroCajeroDB {
  id: string
  cajero_id: string
  evento_id: string
  monto: number
  hora: string
  notas: string | null
  autor?: { nombre: string } | null
}

export interface DetalleEvento {
  evento: Evento
  barras: Barra[]
  lineas: LineaBarraDB[]
  retiros: RetiroDB[]
  bebidaAbierta: BebidaAbiertaDB[]
  caja: CajaDB | null
  gastos: GastoDB[]
  cajeros: CajeroDB[]
  retirosCajeros: RetiroCajeroDB[]
}

// ------------------------------------------------------------------ Info

export interface NotaInfo {
  id: string
  local_id: string
  fecha: string
  evento_id: string | null
  titulo: string
  hora_apertura: string | null // "21:00:00"
  hora_cierre: string | null
  personal: { rol: string; cantidad: number | null; detalle: string }[]
  notas: string | null
  actualizado_en: string
  evento?: { nombre: string } | null
}
