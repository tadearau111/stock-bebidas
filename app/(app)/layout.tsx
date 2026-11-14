'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { Boton, Cargando, cx } from '@/components/ui'
import { useSesion } from '@/lib/sesion'

const secciones = [
  { href: '/', etiqueta: 'Inicio', icono: '🏠' },
  { href: '/deposito', etiqueta: 'Depósito', icono: '📦' },
  { href: '/movimientos', etiqueta: 'Movimientos', icono: '🧾' },
  { href: '/eventos', etiqueta: 'Eventos', icono: '🎉', proximamente: true },
]

export default function LayoutApp({ children }: { children: ReactNode }) {
  const router = useRouter()
  const ruta = usePathname()
  const { cargando, session, local, locales, elegirLocal, nombre, salir } = useSesion()

  useEffect(() => {
    if (!cargando && !session) router.replace('/login')
  }, [cargando, session, router])

  if (cargando || !session) return <Cargando />

  if (!local) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="mb-2 text-xl font-bold">Tu usuario todavía no tiene acceso</h1>
        <p className="mb-6 text-suave">Pedile a la administradora que te asigne un rol.</p>
        <Boton variante="secundario" onClick={salir}>
          Salir
        </Boton>
      </main>
    )
  }

  const activa = (href: string) => (href === '/' ? ruta === '/' : ruta.startsWith(href))

  return (
    <div className="min-h-dvh md:flex">
      {/* Menú lateral (computadora) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-borde bg-white md:flex">
        <div className="px-5 py-5">
          <p className="text-lg font-bold">🍾 Stock de Bebidas</p>
          <p className="text-sm text-suave">{local.local_nombre}</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {secciones.map((s) => (
            <ItemMenu key={s.href} {...s} activa={activa(s.href)} />
          ))}
        </nav>
        <PieUsuario nombre={nombre} rol={local.rol} salir={salir} />
      </aside>

      <div className="min-w-0 flex-1">
        {/* Barra superior (celular) */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-borde bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <div>
            <p className="font-bold leading-tight">🍾 Stock de Bebidas</p>
            {locales.length > 1 && <p className="text-xs text-suave">{local.local_nombre}</p>}
          </div>
          <button onClick={salir} className="rounded-lg px-2 py-1 text-sm text-suave hover:bg-fondo">
            Salir
          </button>
        </header>

        {locales.length > 1 && (
          <div className="border-b border-borde bg-white px-4 py-2 md:px-8">
            <label className="text-sm text-suave">
              Local:{' '}
              <select
                value={local.local_id}
                onChange={(e) => elegirLocal(e.target.value)}
                className="rounded border border-borde bg-white px-2 py-1 text-tinta"
              >
                {locales.map((l) => (
                  <option key={l.local_id} value={l.local_id}>
                    {l.local_nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>
      </div>

      {/* Menú inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-borde bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {secciones.map((s) => (
          <Link
            key={s.href}
            href={s.proximamente ? '#' : s.href}
            aria-disabled={s.proximamente}
            className={cx(
              'flex flex-col items-center gap-0.5 py-2 text-xs',
              activa(s.href) ? 'font-semibold text-marca-700' : 'text-suave',
              s.proximamente && 'pointer-events-none opacity-40',
            )}
          >
            <span className="text-xl leading-none">{s.icono}</span>
            {s.etiqueta}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function ItemMenu({ href, etiqueta, icono, activa, proximamente }: (typeof secciones)[number] & { activa: boolean }) {
  if (proximamente) {
    return (
      <span className="flex items-center gap-3 rounded-lg px-3 py-2 text-suave/60">
        <span>{icono}</span>
        {etiqueta}
        <span className="ml-auto text-xs">Fase 2</span>
      </span>
    )
  }
  return (
    <Link
      href={href}
      className={cx(
        'flex items-center gap-3 rounded-lg px-3 py-2',
        activa ? 'bg-marca-50 font-semibold text-marca-700' : 'text-tinta hover:bg-fondo',
      )}
    >
      <span>{icono}</span>
      {etiqueta}
    </Link>
  )
}

function PieUsuario({ nombre, rol, salir }: { nombre: string; rol: string; salir: () => void }) {
  return (
    <div className="border-t border-borde px-5 py-4">
      <p className="truncate text-sm font-medium">{nombre}</p>
      <p className="mb-2 text-xs text-suave">{rol}</p>
      <button onClick={salir} className="text-sm text-marca-700 hover:underline">
        Cerrar sesión
      </button>
    </div>
  )
}
