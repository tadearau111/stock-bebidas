'use client'

import { useEffect, useId, useRef, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ------------------------------------------------------------------ Botón

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma'

const estilos: Record<Variante, string> = {
  primario: 'plata disabled:opacity-50',
  secundario: 'bg-superficie text-tinta border border-borde hover:bg-realce disabled:opacity-50',
  peligro: 'bg-superficie text-alerta border border-alerta/40 hover:bg-alerta-50 disabled:opacity-50',
  fantasma: 'text-marca-700 hover:bg-marca-50 disabled:opacity-50',
}

export function Boton({
  variante = 'primario',
  cargando,
  textoCargando = 'Guardando…',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean; textoCargando?: string }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || cargando}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        estilos[variante],
        className,
      )}
    >
      {cargando ? textoCargando : children}
    </button>
  )
}

// ------------------------------------------------------------------ Campos

export function Campo({
  etiqueta,
  ayuda,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string; error?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        {...props}
        className={cx(
          'block min-h-11 w-full rounded-lg border bg-superficie px-3 outline-none focus:border-marca-500 focus:ring-2 focus:ring-marca-100 disabled:cursor-default disabled:bg-realce disabled:font-semibold',
          error ? 'border-alerta' : 'border-borde',
        )}
      />
      {error ? (
        <p className="mt-1 text-sm text-alerta">{error}</p>
      ) : ayuda ? (
        <p className="mt-1 text-xs text-suave">{ayuda}</p>
      ) : null}
    </div>
  )
}

export function Selector({
  etiqueta,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {etiqueta}
      </label>
      <select
        id={id}
        {...props}
        className="block min-h-11 w-full rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500 focus:ring-2 focus:ring-marca-100"
      >
        {children}
      </select>
    </div>
  )
}

// ------------------------------------------------------------------ Ventana (modal)

export function Ventana({
  abierta,
  alCerrar,
  titulo,
  children,
}: {
  abierta: boolean
  alCerrar: () => void
  titulo: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const abiertaRef = useRef(abierta)
  useEffect(() => {
    abiertaRef.current = abierta
    const d = ref.current
    if (!d) return
    if (abierta && !d.open) d.showModal()
    if (!abierta && d.open) d.close()
  }, [abierta])

  return (
    <dialog
      ref={ref}
      onClose={() => abiertaRef.current && alCerrar()}
      onClick={(e) => e.target === ref.current && alCerrar()}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-superficie p-0 text-tinta shadow-2xl shadow-black border border-borde sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      {abierta && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-borde px-5 py-3">
            <h2 className="text-lg font-semibold">{titulo}</h2>
            <button
              type="button"
              onClick={alCerrar}
              className="-mr-2 flex size-10 items-center justify-center rounded-full text-2xl leading-none text-suave hover:bg-realce"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  )
}

// ------------------------------------------------------------------ Varios

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'info' | 'ok'; children: ReactNode }) {
  const t = {
    error: 'bg-alerta-50 text-alerta border-alerta/30',
    info: 'bg-marca-50 text-marca-700 border-marca-100',
    ok: 'bg-marca-50 text-marca-700 border-marca-100',
  }[tipo]
  return <div className={cx('rounded-lg border px-3 py-2 text-sm', t)}>{children}</div>
}

export function Tarjeta({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-borde bg-superficie', className)}>{children}</div>
}

function suscribirConexion(f: () => void) {
  window.addEventListener('online', f)
  window.addEventListener('offline', f)
  return () => {
    window.removeEventListener('online', f)
    window.removeEventListener('offline', f)
  }
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  const enLinea = useSyncExternalStore(
    suscribirConexion,
    () => navigator.onLine,
    () => true,
  )
  if (!enLinea)
    return (
      <p className="px-4 py-10 text-center text-suave">
        Sin conexión. Esta pantalla todavía no quedó guardada en este dispositivo: abrila una vez con internet para poder verla sin conexión.
      </p>
    )
  return <p className="py-10 text-center text-suave">{texto}</p>
}

export function Etiqueta({ color = 'gris', children }: { color?: 'gris' | 'rojo' | 'verde'; children: ReactNode }) {
  const c = {
    gris: 'bg-fondo text-suave',
    rojo: 'bg-alerta-50 text-alerta',
    verde: 'bg-marca-50 text-marca-700',
  }[color]
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', c)}>{children}</span>
}

export { cx }
