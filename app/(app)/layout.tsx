'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { EstadoConexion, Sincronizador } from '@/components/Conexion'
import { IconoMas, Marca } from '@/components/marca'
import { secciones } from '@/components/navegacion'
import { Boton, Cargando, cx } from '@/components/ui'
import { useSesion } from '@/lib/sesion'


export default function LayoutApp({ children }: { children: ReactNode }) {
  const router = useRouter()
  const ruta = usePathname()
  const { cargando, session, local, locales, elegirLocal, nombre, salir, puede } = useSesion()

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

  const visibles = secciones.filter((s) => !s.permiso || puede(s.permiso))
  // En el celular entran 5 botones: si hay más, los últimos van a "Más"
  const enCelular =
    visibles.length <= 5
      ? visibles
      : [...visibles.slice(0, 4), { href: '/mas', etiqueta: 'Más', Icono: IconoMas, activaEn: visibles.slice(4).map((s) => s.href) }]
  const activa = (s: (typeof secciones)[number]) =>
    s.href === '/' ? ruta === '/' : ruta === s.href || ruta.startsWith(s.href + '/') || !!s.activaEn?.includes(ruta)

  return (
    <div className="min-h-dvh md:flex">
      {/* Menú lateral (computadora) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-borde bg-superficie md:flex">
        <div className="px-5 py-6">
          <Marca subtitulo={local.local_nombre} />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {visibles.map((s) => (
            <ItemMenu key={s.href} href={s.href} etiqueta={s.etiqueta} Icono={s.Icono} activa={activa(s)} />
          ))}
        </nav>
        <PieUsuario nombre={nombre} rol={local.rol} salir={salir} />
      </aside>

      <div className="min-w-0 flex-1">
        {/* Barra superior (celular) */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-borde bg-fondo/85 px-4 py-3 backdrop-blur md:hidden">
          <Marca subtitulo={locales.length > 1 ? local.local_nombre : undefined} />
          <button onClick={salir} className="rounded-lg px-2 py-1 text-sm text-suave hover:bg-realce">
            Salir
          </button>
        </header>

        {locales.length > 1 && (
          <div className="border-b border-borde bg-superficie px-4 py-2 md:px-8">
            <label className="text-sm text-suave">
              Local:{' '}
              <select
                value={local.local_id}
                onChange={(e) => elegirLocal(e.target.value)}
                className="rounded border border-borde bg-superficie px-2 py-1 text-tinta"
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

        <EstadoConexion />
        <Sincronizador />
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>
      </div>

      {/* Menú inferior (celular) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 grid border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${enCelular.length}, minmax(0, 1fr))` }}
      >
        {enCelular.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={cx('flex flex-col items-center gap-0.5 py-2 text-xs', activa(s) ? 'font-semibold text-marca-700' : 'text-suave')}
          >
            <s.Icono width={22} height={22} />
            {s.etiqueta}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function ItemMenu({
  href,
  etiqueta,
  Icono,
  activa,
}: Pick<(typeof secciones)[number], 'href' | 'etiqueta' | 'Icono'> & { activa: boolean }) {
  return (
    <Link
      href={href}
      className={cx(
        'flex items-center gap-3 rounded-lg px-3 py-2',
        activa ? 'bg-marca-50 font-semibold text-marca-700 ring-1 ring-borde' : 'text-suave hover:bg-realce hover:text-tinta',
      )}
    >
      <Icono />
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
