import type { ReactNode, SVGProps } from 'react'
import { IconoDeposito, IconoEventos, IconoHistorial, IconoInicio, IconoMovimientos, IconoUsuarios } from '@/components/marca'
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
  { href: '/deposito', etiqueta: 'Depósito', Icono: IconoDeposito, permiso: 'deposito.ver' },
  { href: '/movimientos', etiqueta: 'Movimientos', Icono: IconoMovimientos, permiso: 'deposito.ver' },
  { href: '/usuarios', etiqueta: 'Usuarios', Icono: IconoUsuarios, permiso: 'usuarios.gestionar' },
  { href: '/historial', etiqueta: 'Historial', Icono: IconoHistorial, permiso: 'historial.ver' },
]
