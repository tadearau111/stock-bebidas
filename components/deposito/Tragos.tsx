'use client'

import { useState } from 'react'
import { Aviso, Boton, cx } from '@/components/ui'
import { mensajeError } from '@/lib/formato'
import { useGuardarTrago, useTragos } from '@/lib/tragos'
import type { Trago } from '@/lib/tipos'

/** Lista de tragos y vasos para los retiros de personal y cortesías (se cuentan en vasos). */
export function ListaTragos() {
  const { data: tragos } = useTragos()
  const guardar = useGuardarTrago()
  const [nuevo, setNuevo] = useState('')
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null)
  const [error, setError] = useState('')

  async function hacer(datos: { id?: string; nombre?: string; activo?: boolean }) {
    setError('')
    try {
      await guardar.mutateAsync(datos)
      return true
    } catch (e) {
      setError(mensajeError(e))
      return false
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-suave">
        Se usan en los <b className="text-tinta">retiros</b> de las barras (consumo de personal y cortesías) y se cuentan en vasos. Son informativos: no descuentan del depósito, porque salen de
        las botellas que ya están en la barra.
      </p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (nuevo.trim() && (await hacer({ nombre: nuevo.trim() }))) setNuevo('')
        }}
      >
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Ej: Trago Fernet"
          className="min-h-11 w-full flex-1 rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
        />
        <Boton type="submit" cargando={guardar.isPending}>
          Agregar
        </Boton>
      </form>
      {error && <Aviso>{error}</Aviso>}
      <ul className="divide-y divide-borde rounded-lg border border-borde">
        {(tragos ?? []).map((t: Trago) => (
          <li key={t.id} className="flex items-center gap-2 px-3 py-2">
            {editando?.id === t.id ? (
              <>
                <input
                  value={editando.nombre}
                  onChange={(e) => setEditando({ id: t.id, nombre: e.target.value })}
                  autoFocus
                  className="min-h-10 flex-1 rounded-lg border border-borde bg-superficie px-2 outline-none focus:border-marca-500"
                />
                <button
                  className="text-sm text-marca-700 underline"
                  onClick={async () => {
                    if (editando.nombre.trim() && (await hacer({ id: t.id, nombre: editando.nombre.trim() }))) setEditando(null)
                  }}
                >
                  Guardar
                </button>
              </>
            ) : (
              <>
                <span className={cx('flex-1', !t.activo && 'text-suave line-through')}>{t.nombre}</span>
                <button className="text-sm text-suave underline hover:text-tinta" onClick={() => setEditando({ id: t.id, nombre: t.nombre })}>
                  Renombrar
                </button>
                <button className="text-sm text-suave underline hover:text-tinta" onClick={() => hacer({ id: t.id, activo: !t.activo })}>
                  {t.activo ? 'Desactivar' : 'Activar'}
                </button>
              </>
            )}
          </li>
        ))}
        {(tragos ?? []).length === 0 && <li className="px-3 py-3 text-sm text-suave">Todavía no hay tragos cargados.</li>}
      </ul>
    </div>
  )
}
