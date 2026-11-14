'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
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
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-4 rounded-2xl border border-borde bg-white p-6 shadow-sm">
        <div className="mb-2 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-marca-600 text-2xl text-white">
            🍾
          </div>
          <h1 className="text-xl font-bold">Stock de Bebidas</h1>
          <p className="text-sm text-suave">Ingresá con tu email y contraseña</p>
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
