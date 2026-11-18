import type { MetadataRoute } from 'next'

/** Datos para instalar la plataforma como app en el celular o la computadora. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HUB · Stock de Bebidas',
    short_name: 'HUB Stock',
    description: 'Control del depósito y de las barras de cada evento',
    lang: 'es-AR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#050505',
    theme_color: '#050505',
    icons: [
      { src: '/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
