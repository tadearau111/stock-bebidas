'use client'

import Link from 'next/link'
import { InstalarApp } from '@/components/AppInstalable'
import { secciones } from '@/components/navegacion'
import { Boton, Tarjeta } from '@/components/ui'
import { useSesion } from '@/lib/sesion'

/** En el celular: las secciones que no entran en el menú de abajo. */
export default function PaginaMas() {
  const { puede, nombre, local, salir } = useSesion()
  const visibles = secciones.filter((s) => !s.permiso || puede(s.permiso))
  const extra = visibles.length > 5 ? visibles.slice(4) : []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Más</h1>
      {extra.length > 0 && (
        <Tarjeta className="divide-y divide-borde">
          {extra.map((s) => (
            <Link key={s.href} href={s.href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-realce">
              <s.Icono className="text-marca-600" />
              <span className="flex-1">{s.etiqueta}</span>
              <span className="text-suave">›</span>
            </Link>
          ))}
        </Tarjeta>
      )}
      <InstalarApp />
      <Tarjeta className="px-4 py-3">
        <p className="font-medium">{nombre}</p>
        <p className="text-sm text-suave">
          {local?.rol} · {local?.local_nombre}
        </p>
      </Tarjeta>
      <Boton variante="secundario" className="w-full" onClick={salir}>
        Cerrar sesión
      </Boton>
    </div>
  )
}
