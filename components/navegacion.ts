import type { ReactNode, SVGProps } from 'react'
import { IconoDeposito, IconoEventos, IconoHistorial, IconoInfo, IconoInicio, IconoCajaFuerte, IconoMovimientos, IconoPapelera, IconoTareas, IconoUsuarios } from '@/components/marca'
import type { Permiso } from '@/lib/tipos'

export interface Seccion {
  href: string
  etiqueta: string
  Icono: (p: SVGProps<SVGSVGElement>) => ReactNode
  permiso?: Permiso
  activaEn?: string[]
}

export const secciones: Seccion[] = [
  { href: '/', etiqueta: 'Inicio', Icono: IconoInicio },
  { href: '/eventos', etiqueta: 'Eventos', Icono: IconoEventos, activaEn: ['/evento'] },
  { href: '/info', etiqueta: 'Info', Icono: IconoInfo, permiso: 'info.ver' },
  { href: '/deposito', etiqueta: 'Depósito', Icono: IconoDeposito, permiso: 'deposito.ver' },
  { href: '/movimientos', etiqueta: 'Movimientos', Icono: IconoMovimientos, permiso: 'deposito.ver' },
  { href: '/caja-fuerte', etiqueta: 'Caja fuerte', Icono: IconoCajaFuerte, permiso: 'caja_fuerte.gestionar' },
  { href: '/tareas-semana', etiqueta: 'Tareas semana', Icono: IconoTareas, permiso: 'caja_fuerte.gestionar' },
  { href: '/usuarios', etiqueta: 'Usuarios', Icono: IconoUsuarios, permiso: 'usuarios.gestionar' },
  { href: '/historial', etiqueta: 'Historial', Icono: IconoHistorial, permiso: 'historial.ver' },
  { href: '/papelera', etiqueta: 'Papelera', Icono: IconoPapelera, permiso: 'papelera.gestionar' },
]
