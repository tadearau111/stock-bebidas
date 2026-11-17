'use client'

import { useState } from 'react'
import { Aviso, Boton, Cargando, Etiqueta, Tarjeta } from '@/components/ui'
import { formatoFechaHora, mensajeError } from '@/lib/formato'
import { diasRestantes, useBorrarDefinitivo, usePapelera, useRestaurar, useVaciarPapelera, type ItemPapelera, type TipoPapelera } from '@/lib/papelera'
import { useSesion } from '@/lib/sesion'

const TIPOS: Record<TipoPapelera, string> = {
  evento: 'Evento',
  barra: 'Barra',
  linea: 'Artículo de barra',
  reposicion: 'Reposición',
  retiro: 'Retiro',
  bebida_abierta: 'Bebida abierta',
  gasto: 'Gasto',
  movimiento: 'Depósito',
  nota: 'Info',
  articulo: 'Artículo',
  caja_fuerte: 'Caja fuerte',
}

export default function PaginaPapelera() {
  const { puede } = useSesion()
  const permitido = puede('papelera.gestionar')
  const { data: items, isPending, error } = usePapelera(permitido)
  const restaurar = useRestaurar()
  const borrar = useBorrarDefinitivo()
  const vaciar = useVaciarPapelera()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  if (!permitido) return <Aviso>No tenés permiso para ver la papelera.</Aviso>

  const avisar = (tipo: 'ok' | 'error', texto: string) => {
    setAviso({ tipo, texto })
    setTimeout(() => setAviso(null), 6000)
  }

  async function hacerRestaurar(it: ItemPapelera) {
    setOcupado(it.id)
    try {
      await restaurar.mutateAsync(it.id)
      avisar('ok', `✓ "${it.titulo}" volvió a su lugar.`)
    } catch (e) {
      avisar('error', mensajeError(e))
    } finally {
      setOcupado(null)
    }
  }

  async function hacerBorrar(it: ItemPapelera) {
    if (!confirm(`¿Borrar "${it.titulo}" DEFINITIVAMENTE? Ya no se va a poder recuperar.`)) return
    setOcupado(it.id)
    try {
      await borrar.mutateAsync(it.id)
      avisar('ok', 'Borrado definitivamente.')
    } catch (e) {
      avisar('error', mensajeError(e))
    } finally {
      setOcupado(null)
    }
  }

  async function hacerVaciar() {
    if (!confirm(`¿Vaciar la papelera? Se borran DEFINITIVAMENTE los ${items?.length ?? 0} elementos. No se puede deshacer.`)) return
    try {
      await vaciar.mutateAsync(undefined)
      avisar('ok', 'Papelera vacía.')
    } catch (e) {
      avisar('error', mensajeError(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Papelera</h1>
          <p className="text-sm text-suave">Lo que se borra queda acá 30 días. Lo podés restaurar o borrar definitivamente.</p>
        </div>
        {(items?.length ?? 0) > 0 && (
          <Boton variante="peligro" className="shrink-0" onClick={hacerVaciar} cargando={vaciar.isPending} textoCargando="Vaciando…">
            Vaciar papelera
          </Boton>
        )}
      </div>

      <Aviso tipo="info">
        Si restaurás un evento, una barra o una carga de barra, el stock del depósito se vuelve a descontar (mientras está en la papelera, lo consumido
        cuenta como devuelto).
      </Aviso>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {isPending ? (
        <Cargando />
      ) : error ? (
        <Aviso>{mensajeError(error)}</Aviso>
      ) : (items ?? []).length === 0 ? (
        <Tarjeta className="px-4 py-10 text-center text-suave">La papelera está vacía.</Tarjeta>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {items!.map((it) => {
            const dias = diasRestantes(it.expira_en)
            return (
              <div key={it.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <Etiqueta>{TIPOS[it.tipo] ?? it.tipo}</Etiqueta>
                    <span className="font-medium">{it.titulo}</span>
                  </p>
                  {it.detalle && <p className="text-sm text-suave">{it.detalle}</p>}
                  {it.evento_nombre && it.tipo !== 'evento' && <p className="text-sm text-suave">Evento: {it.evento_nombre}</p>}
                  <p className="text-xs text-suave">
                    Borrado el {formatoFechaHora(it.borrado_en)} por {it.autor?.nombre ?? 'usuario'} ·{' '}
                    <span className={dias <= 3 ? 'text-alerta' : ''}>
                      se borra solo en {dias} {dias === 1 ? 'día' : 'días'}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Boton onClick={() => hacerRestaurar(it)} cargando={ocupado === it.id && restaurar.isPending} textoCargando="Restaurando…" disabled={!!ocupado}>
                    Restaurar
                  </Boton>
                  <Boton variante="peligro" onClick={() => hacerBorrar(it)} cargando={ocupado === it.id && borrar.isPending} textoCargando="Borrando…" disabled={!!ocupado}>
                    Borrar
                  </Boton>
                </div>
              </div>
            )
          })}
        </Tarjeta>
      )}
    </div>
  )
}
