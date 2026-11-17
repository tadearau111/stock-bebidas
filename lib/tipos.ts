import type { DatosCaja } from './calculos/caja'
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
  precio_venta: number | null
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
  'nombre' | 'marca' | 'tamano' | 'unidad' | 'stock_minimo' | 'precio_costo' | 'precio_venta'
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
  articulo?: { nombre: string; unidad: Unidad } | null
  autor?: { nombre: string } | null
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
  | 'usuarios.gestionar'
  | 'historial.ver'

// ------------------------------------------------------------------ Eventos

export interface Evento {
  id: string
  local_id: string
  fecha: string // AAAA-MM-DD
  nombre: string
  personas: number
  notas: string | null
  creado_en: string
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

export interface DetalleEvento {
  evento: Evento
  barras: Barra[]
  lineas: LineaBarraDB[]
  retiros: RetiroDB[]
  bebidaAbierta: BebidaAbiertaDB[]
  caja: CajaDB | null
  gastos: GastoDB[]
}
