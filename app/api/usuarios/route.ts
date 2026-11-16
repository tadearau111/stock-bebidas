import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Operaciones de usuarios que necesitan la clave secreta de Supabase
// (crear usuarios, cambiar contraseñas, bloquear el ingreso).
// Corre solo en el servidor de Vercel: la clave nunca llega al navegador.

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!
const PUBLICA = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const SECRETA = process.env.SUPABASE_SECRET_KEY

const opciones = { auth: { persistSession: false, autoRefreshToken: false } }

function error(mensaje: string, estado = 400) {
  return Response.json({ error: mensaje }, { status: estado })
}

/** El cliente "como el usuario que hace el pedido": respeta los permisos de la base. */
function clienteDelUsuario(request: Request): SupabaseClient | null {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return createClient(URL_SB, PUBLICA, { ...opciones, global: { headers: { Authorization: auth } } })
}

async function puedeGestionar(cliente: SupabaseClient, localId: string): Promise<{ ok: boolean; yo?: string }> {
  const { data: usuario } = await cliente.auth.getUser()
  if (!usuario.user) return { ok: false }
  const { data } = await cliente.rpc('mi_acceso')
  const local = (data as { local_id: string; permisos: string[] }[] | null)?.find((l) => l.local_id === localId)
  return { ok: !!local?.permisos.includes('usuarios.gestionar'), yo: usuario.user.id }
}

async function esDelLocal(cliente: SupabaseClient, localId: string, usuarioId: string) {
  const { data } = await cliente.rpc('usuarios_del_local', { p_local: localId })
  return !!(data as { usuario_id: string }[] | null)?.some((u) => u.usuario_id === usuarioId)
}

const claveValida = (c: unknown): c is string => typeof c === 'string' && c.length >= 8

export async function POST(request: Request) {
  if (!SECRETA) {
    return error('Falta configurar SUPABASE_SECRET_KEY en Vercel. Pedile ayuda a quien instaló la app.', 500)
  }
  const cliente = clienteDelUsuario(request)
  if (!cliente) return error('Tenés que iniciar sesión.', 401)

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await request.json()
  } catch {
    return error('Pedido inválido.')
  }
  const localId = String(cuerpo.local_id ?? '')
  const { ok, yo } = await puedeGestionar(cliente, localId)
  if (!ok) return error('No tenés permiso para gestionar usuarios.', 403)

  const admin = createClient(URL_SB, SECRETA, opciones)

  switch (cuerpo.accion) {
    case 'crear': {
      const email = String(cuerpo.email ?? '').trim().toLowerCase()
      const nombre = String(cuerpo.nombre ?? '').trim()
      const rolId = String(cuerpo.rol_id ?? '')
      if (!/^\S+@\S+\.\S+$/.test(email)) return error('El email no es válido.')
      if (!nombre) return error('Poné el nombre.')
      if (!claveValida(cuerpo.clave)) return error('La contraseña tiene que tener al menos 8 caracteres.')
      if (!rolId) return error('Elegí un rol.')

      const { data: creado, error: e1 } = await admin.auth.admin.createUser({
        email,
        password: cuerpo.clave,
        email_confirm: true,
        user_metadata: { nombre },
      })
      if (e1 || !creado.user) {
        const msg = e1?.message ?? ''
        if (/already|registered|exists/i.test(msg)) return error('Ya existe un usuario con ese email.')
        return error(msg || 'No se pudo crear el usuario.')
      }
      // El rol lo asigna la administradora con SU sesión: así queda en el historial a su nombre
      const { error: e2 } = await cliente.from('miembros').insert({ usuario_id: creado.user.id, local_id: localId, rol_id: rolId })
      if (e2) {
        await admin.auth.admin.deleteUser(creado.user.id)
        return error('No se pudo asignar el rol: ' + e2.message)
      }
      return Response.json({ usuario_id: creado.user.id })
    }

    case 'clave': {
      const usuarioId = String(cuerpo.usuario_id ?? '')
      if (!claveValida(cuerpo.clave)) return error('La contraseña tiene que tener al menos 8 caracteres.')
      if (!(await esDelLocal(cliente, localId, usuarioId))) return error('Ese usuario no es de este local.', 404)
      const { error: e } = await admin.auth.admin.updateUserById(usuarioId, { password: cuerpo.clave })
      if (e) return error(e.message)
      return Response.json({ ok: true })
    }

    case 'activo': {
      const usuarioId = String(cuerpo.usuario_id ?? '')
      const activo = cuerpo.activo === true
      if (usuarioId === yo && !activo) return error('No te podés desactivar a vos misma.')
      if (!(await esDelLocal(cliente, localId, usuarioId))) return error('Ese usuario no es de este local.', 404)
      // Primero el perfil (con la sesión de quien lo pide → queda en el historial)
      const { error: e1 } = await cliente.from('perfiles').update({ activo }).eq('id', usuarioId)
      if (e1) return error(e1.message)
      // Después se bloquea / desbloquea el ingreso
      const { error: e2 } = await admin.auth.admin.updateUserById(usuarioId, { ban_duration: activo ? 'none' : '876000h' })
      if (e2) return error(e2.message)
      return Response.json({ ok: true })
    }

    default:
      return error('Acción desconocida.')
  }
}
