'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Aviso, Boton, Campo, Selector, cx } from '@/components/ui'
import { ajustePorConteo, coincideBusqueda, esCantidadValida } from '@/lib/calculos/stock'
import { useCargarMovimientos, useGuardarArticulo } from '@/lib/datos'
import { useGuardarProveedor, useProveedores } from '@/lib/proveedores'
import { ahoraParaInput, detalleArticulo, formatoCantidad, leerPrecio, mensajeError } from '@/lib/formato'
import type { Articulo, Unidad } from '@/lib/tipos'

// =================================================================== Artículo

export function FormArticulo({ articulo, alTerminar }: { articulo?: Articulo; alTerminar: () => void }) {
  const guardar = useGuardarArticulo()
  const [nombre, setNombre] = useState(articulo?.nombre ?? '')
  const [marca, setMarca] = useState(articulo?.marca ?? '')
  const [tamano, setTamano] = useState(articulo?.tamano ?? '')
  const [unidad, setUnidad] = useState<Unidad>(articulo?.unidad ?? 'unidad')
  const [minimo, setMinimo] = useState(String(articulo?.stock_minimo ?? 0))
  const [costo, setCosto] = useState(articulo?.precio_costo?.toString().replace('.', ',') ?? '')
  const [mayorista, setMayorista] = useState(articulo?.precio_mayorista?.toString().replace('.', ',') ?? '')
  const [error, setError] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const min = Number(minimo || 0)
    const pc = leerPrecio(costo)
    const pm = leerPrecio(mayorista)
    if (!nombre.trim()) return setError('El nombre es obligatorio.')
    if (!Number.isInteger(min) || min < 0) return setError('El stock mínimo tiene que ser un número entero, 0 o más.')
    if (Number.isNaN(pc) || (pc ?? 0) < 0) return setError('El precio de costo no es válido.')
    if (Number.isNaN(pm) || (pm ?? 0) < 0) return setError('El precio mayorista no es válido.')
    try {
      await guardar.mutateAsync({
        id: articulo?.id,
        datos: {
          nombre: nombre.trim(),
          marca: marca.trim() || null,
          tamano: tamano.trim() || null,
          unidad,
          stock_minimo: min,
          precio_costo: pc,
          precio_mayorista: pm,
        },
      })
      alTerminar()
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo etiqueta="Nombre *" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus={!articulo} required />
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
        <Campo etiqueta="Tamaño" value={tamano} onChange={(e) => setTamano(e.target.value)} placeholder="Ej: 1.5 L" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Selector etiqueta="Se cuenta por" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)}>
          <option value="unidad">Unidad</option>
          <option value="bolsa">Bolsa</option>
        </Selector>
        <Campo
          etiqueta="Stock mínimo"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={minimo}
          onChange={(e) => setMinimo(e.target.value)}
          ayuda="Debajo de esto, se marca en rojo"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo
          etiqueta="Precio de costo"
          inputMode="decimal"
          placeholder="Opcional"
          value={costo}
          onChange={(e) => setCosto(e.target.value)}
          ayuda="Para eventos con barra propia"
        />
        <Campo
          etiqueta="Precio mayorista"
          inputMode="decimal"
          placeholder="Opcional"
          value={mayorista}
          onChange={(e) => setMayorista(e.target.value)}
          ayuda="Para eventos con barra concesionada"
        />
      </div>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2 pt-2">
        <Boton variante="secundario" className="flex-1" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={guardar.isPending}>
          {articulo ? 'Guardar cambios' : 'Agregar artículo'}
        </Boton>
      </div>
    </form>
  )
}

// =================================================================== Buscador de artículo

function ElegirArticulo({
  articulos,
  valor,
  alElegir,
  excluir = [],
}: {
  articulos: Articulo[]
  valor: Articulo | null
  alElegir: (a: Articulo | null) => void
  excluir?: string[]
}) {
  const [texto, setTexto] = useState('')
  const opciones = useMemo(
    () =>
      articulos
        .filter((a) => a.activo && !excluir.includes(a.id))
        .filter((a) => coincideBusqueda(texto, [a.nombre, a.marca, a.tamano]))
        .slice(0, 8),
    [articulos, texto, excluir],
  )

  if (valor) {
    return (
      <div className="flex min-h-11 items-center justify-between rounded-lg border border-marca-500 bg-marca-50 px-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{valor.nombre}</p>
          <p className="text-xs text-suave">Stock actual: {formatoCantidad(valor.stock_actual, valor.unidad)}</p>
        </div>
        <button type="button" onClick={() => alElegir(null)} className="ml-2 shrink-0 text-sm text-marca-700 underline">
          Cambiar
        </button>
      </div>
    )
  }

  return (
    <div>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscá el artículo…"
        className="block min-h-11 w-full rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500 focus:ring-2 focus:ring-marca-100"
      />
      <ul className="mt-1 max-h-56 divide-y divide-borde overflow-y-auto rounded-lg border border-borde">
        {opciones.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => alElegir(a)} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-realce">
              <span>
                <span className="font-medium">{a.nombre}</span>
                {detalleArticulo(a) && <span className="block text-xs text-suave">{detalleArticulo(a)}</span>}
              </span>
              <span className="tabular text-sm text-suave">{formatoCantidad(a.stock_actual, a.unidad)}</span>
            </button>
          </li>
        ))}
        {opciones.length === 0 && <li className="px-3 py-2.5 text-sm text-suave">No hay artículos con ese nombre.</li>}
      </ul>
    </div>
  )
}

// =================================================================== Ingreso (compras)

interface LineaIngreso {
  clave: number
  articulo: Articulo | null
  cantidad: string
}

export function FormIngreso({
  articulos,
  inicial,
  alTerminar,
}: {
  articulos: Articulo[]
  inicial?: Articulo
  alTerminar: (mensaje?: string) => void
}) {
  const cargar = useCargarMovimientos()
  const [lineas, setLineas] = useState<LineaIngreso[]>([{ clave: 1, articulo: inicial ?? null, cantidad: '' }])
  const [fecha, setFecha] = useState(ahoraParaInput())
  const [proveedorId, setProveedorId] = useState('')
  const [error, setError] = useState('')

  const cambiar = (clave: number, cambios: Partial<LineaIngreso>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)))

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const completas = lineas.filter((l) => l.articulo || l.cantidad)
    if (completas.length === 0) return setError('Elegí al menos un artículo.')
    for (const l of completas) {
      if (!l.articulo) return setError('Falta elegir el artículo en una de las líneas.')
      if (!esCantidadValida(Number(l.cantidad))) return setError(`La cantidad de ${l.articulo.nombre} tiene que ser un número entero mayor a 0.`)
    }
    try {
      await cargar.mutateAsync(
        completas.map((l) => ({
          articulo_id: l.articulo!.id,
          tipo: 'ingreso' as const,
          proveedor_id: proveedorId || null,
          cantidad: Number(l.cantidad),
          fecha: new Date(fecha).toISOString(),
        })),
      )
      alTerminar(completas.length === 1 ? 'Ingreso cargado.' : `Se cargaron ${completas.length} ingresos.`)
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-suave">Cargá lo que compraste, siempre en unidades (o bolsas para el hielo).</p>
      <ElegirProveedor valor={proveedorId} alCambiar={setProveedorId} />
      {lineas.map((l, i) => (
        <div key={l.clave} className="space-y-2 rounded-xl border border-borde p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Artículo {lineas.length > 1 ? i + 1 : ''}</span>
            {lineas.length > 1 && (
              <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))} className="text-sm text-alerta">
                Quitar
              </button>
            )}
          </div>
          <ElegirArticulo
            articulos={articulos}
            valor={l.articulo}
            alElegir={(a) => cambiar(l.clave, { articulo: a })}
            excluir={lineas.filter((x) => x.clave !== l.clave && x.articulo).map((x) => x.articulo!.id)}
          />
          <Campo
            etiqueta={l.articulo?.unidad === 'bolsa' ? 'Cantidad (bolsas)' : 'Cantidad (unidades)'}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={l.cantidad}
            onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })}
          />
        </div>
      ))}
      <Boton
        variante="fantasma"
        className="w-full border border-dashed border-marca-500"
        onClick={() => setLineas((ls) => [...ls, { clave: Math.max(...ls.map((x) => x.clave)) + 1, articulo: null, cantidad: '' }])}
      >
        + Otro artículo
      </Boton>
      <Campo etiqueta="Fecha y hora" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2 pt-2">
        <Boton variante="secundario" className="flex-1" onClick={() => alTerminar()}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={cargar.isPending}>
          Guardar ingreso
        </Boton>
      </div>
    </form>
  )
}

// =================================================================== Ajuste manual

const MOTIVOS = ['Conteo físico', 'Rotura', 'Vencimiento', 'Error de carga', 'Otro']

export function FormAjuste({ articulo, alTerminar }: { articulo: Articulo; alTerminar: (mensaje?: string) => void }) {
  const cargar = useCargarMovimientos()
  const [modo, setModo] = useState<'conteo' | 'diferencia'>('conteo')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('Conteo físico')
  const [detalle, setDetalle] = useState('')
  const [error, setError] = useState('')

  const numero = Number(valor)
  const ajuste = valor === '' ? 0 : modo === 'conteo' ? ajustePorConteo(articulo.stock_actual, numero) : numero
  const u = articulo.unidad

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (valor === '' || !Number.isInteger(numero)) return setError('Ingresá un número entero.')
    if (modo === 'conteo' && numero < 0) return setError('Lo contado no puede ser negativo.')
    if (ajuste === 0) return setError('El stock ya es ese, no hay nada que ajustar.')
    const textoMotivo = motivo === 'Otro' ? detalle.trim() : [motivo, detalle.trim()].filter(Boolean).join(': ')
    if (!textoMotivo) return setError('El motivo es obligatorio.')
    try {
      await cargar.mutateAsync([{ articulo_id: articulo.id, tipo: 'ajuste', cantidad: ajuste, motivo: textoMotivo }])
      alTerminar('Ajuste guardado.')
    } catch (err) {
      setError(mensajeError(err))
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="rounded-lg bg-fondo px-3 py-2">
        <p className="font-medium">{articulo.nombre}</p>
        <p className="text-sm text-suave">Stock en el sistema: {formatoCantidad(articulo.stock_actual, u)}</p>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-fondo p-1 text-sm">
        {(
          [
            ['conteo', 'Lo que conté'],
            ['diferencia', 'Sumar / restar'],
          ] as const
        ).map(([m, t]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setModo(m)
              setValor('')
            }}
            className={cx('rounded-md py-2', modo === m ? 'bg-superficie font-semibold shadow-sm' : 'text-suave')}
          >
            {t}
          </button>
        ))}
      </div>
      <Campo
        etiqueta={modo === 'conteo' ? 'Cantidad que hay realmente' : 'Cantidad a sumar (o restar con signo −)'}
        type="number"
        inputMode={modo === 'conteo' ? 'numeric' : 'text'}
        step={1}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        autoFocus
      />
      {valor !== '' && Number.isInteger(numero) && ajuste !== 0 && (
        <Aviso tipo="info">
          Se va a registrar un ajuste de <b>{ajuste > 0 ? '+' : ''}{formatoCantidad(ajuste, u)}</b>. El stock queda en{' '}
          <b>{formatoCantidad(articulo.stock_actual + ajuste, u)}</b>.
        </Aviso>
      )}
      <Selector etiqueta="Motivo *" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
        {MOTIVOS.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </Selector>
      <Campo
        etiqueta={motivo === 'Otro' ? 'Explicá el motivo *' : 'Detalle (opcional)'}
        value={detalle}
        onChange={(e) => setDetalle(e.target.value)}
        placeholder="Ej: se rompieron en la descarga"
      />
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2 pt-2">
        <Boton variante="secundario" className="flex-1" onClick={() => alTerminar()}>
          Cancelar
        </Boton>
        <Boton type="submit" className="flex-1" cargando={cargar.isPending}>
          Guardar ajuste
        </Boton>
      </div>
    </form>
  )
}

// =================================================================== Proveedor

/** Elegir un proveedor de la lista o agregar uno nuevo en el momento. Opcional. */
export function ElegirProveedor({ valor, alCambiar }: { valor: string; alCambiar: (id: string) => void }) {
  const { data: proveedores } = useProveedores()
  const guardar = useGuardarProveedor()
  const [nuevo, setNuevo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const opciones = (proveedores ?? []).filter((p) => p.activo || p.id === valor)

  async function agregar() {
    if (!nuevo?.trim()) return
    setError('')
    // si ya existe con ese nombre, se elige ese
    const existente = proveedores?.find((p) => p.nombre.trim().toLowerCase() === nuevo.trim().toLowerCase())
    if (existente) {
      alCambiar(existente.id)
      setNuevo(null)
      return
    }
    try {
      const p = await guardar.mutateAsync({ nombre: nuevo.trim() })
      alCambiar(p.id)
      setNuevo(null)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  return (
    <div>
      {nuevo == null ? (
        <>
          <Selector etiqueta="Proveedor (opcional)" value={valor} onChange={(e) => alCambiar(e.target.value)}>
            <option value="">Sin proveedor</option>
            {opciones.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Selector>
          <button type="button" onClick={() => setNuevo('')} className="mt-1 text-sm text-marca-700 underline">
            + Nuevo proveedor
          </button>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-sm font-medium">Nuevo proveedor</label>
          <div className="flex gap-2">
            <input
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  agregar()
                }
              }}
              placeholder="Ej: Distribuidora Norte"
              autoFocus
              className="min-h-11 w-full flex-1 rounded-lg border border-borde bg-superficie px-3 outline-none focus:border-marca-500"
            />
            <Boton variante="secundario" onClick={agregar} cargando={guardar.isPending}>
              Agregar
            </Boton>
          </div>
          <button type="button" onClick={() => setNuevo(null)} className="mt-1 text-sm text-suave underline">
            Cancelar
          </button>
        </div>
      )}
      {error && <div className="mt-2"><Aviso>{error}</Aviso></div>}
    </div>
  )
}
