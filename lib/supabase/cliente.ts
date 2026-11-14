import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cliente: SupabaseClient | null = null

/** Conexión única con Supabase desde el navegador. La sesión queda guardada en el dispositivo. */
export function supabase(): SupabaseClient {
  if (!cliente) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const clave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !clave) {
      throw new Error('Faltan las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    }
    cliente = createClient(url, clave, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'stock-bebidas-sesion' },
    })
  }
  return cliente
}
