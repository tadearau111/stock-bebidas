import Image from 'next/image'
import type { SVGProps } from 'react'

/** Logo HUB (líneas blancas sobre fondo transparente). */
export function Logo({ tamano = 40, className }: { tamano?: number; className?: string }) {
  return (
    <Image
      src="/logo-hub.png"
      alt="HUB"
      width={tamano}
      height={Math.round((tamano * 104) / 90)}
      className={className}
      priority
    />
  )
}

/** Logo + nombre de la plataforma. */
export function Marca({ subtitulo }: { subtitulo?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Logo tamano={30} />
      <div className="leading-tight">
        <p className="texto-plata text-base font-semibold tracking-tight">Stock de Bebidas</p>
        {subtitulo && <p className="text-xs text-suave">{subtitulo}</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Íconos de línea

type Icono = SVGProps<SVGSVGElement>

function Base({ children, ...p }: Icono) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  )
}

export const IconoInicio = (p: Icono) => (
  <Base {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </Base>
)

export const IconoDeposito = (p: Icono) => (
  <Base {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="M3 8l9 5 9-5" />
    <path d="M12 13v8" />
  </Base>
)

export const IconoMovimientos = (p: Icono) => (
  <Base {...p}>
    <path d="M7 4v16" />
    <path d="m3 8 4-4 4 4" />
    <path d="M17 20V4" />
    <path d="m21 16-4 4-4-4" />
  </Base>
)

export const IconoEventos = (p: Icono) => (
  <Base {...p}>
    <path d="M8 3h8l-1 7a3 3 0 0 1-6 0L8 3Z" />
    <path d="M12 13v7" />
    <path d="M8.5 21h7" />
  </Base>
)

export const IconoIngreso = (p: Icono) => (
  <Base {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 17v3h16v-3" />
  </Base>
)

export const IconoCarrito = (p: Icono) => (
  <Base {...p}>
    <path d="M3 4h2l2.4 11h11L21 7H6.2" />
    <circle cx="9" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </Base>
)

export const IconoBuscar = (p: Icono) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
)

export const IconoUsuarios = (p: Icono) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
    <path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </Base>
)

export const IconoHistorial = (p: Icono) => (
  <Base {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4.5h4.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
)

export const IconoMas = (p: Icono) => (
  <Base {...p}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </Base>
)
