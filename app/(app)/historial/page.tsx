'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Aviso, Boton, Cargando, Etiqueta, Selector, Tarjeta } from '@/components/ui'
import { useArticulos } from '@/lib/datos'
import { useEventos } from '@/lib/eventos'
import { formatoFechaHora, mensajeError } from '@/lib/formato'
import { AREAS, describir, type Nombres, type RegistroAuditoria } from '@/lib/historial'
import { useLocalId, useSesion } from '@/lib/sesion'
import { supabase } from '@/lib/supabase/cliente'
import { useProveedores } from '@/lib/proveedores'
import { useTragos } from '@/lib/tragos'
import { useNombresUsuarios, useRoles } from '@/lib/usuarios'

const POR_PAGINA = 50

export default function PaginaHistorial() {
  const { puede } = useSesion()
  const localId = useLocalId()
  const [usuario, setUsuario] = useState('')
  const [evento, setEvento] = useState('')
  const [articulo, setArticulo] = useState('')
  const [area, setArea] = useState('')

  const { data: usuarios } = useNombresUsuarios()
  const { data: articulos } = useArticulos()
  const { data: eventos } = useEventos()
  const { data: roles } = useRoles()
  const { data: tragos } = useTragos()
  const { data: proveedores } = useProveedores()

  const nombres: Nombres = useMemo(
    () => ({
      usuarios: usuarios ?? new Map(),
      articulos: new Map((articulos ?? []).map((a) => [a.id, a.nombre])),
      eventos: new Map((eventos ?? []).map((e) => [e.id, e.nombre])),
      roles: new Map((roles ?? []).map((r) => [r.id, r.nombre])),
      tragos: new Map((tragos ?? []).map((t) => [t.id, t.nombre])),
      proveedores: new Map((proveedores ?? []).map((p) => [p.id, p.nombre])),
    }),
    [usuarios, articulos, eventos, roles, tragos, proveedores],
  )

  const consulta = useInfiniteQuery({
    queryKey: ['historial', localId, usuario, evento, articulo, area],
    enabled: !!localId && puede('historial.ver'),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase()
        .from('auditoria')
        .select('*')
        .or(`local_id.eq.${localId},local_id.is.null`)
        .order('id', { ascending: false })
        .range(pageParam, pageParam + POR_PAGINA - 1)
      if (usuario) q = q.eq('usuario_id', usuario)
      if (evento) q = q.eq('evento_id', evento)
      if (articulo) q = q.eq('articulo_id', articulo)
      if (area) q = q.in('tabla', AREAS[area])
      const { data, error } = await q
      if (error) throw error
      return data as RegistroAuditoria[]
    },
    getNextPageParam: (ultima, todas) => (ultima.length < POR_PAGINA ? undefined : todas.length * POR_PAGINA),
  })

  if (!puede('historial.ver')) return <Aviso>No tenés permiso para ver el historial.</Aviso>

  const registros = consulta.data?.pages.flat() ?? []
  const hayFiltros = usuario || evento || articulo || area

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Historial</h1>
        <p className="text-sm text-suave">Todo lo que se cargó o modificó: quién, cuándo, el valor anterior y el nuevo.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Selector etiqueta="Usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
          <option value="">Todos</option>
          {[...(usuarios ?? new Map()).entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'es'))
            .map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
        </Selector>
        <Selector etiqueta="Evento" value={evento} onChange={(e) => setEvento(e.target.value)}>
          <option value="">Todos</option>
          {(eventos ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Artículo" value={articulo} onChange={(e) => setArticulo(e.target.value)}>
          <option value="">Todos</option>
          {(articulos ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Área" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Todas</option>
          {Object.keys(AREAS).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Selector>
      </div>
      {hayFiltros && (
        <button
          onClick={() => {
            setUsuario('')
            setEvento('')
            setArticulo('')
            setArea('')
          }}
          className="text-sm text-marca-700 underline"
        >
          Quitar filtros
        </button>
      )}

      {consulta.isPending ? (
        <Cargando />
      ) : consulta.error ? (
        <Aviso>{mensajeError(consulta.error)}</Aviso>
      ) : registros.length === 0 ? (
        <Tarjeta className="px-4 py-10 text-center text-suave">No hay cambios registrados{hayFiltros ? ' con esos filtros' : ''}.</Tarjeta>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {registros.map((r) => (
            <Fila key={r.id} registro={r} nombres={nombres} />
          ))}
        </Tarjeta>
      )}

      {consulta.hasNextPage && (
        <Boton variante="secundario" className="w-full" onClick={() => consulta.fetchNextPage()} cargando={consulta.isFetchingNextPage} textoCargando="Cargando…">
          Ver más
        </Boton>
      )}
    </div>
  )
}

function Fila({ registro: r, nombres }: { registro: RegistroAuditoria; nombres: Nombres }) {
  const d = describir(r, nombres)
  const quien = r.usuario_id ? (nombres.usuarios.get(r.usuario_id) ?? 'Usuario') : 'Sistema'
  const nombreArticulo = r.articulo_id ? nombres.articulos.get(r.articulo_id) : null
  const nombreEvento = r.evento_id ? (nombres.eventos.get(r.evento_id) ?? 'evento borrado') : null
  const color = r.accion === 'baja' ? 'rojo' : r.accion === 'alta' ? 'verde' : 'gris'

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p>
          <b>{quien}</b> <span className="text-suave">{d.titulo}</span>
        </p>
        <p className="text-xs text-suave">{formatoFechaHora(r.fecha)}</p>
      </div>
      {(nombreArticulo || nombreEvento) && (
        <p className="mt-0.5 flex flex-wrap gap-1.5 text-sm">
          {nombreArticulo && <Etiqueta color={color}>{nombreArticulo}</Etiqueta>}
          {nombreEvento &&
            (nombres.eventos.has(r.evento_id!) ? (
              <Link href={`/evento?id=${r.evento_id}`} className="text-marca-700 underline">
                {nombreEvento}
              </Link>
            ) : (
              <span className="text-suave">{nombreEvento}</span>
            ))}
        </p>
      )}
      {d.cambios.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm">
          {d.cambios.map((c) => (
            <li key={c.campo} className="tabular">
              <span className="text-suave">{c.campo}:</span>{' '}
              {r.accion === 'modificacion' ? (
                <>
                  <span className="text-suave line-through">{c.antes}</span> → <b>{c.despues}</b>
                </>
              ) : r.accion === 'alta' ? (
                <b>{c.despues}</b>
              ) : (
                <span className="line-through">{c.antes}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
