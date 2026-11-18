'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Etiqueta, Tarjeta, Ventana, cx } from '@/components/ui'
import { consumido, faltaEnDeposito, stockFinalValido, totalLlevado, totalReposiciones } from '@/lib/calculos/evento'
import { coincideBusqueda } from '@/lib/calculos/stock'
import { useArticulos } from '@/lib/datos'
import { useStockLocal } from '@/lib/eventos'
import { actualizar, aPapelera, insertar } from '@/lib/offline/cola'
import { useCargaEvento } from '@/lib/offline/sincronizar'
import { useGuardarTrago, useTragos } from '@/lib/tragos'
import { ahoraParaInput, detalleArticulo, formatoCantidad, formatoHora, formatoNumero, formatoVasos, mensajeError } from '@/lib/formato'
import { useLocalId, useSesion } from '@/lib/sesion'
import type { Barra, DetalleEvento, LineaBarraDB, RetiroDB } from '@/lib/tipos'

type Edicion =
  | { tipo: 'inicial' | 'final'; linea: LineaBarraDB }
  | { tipo: 'reposiciones'; linea: LineaBarraDB }
  | { tipo: 'articulos' }
  | { tipo: 'retiro' }
  | { tipo: 'renombrar' }
  | null

export function PestanaBarra({
  detalle,
  barra,
  alBorrar,
}: {
  detalle: DetalleEvento
  barra: Barra
  alBorrar: () => void
}) {
  const { puede } = useSesion()
  const carga = useCargaEvento(detalle.evento.id)
  const [edicion, setEdicion] = useState<Edicion>(null)
  const [error, setError] = useState('')
  const lineas = detalle.lineas.filter((l) => l.barra_id === barra.id)
  const retiros = detalle.retiros.filter((r) => r.barra_id === barra.id)
  const cerrar = () => setEdicion(null)

  async function borrarBarra() {
    const texto = lineas.length
      ? `¿Borrar "${barra.nombre}"? Se borran sus ${lineas.length} artículos con todo lo cargado, y el stock vuelve al depósito.\n\nVa a la papelera: la podés restaurar durante 30 días.`
      : `¿Borrar "${barra.nombre}"? Va a la papelera durante 30 días.`
    if (!confirm(texto)) return
    try {
      await carga.guardar(`Borrar ${barra.nombre}`, [aPapelera('barra', barra.id)])
      alBorrar()
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function quitarLinea(l: LineaBarraDB) {
    const cargado = l.stock_inicial > 0 || l.reposiciones.length > 0 || l.stock_final != null
    if (cargado && !confirm(`¿Quitar ${l.articulo.nombre} de esta barra? Lo cargado vuelve al depósito. Va a la papelera durante 30 días.`)) return
    try {
      await carga.guardar(`Quitar ${l.articulo.nombre} de ${barra.nombre}`, [aPapelera('linea', l.id)])
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">{barra.nombre}</h2>
          <button onClick={() => setEdicion({ tipo: 'renombrar' })} className="text-sm text-suave underline hover:text-tinta">
            Renombrar
          </button>
          {puede('eventos.gestionar') && (
            <button onClick={borrarBarra} className="text-sm text-alerta/80 underline hover:text-alerta">
              Borrar
            </button>
          )}
        </div>
        <Boton variante="secundario" onClick={() => setEdicion({ tipo: 'articulos' })}>
          + Artículos
        </Boton>
      </div>

      {error && <Aviso>{error}</Aviso>}

      {lineas.length === 0 ? (
        <Tarjeta className="px-4 py-10 text-center text-suave">
          Esta barra no tiene artículos. Tocá <b className="text-tinta">+ Artículos</b> para elegir qué lleva esta noche.
        </Tarjeta>
      ) : (
        <>
          {/* Celular: una tarjeta por artículo */}
          <ul className="space-y-2 md:hidden">
            {lineas.map((l) => (
              <li key={l.id}>
                <Tarjeta className="p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{l.articulo.nombre}</p>
                      <p className="truncate text-xs text-suave">{detalleArticulo(l.articulo) || ' '}</p>
                    </div>
                    <Consumido linea={l} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Casilla titulo="Inicial" valor={l.stock_inicial} onClick={() => setEdicion({ tipo: 'inicial', linea: l })} />
                    <Casilla
                      titulo={`Reposic.${l.reposiciones.length > 1 ? ` (${l.reposiciones.length})` : ''}`}
                      valor={totalReposiciones(l)}
                      onClick={() => setEdicion({ tipo: 'reposiciones', linea: l })}
                    />
                    <Casilla titulo="Final" valor={l.stock_final} onClick={() => setEdicion({ tipo: 'final', linea: l })} />
                  </div>
                  <button onClick={() => quitarLinea(l)} className="mt-2 text-xs text-suave underline">
                    Quitar de la barra
                  </button>
                </Tarjeta>
              </li>
            ))}
          </ul>

          {/* Computadora: tabla */}
          <Tarjeta className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-borde text-left text-xs uppercase tracking-wide text-suave">
                <tr>
                  <th className="px-4 py-3">Artículo</th>
                  <th className="px-2 py-3 text-center">Stock inicial</th>
                  <th className="px-2 py-3 text-center">Reposiciones</th>
                  <th className="px-2 py-3 text-center">Stock final</th>
                  <th className="px-4 py-3 text-right">Consumido</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{l.articulo.nombre}</p>
                      <p className="text-xs text-suave">{detalleArticulo(l.articulo)}</p>
                    </td>
                    <td className="px-2 py-2">
                      <Casilla valor={l.stock_inicial} onClick={() => setEdicion({ tipo: 'inicial', linea: l })} />
                    </td>
                    <td className="px-2 py-2">
                      <Casilla
                        valor={totalReposiciones(l)}
                        nota={l.reposiciones.some((r) => r.tipo === 'total') ? 'total' : l.reposiciones.length > 1 ? `${l.reposiciones.length} cargas` : undefined}
                        onClick={() => setEdicion({ tipo: 'reposiciones', linea: l })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Casilla valor={l.stock_final} onClick={() => setEdicion({ tipo: 'final', linea: l })} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Consumido linea={l} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => quitarLinea(l)} className="rounded px-2 py-1 text-suave hover:bg-realce hover:text-alerta" title="Quitar de la barra">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tarjeta>
          <p className="text-xs text-suave">
            Consumido = Stock inicial + Reposiciones − Stock final. Tocá cualquier número para cargarlo o corregirlo.
          </p>
        </>
      )}

      <SeccionRetiros retiros={retiros} eventoId={detalle.evento.id} alAgregar={() => setEdicion({ tipo: 'retiro' })} hayArticulos={lineas.length > 0} />

      <Ventana abierta={edicion?.tipo === 'inicial' || edicion?.tipo === 'final'} alCerrar={cerrar} titulo={edicion?.tipo === 'final' ? 'Stock final' : 'Stock inicial'}>
        {(edicion?.tipo === 'inicial' || edicion?.tipo === 'final') && (
          <EditarStock tipo={edicion.tipo} linea={edicion.linea} eventoId={detalle.evento.id} alTerminar={cerrar} />
        )}
      </Ventana>
      <Ventana abierta={edicion?.tipo === 'reposiciones'} alCerrar={cerrar} titulo="Reposiciones">
        {edicion?.tipo === 'reposiciones' && (
          <EditarReposiciones linea={detalle.lineas.find((l) => l.id === edicion.linea.id) ?? edicion.linea} eventoId={detalle.evento.id} />
        )}
      </Ventana>
      <Ventana abierta={edicion?.tipo === 'articulos'} alCerrar={cerrar} titulo={`Artículos de ${barra.nombre}`}>
        {edicion?.tipo === 'articulos' && <AgregarArticulos barra={barra} eventoId={detalle.evento.id} yaEstan={lineas.map((l) => l.articulo_id)} alTerminar={cerrar} />}
      </Ventana>
      <Ventana abierta={edicion?.tipo === 'retiro'} alCerrar={cerrar} titulo="Nuevo retiro">
        {edicion?.tipo === 'retiro' && <FormRetiro barra={barra} lineas={lineas} eventoId={detalle.evento.id} alTerminar={cerrar} />}
      </Ventana>
      <Ventana abierta={edicion?.tipo === 'renombrar'} alCerrar={cerrar} titulo="Renombrar barra">
        {edicion?.tipo === 'renombrar' && <RenombrarBarra barra={barra} eventoId={detalle.evento.id} alTerminar={cerrar} />}
      </Ventana>
    </div>
  )
}

// ------------------------------------------------------------------ Piezas chicas

function Casilla({ titulo, valor, nota, onClick }: { titulo?: string; valor: number | null; nota?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full min-w-16 flex-col items-center justify-center rounded-lg border px-2 py-1.5 transition-colors hover:border-marca-500',
        valor == null ? 'border-dashed border-borde text-suave' : 'border-borde bg-realce',
      )}
    >
      {titulo && <span className="text-[11px] text-suave">{titulo}</span>}
      <span className="tabular text-lg font-semibold leading-tight">{valor == null ? '—' : formatoNumero(valor)}</span>
      {nota && <span className="text-[10px] text-suave">{nota}</span>}
    </button>
  )
}

function Consumido({ linea }: { linea: LineaBarraDB }) {
  const c = consumido(linea)
  if (c == null)
    return (
      <div className="text-right">
        <p className="text-[11px] text-suave">Consumido</p>
        <p className="text-xs text-suave">falta el final</p>
      </div>
    )
  return (
    <div className="text-right">
      <p className="text-[11px] text-suave md:hidden">Consumido</p>
      <p className="tabular text-xl font-bold texto-plata">{formatoCantidad(c, linea.articulo.unidad)}</p>
    </div>
  )
}

function AvisoStock({ articuloId, anterior, nuevo, unidad }: { articuloId: string; anterior: number; nuevo: number; unidad: 'unidad' | 'bolsa' }) {
  const { data: stock } = useStockLocal()
  const actual = stock?.get(articuloId)
  if (actual == null || !Number.isFinite(nuevo)) return null
  const falta = faltaEnDeposito(actual, anterior, nuevo)
  if (falta <= 0) return <p className="text-xs text-suave">En el depósito hay {formatoCantidad(Math.max(actual, 0), unidad)}.</p>
  return (
    <Aviso>
      ⚠ En el depósito no alcanza: hay {formatoCantidad(Math.max(actual, 0), unidad)} y faltan {formatoCantidad(falta, unidad)}. Podés guardarlo igual (el depósito queda en negativo); acordate de cargar el ingreso.
    </Aviso>
  )
}

// ------------------------------------------------------------------ Stock inicial / final

function EditarStock({ tipo, linea, eventoId, alTerminar }: { tipo: 'inicial' | 'final'; linea: LineaBarraDB; eventoId: string; alTerminar: () => void }) {
  const carga = useCargaEvento(eventoId)
  const actual = tipo === 'inicial' ? linea.stock_inicial : linea.stock_final
  const [valor, setValor] = useState(actual == null ? '' : String(actual))
  const [error, setError] = useState('')
  const n = Number(valor)
  const u = linea.articulo.unidad

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (valor.trim() === '' || !Number.isInteger(n) || n < 0) return setError('Ingresá un número entero, 0 o más.')
    if (tipo === 'final' && !stockFinalValido(linea, n)) {
      return setError(`El stock final no puede ser mayor a lo que se llevó a la barra (${formatoCantidad(totalLlevado(linea), u)}).`)
    }
    if (tipo === 'inicial' && linea.stock_final != null && linea.stock_final > n + totalReposiciones(linea)) {
      return setError('Con ese stock inicial, el stock final cargado quedaría mayor a lo llevado. Corregí primero el stock final.')
    }
    try {
      await carga.guardar(`Stock ${tipo} de ${linea.articulo.nombre}: ${n}`, [
        actualizar('barra_articulos', linea.id, tipo === 'inicial' ? { stock_inicial: n } : { stock_final: n }),
      ])
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function borrarFinal() {
    try {
      await carga.guardar(`Borrar el stock final de ${linea.articulo.nombre}`, [actualizar('barra_articulos', linea.id, { stock_final: null })])
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="rounded-lg bg-realce px-3 py-2">
        <p className="font-medium">{linea.articulo.nombre}</p>
        <p className="text-sm text-suave">
          {tipo === 'inicial'
            ? 'Lo que se lleva a la barra al empezar. Sale del depósito.'
            : `Lo que sobró al terminar. Vuelve al depósito. Se llevaron ${formatoCantidad(totalLlevado(linea), u)}.`}
        </p>
      </div>
      <Campo
        etiqueta={u === 'bolsa' ? 'Cantidad (bolsas)' : 'Cantidad (unidades)'}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        autoFocus
      />
      {tipo === 'inicial' && valor !== '' && <AvisoStock articuloId={linea.articulo_id} anterior={linea.stock_inicial} nuevo={n} unidad={u} />}
      {tipo === 'final' && valor !== '' && Number.isInteger(n) && stockFinalValido(linea, n) && (
        <Aviso tipo="info">
          Consumido: <b>{formatoCantidad(totalLlevado(linea) - n, u)}</b>
        </Aviso>
      )}
      {actual != null && actual !== n && valor !== '' && <p className="text-xs text-suave">Antes: {formatoNumero(actual)}. El cambio queda en el historial.</p>}
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={carga.guardando}>
          Guardar
        </Boton>
      </div>
      {tipo === 'final' && linea.stock_final != null && (
        <Boton variante="fantasma" className="w-full text-suave" onClick={borrarFinal}>
          Borrar stock final (todavía no se contó)
        </Boton>
      )}
    </form>
  )
}

// ------------------------------------------------------------------ Reposiciones

function EditarReposiciones({ linea, eventoId }: { linea: LineaBarraDB; eventoId: string }) {
  const localId = useLocalId()
  const carga = useCargaEvento(eventoId)
  const [cantidad, setCantidad] = useState('')
  const [hora, setHora] = useState(ahoraParaInput())
  const [total, setTotal] = useState('')
  const [error, setError] = useState('')
  const u = linea.articulo.unidad
  const suma = totalReposiciones(linea)
  const hayTotal = linea.reposiciones.some((r) => r.tipo === 'total')
  const hayDetalle = linea.reposiciones.some((r) => r.tipo === 'detalle')

  async function agregar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const n = Number(cantidad)
    if (!Number.isInteger(n) || n <= 0) return setError('La cantidad tiene que ser un número entero mayor a 0.')
    if (hayTotal && !confirm(`Ya hay un total cargado de una vez (${formatoCantidad(suma, u)}). Esta reposición se SUMA a ese total. ¿Seguir?`)) return
    try {
      // Nunca se borra nada: cada reposición queda guardada con su hora
      await carga.guardar(`Reposición de ${n} ${linea.articulo.nombre}`, [
        insertar('reposiciones', {
          barra_articulo_id: linea.id,
          evento_id: eventoId,
          local_id: localId,
          articulo_id: linea.articulo_id,
          tipo: 'detalle',
          cantidad: n,
          hora: new Date(hora).toISOString(),
        }),
      ])
      setCantidad('')
      setHora(ahoraParaInput())
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function cargarTotal(e: FormEvent) {
    e.preventDefault()
    setError('')
    const n = Number(total)
    if (!Number.isInteger(n) || n < 0) return setError('El total tiene que ser un número entero, 0 o más.')
    // El total directo solo existe si NO se anotaron reposiciones detalladas (nunca las reemplaza)
    if (hayDetalle) return setError('Ya hay reposiciones anotadas: el total se suma solo.')
    const existente = linea.reposiciones.find((r) => r.tipo === 'total')
    try {
      const texto = `Total de reposiciones de ${linea.articulo.nombre}: ${n}`
      if (existente && n > 0) {
        // corregir el número del total cargado de una vez
        await carga.guardar(texto, [actualizar('reposiciones', existente.id, { cantidad: n })])
      } else if (existente && n === 0) {
        await carga.guardar(texto, [aPapelera('reposicion', existente.id)])
      } else if (n > 0) {
        await carga.guardar(texto, [
          insertar('reposiciones', {
            barra_articulo_id: linea.id,
            evento_id: eventoId,
            local_id: localId,
            articulo_id: linea.articulo_id,
            tipo: 'total',
            cantidad: n,
          }),
        ])
      }
      setTotal('')
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  async function borrar(id: string) {
    if (!confirm('¿Borrar esta reposición? Vuelve al depósito y va a la papelera durante 30 días.')) return
    try {
      await carga.guardar(`Borrar una reposición de ${linea.articulo.nombre}`, [aPapelera('reposicion', id)])
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  const nuevoFinalInvalido = linea.stock_final != null && Number(total || 0) > 0 && linea.stock_final > linea.stock_inicial + Number(total)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg bg-realce px-3 py-2">
        <div>
          <p className="font-medium">{linea.articulo.nombre}</p>
          <p className="text-xs text-suave">Cada reposición sale del depósito.</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-suave">{hayDetalle ? `Total (${linea.reposiciones.length} ${linea.reposiciones.length === 1 ? 'reposición' : 'reposiciones'})` : 'Total'}</p>
          <p className="tabular text-xl font-bold">{formatoCantidad(suma, u)}</p>
        </div>
      </div>

      {linea.reposiciones.length > 0 && (
        <ul className="divide-y divide-borde rounded-lg border border-borde">
          {linea.reposiciones.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <p className="font-medium">
                  {r.tipo === 'total' ? 'Total cargado de una vez' : formatoHora(r.hora)} · <span className="tabular">{formatoCantidad(r.cantidad, u)}</span>
                </p>
                <p className="text-xs text-suave">cargó {r.autor?.nombre ?? 'usuario'}</p>
              </div>
              <button onClick={() => borrar(r.id)} className="rounded px-2 py-1 text-suave hover:bg-realce hover:text-alerta" aria-label="Borrar">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={agregar} className="space-y-3 rounded-xl border border-borde p-3">
        <p className="text-sm font-semibold">Agregar reposición (durante la noche)</p>
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Cantidad" type="number" inputMode="numeric" min={1} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          <Campo etiqueta="Hora" type="datetime-local" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        {cantidad !== '' && <AvisoStock articuloId={linea.articulo_id} anterior={0} nuevo={Number(cantidad)} unidad={u} />}
        <Boton type="submit" className="w-full" cargando={carga.guardando}>
          + Agregar
        </Boton>
      </form>

      {hayDetalle ? (
        <p className="rounded-lg bg-realce px-3 py-2 text-xs text-suave">
          El total se suma solo con las reposiciones anotadas. No hace falta cargar ningún número al final, y el detalle con los horarios queda guardado.
        </p>
      ) : (
        <form onSubmit={cargarTotal} className="space-y-3 rounded-xl border border-dashed border-borde p-3">
          <p className="text-sm font-semibold">{hayTotal ? 'Corregir el total cargado de una vez' : 'O cargar el total de una vez'}</p>
          <p className="text-xs text-suave">Solo si durante la noche no se anotó cada reposición. Si se anotaron, el total se suma solo.</p>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder={String(suma)}
              className="min-h-11 w-full flex-1 rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
            />
            <Boton type="submit" variante="secundario" cargando={carga.guardando}>
              {hayTotal ? 'Corregir' : 'Cargar total'}
            </Boton>
          </div>
          {total !== '' && <AvisoStock articuloId={linea.articulo_id} anterior={suma} nuevo={Number(total)} unidad={u} />}
          {nuevoFinalInvalido && <Aviso>Ojo: el stock final cargado quedaría mayor a lo llevado.</Aviso>}
        </form>
      )}
      {error && <Aviso>{error}</Aviso>}
    </div>
  )
}

// ------------------------------------------------------------------ Elegir artículos de la barra

function AgregarArticulos({ barra, eventoId, yaEstan, alTerminar }: { barra: Barra; eventoId: string; yaEstan: string[]; alTerminar: () => void }) {
  const localId = useLocalId()
  const { data: articulos } = useArticulos()
  const { data: stock } = useStockLocal()
  const carga = useCargaEvento(eventoId)
  const [busqueda, setBusqueda] = useState('')
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const opciones = useMemo(
    () =>
      (articulos ?? [])
        .filter((a) => a.activo && !yaEstan.includes(a.id))
        .filter((a) => coincideBusqueda(busqueda, [a.nombre, a.marca, a.tamano])),
    [articulos, yaEstan, busqueda],
  )

  const alternar = (id: string) =>
    setElegidos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function guardar() {
    setError('')
    if (elegidos.size === 0) return setError('Elegí al menos un artículo.')
    try {
      const ids = [...elegidos]
      const art = (id: string) => articulos?.find((a) => a.id === id)
      await carga.guardar(`Agregar ${ids.length} ${ids.length === 1 ? 'artículo' : 'artículos'} a ${barra.nombre}`, [
        insertar(
          'barra_articulos',
          ids.map((articulo_id) => ({ barra_id: barra.id, evento_id: eventoId, local_id: localId, articulo_id })),
          // Para mostrarlos enseguida aunque no haya conexión
          ids.map((id) => {
            const a = art(id)
            return { articulo: { nombre: a?.nombre ?? 'Artículo', unidad: a?.unidad ?? 'unidad', marca: a?.marca ?? null, tamano: a?.tamano ?? null } }
          }),
        ),
      ])
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-suave">Marcá los artículos que lleva esta barra esta noche. Después cargás las cantidades.</p>
      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar…"
        className="block min-h-11 w-full rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
      />
      <div className="flex justify-between text-sm">
        <button className="text-marca-700 underline" onClick={() => setElegidos(new Set(opciones.map((a) => a.id)))}>
          Marcar todos
        </button>
        {elegidos.size > 0 && (
          <button className="text-suave underline" onClick={() => setElegidos(new Set())}>
            Desmarcar
          </button>
        )}
      </div>
      <ul className="max-h-[45dvh] divide-y divide-borde overflow-y-auto rounded-lg border border-borde">
        {opciones.map((a) => (
          <li key={a.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-realce">
              <input type="checkbox" checked={elegidos.has(a.id)} onChange={() => alternar(a.id)} className="size-5 accent-zinc-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.nombre}</span>
                {detalleArticulo(a) && <span className="block text-xs text-suave">{detalleArticulo(a)}</span>}
              </span>
              {stock?.get(a.id) != null && <span className="tabular text-xs text-suave">dep. {formatoNumero(stock.get(a.id)!)}</span>}
            </label>
          </li>
        ))}
        {opciones.length === 0 && <li className="px-3 py-3 text-sm text-suave">No hay más artículos para agregar.</li>}
      </ul>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton className="flex-1" onClick={guardar} cargando={carga.guardando}>
          Agregar {elegidos.size > 0 ? elegidos.size : ''}
        </Boton>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Retiros

function SeccionRetiros({
  retiros,
  eventoId,
  alAgregar,
  hayArticulos,
}: {
  retiros: RetiroDB[]
  eventoId: string
  alAgregar: () => void
  hayArticulos: boolean
}) {
  const carga = useCargaEvento(eventoId)
  const [error, setError] = useState('')

  async function borrar(r: RetiroDB) {
    if (!confirm(`¿Borrar el retiro de ${r.cantidad} ${r.articulo?.nombre ?? r.trago?.nombre ?? ''}? Va a la papelera durante 30 días.`)) return
    try {
      await carga.guardar(`Borrar el retiro de ${r.cantidad} ${r.articulo?.nombre ?? r.trago?.nombre ?? ''}`, [aPapelera('retiro', r.id)])
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <section className="space-y-2 pt-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Retiros</h3>
          <p className="text-xs text-suave">Consumo de personal y cortesías. Salen de lo cargado en la barra (no del depósito).</p>
        </div>
        {hayArticulos && (
          <Boton variante="secundario" className="shrink-0 whitespace-nowrap" onClick={alAgregar}>
            + Retiro
          </Boton>
        )}
      </div>
      {error && <Aviso>{error}</Aviso>}
      {retiros.length === 0 ? (
        <p className="rounded-lg border border-dashed border-borde px-3 py-4 text-center text-sm text-suave">Sin retiros en esta barra.</p>
      ) : (
        <Tarjeta className="divide-y divide-borde">
          {retiros.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  {r.articulo?.nombre ?? r.trago?.nombre} ·{' '}
                  <span className="tabular">{r.trago_id ? formatoVasos(r.cantidad) : formatoCantidad(r.cantidad, r.articulo?.unidad)}</span>{' '}
                  <Etiqueta color={r.tipo === 'personal' ? 'gris' : 'verde'}>{r.tipo === 'personal' ? 'Personal' : 'Cortesía'}</Etiqueta>
                </p>
                <p className="truncate text-xs text-suave">
                  Retiró: {r.retirado_por} · {formatoHora(r.hora)} · cargó {r.autor?.nombre ?? 'usuario'}
                </p>
              </div>
              <button onClick={() => borrar(r)} className="rounded px-2 py-1 text-suave hover:bg-realce hover:text-alerta" aria-label="Borrar">
                ✕
              </button>
            </div>
          ))}
        </Tarjeta>
      )}
    </section>
  )
}

function FormRetiro({ barra, lineas, eventoId, alTerminar }: { barra: Barra; lineas: LineaBarraDB[]; eventoId: string; alTerminar: () => void }) {
  const localId = useLocalId()
  const carga = useCargaEvento(eventoId)
  const { puede } = useSesion()
  const { data: tragos } = useTragos()
  const guardarTrago = useGuardarTrago()
  // "a:<id>" = botella de la barra · "t:<id>" = trago o vaso
  const [eleccion, setEleccion] = useState(lineas.length === 1 ? `a:${lineas[0].articulo_id}` : '')
  const [tipo, setTipo] = useState<'personal' | 'cortesia'>('personal')
  const [nuevoTrago, setNuevoTrago] = useState<string | null>(null)
  const esTrago = eleccion.startsWith('t:')
  const [cantidad, setCantidad] = useState('1')
  const [quien, setQuien] = useState('')
  const [hora, setHora] = useState(ahoraParaInput())
  const [error, setError] = useState('')

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const n = Number(cantidad)
    if (!eleccion) return setError('Elegí qué se retiró.')
    if (!Number.isInteger(n) || n <= 0) return setError('La cantidad tiene que ser un número entero mayor a 0.')
    if (!quien.trim()) return setError('Anotá quién lo retiró.')
    try {
      const id = eleccion.slice(2)
      const linea = lineas.find((l) => l.articulo_id === id)
      const trago = tragos?.find((t) => t.id === id)
      const que = esTrago ? (trago?.nombre ?? 'trago') : (linea?.articulo.nombre ?? 'artículo')
      await carga.guardar(`${tipo === 'personal' ? 'Retiro de personal' : 'Cortesía'}: ${n} ${que}`, [
        insertar(
          'retiros',
          {
            barra_id: barra.id,
            evento_id: eventoId,
            local_id: localId,
            articulo_id: esTrago ? null : id,
            trago_id: esTrago ? id : null,
            tipo,
            cantidad: n,
            retirado_por: quien.trim(),
            hora: new Date(hora).toISOString(),
          },
          esTrago ? { trago: { nombre: que }, articulo: null } : { articulo: { nombre: que, unidad: linea?.articulo.unidad ?? 'unidad' }, trago: null },
        ),
      ])
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-realce p-1 text-sm">
        {(
          [
            ['personal', 'Consumo de personal'],
            ['cortesia', 'Cortesía'],
          ] as const
        ).map(([t, texto]) => (
          <button key={t} type="button" onClick={() => setTipo(t)} className={cx('rounded-md py-2', tipo === t ? 'plata font-semibold' : 'text-suave')}>
            {texto}
          </button>
        ))}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Botella, trago o vaso *</label>
        <select
          value={eleccion}
          onChange={(e) => setEleccion(e.target.value)}
          className="block min-h-11 w-full rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
        >
          <option value="">Elegí…</option>
          <optgroup label="Botellas de esta barra">
            {lineas.map((l) => (
              <option key={l.articulo_id} value={`a:${l.articulo_id}`}>
                {l.articulo.nombre}
              </option>
            ))}
          </optgroup>
          <optgroup label="Tragos y vasos">
            {(tragos ?? [])
              .filter((t) => t.activo)
              .map((t) => (
                <option key={t.id} value={`t:${t.id}`}>
                  {t.nombre}
                </option>
              ))}
          </optgroup>
        </select>
        {esTrago && <p className="mt-1 text-xs text-suave">Se cuenta en vasos. Es informativo: no descuenta del depósito (sale de las botellas de la barra).</p>}
        {puede('articulos.editar') && nuevoTrago == null && (
          <button type="button" onClick={() => setNuevoTrago('')} className="mt-1 text-sm text-marca-700 underline">
            + Agregar otro trago o vaso a la lista
          </button>
        )}
        {nuevoTrago != null && (
          <div className="mt-2 flex gap-2">
            <input
              value={nuevoTrago}
              onChange={(e) => setNuevoTrago(e.target.value)}
              placeholder="Ej: Trago Fernet"
              autoFocus
              className="min-h-11 w-full flex-1 rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
            />
            <Boton
              variante="secundario"
              cargando={guardarTrago.isPending}
              onClick={async () => {
                if (!nuevoTrago.trim()) return
                try {
                  const t = await guardarTrago.mutateAsync({ nombre: nuevoTrago.trim() })
                  setEleccion(`t:${t.id}`)
                  setNuevoTrago(null)
                } catch (err) {
                  setError(mensajeError(err))
                }
              }}
            >
              Agregar
            </Boton>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo
          etiqueta={esTrago ? 'Cantidad (vasos) *' : 'Cantidad *'}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
        <Campo etiqueta="Hora" type="datetime-local" value={hora} onChange={(e) => setHora(e.target.value)} />
      </div>
      <Campo
        etiqueta="¿Quién lo retiró? *"
        value={quien}
        onChange={(e) => setQuien(e.target.value)}
        placeholder={tipo === 'personal' ? 'Ej: Juan (mozo)' : 'Ej: mesa de los novios'}
      />
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={carga.guardando}>
          Guardar retiro
        </Boton>
      </div>
    </form>
  )
}

function RenombrarBarra({ barra, eventoId, alTerminar }: { barra: Barra; eventoId: string; alTerminar: () => void }) {
  const carga = useCargaEvento(eventoId)
  const [nombre, setNombre] = useState(barra.nombre)
  const [error, setError] = useState('')
  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return setError('Poné un nombre.')
    try {
      await carga.guardar(`Renombrar ${barra.nombre} a ${nombre.trim()}`, [actualizar('barras', barra.id, { nombre: nombre.trim() })])
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }
  return (
    <form onSubmit={guardar} className="space-y-4">
      <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej: Barra VIP" />
      {error && <Aviso>{error}</Aviso>}
      <Boton type="submit" className="w-full" cargando={carga.guardando}>
        Guardar
      </Boton>
    </form>
  )
}
