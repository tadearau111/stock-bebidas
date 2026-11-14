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
