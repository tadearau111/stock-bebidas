'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Boton, Tarjeta, Ventana } from '@/components/ui'

// ------------------------------------------------------------------ Service worker

/** Registra el service worker (guarda la app en el dispositivo para abrirla sin internet). */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    const version = process.env.NEXT_PUBLIC_VERSION ?? 'dev'
    navigator.serviceWorker.register(`/sw.js?v=${version}`, { scope: '/', updateViaCache: 'none' }).catch(() => {})
  }, [])
  return null
}

// ------------------------------------------------------------------ Instalar

interface PedidoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// El navegador avisa una sola vez (al cargar) que se puede instalar: se guarda para usarlo después
let pedido: PedidoInstalacion | null = null
let instalada = false
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    pedido = e as PedidoInstalacion
    avisar()
  })
  window.addEventListener('appinstalled', () => {
    pedido = null
    instalada = true
    avisar()
  })
}

function suscribir(f: () => void) {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}

/** ¿Ya se está usando como app instalada? */
function abiertaComoApp() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

const esIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

type Estado = 'instalada' | 'lista' | 'iphone' | 'manual'

function useEstadoInstalacion(): Estado | null {
  return useSyncExternalStore(
    suscribir,
    (): Estado => (instalada || abiertaComoApp() ? 'instalada' : pedido ? 'lista' : esIPhone() ? 'iphone' : 'manual'),
    () => null,
  )
}

/**
 * Tarjeta para instalar la plataforma como app.
 * `ocultable`: se puede cerrar y no vuelve a aparecer (para Inicio).
 */
export function InstalarApp({ ocultable = false }: { ocultable?: boolean }) {
  const estado = useEstadoInstalacion()
  const [oculta, setOculta] = useState(true)
  const [ayuda, setAyuda] = useState(false)

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee del dispositivo después de montar
      setOculta(ocultable && localStorage.getItem('stock-bebidas-instalar-oculto') === '1')
    } catch {
      setOculta(false)
    }
  }, [ocultable])

  if (!estado || estado === 'instalada' || oculta) return null
  // En Inicio solo se ofrece si el navegador lo permite directo o es un iPhone
  if (ocultable && estado === 'manual') return null

  async function instalar() {
    if (estado === 'lista' && pedido) {
      await pedido.prompt()
      await pedido.userChoice.catch(() => null)
      pedido = null
      avisar()
    } else setAyuda(true)
  }

  function ocultar() {
    try {
      localStorage.setItem('stock-bebidas-instalar-oculto', '1')
    } catch {}
    setOculta(true)
  }

  return (
    <Tarjeta className="flex flex-wrap items-center justify-between gap-3 border-marca-500 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Instalá la app en este dispositivo</p>
        <p className="text-sm text-suave">Queda con su ícono, se abre más rápido y funciona sin internet en los eventos.</p>
      </div>
      <div className="flex gap-2">
        {ocultable && (
          <Boton variante="fantasma" className="text-suave" onClick={ocultar}>
            Ahora no
          </Boton>
        )}
        <Boton onClick={instalar}>Instalar</Boton>
      </div>
      <Ventana abierta={ayuda} alCerrar={() => setAyuda(false)} titulo="Cómo instalar la app">
        {ayuda &&
          (estado === 'iphone' ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                Abrí esta página en <b>Safari</b>.
              </li>
              <li>
                Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba, abajo en el medio).
              </li>
              <li>
                Bajá y tocá <b>“Agregar a inicio”</b>.
              </li>
              <li>
                Tocá <b>“Agregar”</b>. Va a aparecer el ícono de HUB en la pantalla del celular.
              </li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                En el celular (Android): abrí esta página en <b>Chrome</b>, tocá los <b>tres puntitos</b> de arriba a la derecha y elegí{' '}
                <b>“Instalar app”</b> o <b>“Agregar a la pantalla principal”</b>.
              </li>
              <li>
                En la computadora: en <b>Chrome</b> o <b>Edge</b>, tocá el ícono de instalar que aparece a la derecha de la barra de direcciones (una
                pantallita con una flecha).
              </li>
            </ol>
          ))}
      </Ventana>
    </Tarjeta>
  )
}
