import type { Metadata, Viewport } from 'next'
import { Proveedores } from '@/lib/sesion'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stock de Bebidas',
  description: 'Control del depósito y de las barras de cada evento',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#17725c',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es-AR" className="h-full antialiased">
      <body className="min-h-full">
        <Proveedores>{children}</Proveedores>
      </body>
    </html>
  )
}
