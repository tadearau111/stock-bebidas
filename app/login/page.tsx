'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { Logo } from '@/components/marca'
import { Aviso, Boton, Campo, Cargando } from '@/components/ui'
import { mensajeError } from '@/lib/formato'
import { useSesion } from '@/lib/sesion'
import { supabase } from '@/lib/supabase/cliente'

export default function PaginaLogin() {
  const router = useRouter()
  const { session, cargando } = useSesion()
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!cargando && session) router.replace('/')
  }, [cargando, session, router])

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password: clave })
    setEnviando(false)
    if (error) setError(mensajeError(error))
  }

  if (cargando || session) return <Cargando />

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,#1f1f22_0%,#050505_60%)] px-4">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-borde bg-superficie/90 p-6 shadow-2xl shadow-black backdrop-blur"
      >
        <div className="mb-4 text-center">
          <Logo tamano={72} className="mx-auto mb-5" />
          <h1 className="texto-plata text-2xl font-semibold">Stock de Bebidas</h1>
          <p className="mt-1 text-sm text-suave">Ingresá con tu email y contraseña</p>
        </div>
        <Campo etiqueta="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          value={clave}
          onChange={(e) => setClave(e.target.value)}
        />
        {error && <Aviso>{error}</Aviso>}
        <Boton type="submit" className="w-full" cargando={enviando} textoCargando="Ingresando…">
          Ingresar
        </Boton>
        <p className="text-center text-xs text-suave">¿Olvidaste la contraseña? Pedile a la administradora que te la cambie.</p>
      </form>
    </main>
  )
}
