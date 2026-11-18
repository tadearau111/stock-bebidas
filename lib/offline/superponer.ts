// Muestra los cambios que todavía están en la cola (sin conexión) como si ya
// estuvieran guardados: se aplican sobre los datos del evento que vinieron de la base.

import type { DetalleEvento } from '../tipos'
import type { Fila, Operacion, Pendiente } from './cola'

type Lista = 'barras' | 'lineas' | 'retiros' | 'bebidaAbierta' | 'gastos' | 'cajeros' | 'retirosCajeros'

const LISTA_DE: Record<string, Lista | 'reposiciones'> = {
  barras: 'barras',
  barra_articulos: 'lineas',
  reposiciones: 'reposiciones',
  retiros: 'retiros',
  bebida_abierta: 'bebidaAbierta',
  evento_gastos: 'gastos',
  evento_cajeros: 'cajeros',
  cajero_retiros: 'retirosCajeros',
}

type ConId = { id: string }

/** Copia superficial de las listas (para no tocar los datos guardados en memoria). */
function copiar(d: DetalleEvento): DetalleEvento {
  return {
    ...d,
    barras: [...d.barras],
    lineas: d.lineas.map((l) => ({ ...l, reposiciones: [...l.reposiciones] })),
    retiros: [...d.retiros],
    bebidaAbierta: [...d.bebidaAbierta],
    gastos: [...d.gastos],
    cajeros: [...(d.cajeros ?? [])],
    retirosCajeros: [...(d.retirosCajeros ?? [])],
  }
}

function aplicar(d: DetalleEvento, op: Operacion, yo: string): void {
  const autor = { nombre: yo }
  const lista = (nombre: Lista) => d[nombre] as unknown as ConId[]

  switch (op.tipo) {
    case 'insertar': {
      const destino = LISTA_DE[op.tabla]
      op.filas.forEach((fila, i) => {
        const nueva = { autor, ...fila, ...(op.vista?.[i] ?? {}) } as unknown as Fila & ConId
        if (destino === 'reposiciones') {
          const l = d.lineas.find((x) => x.id === fila.barra_articulo_id)
          if (l && !l.reposiciones.some((r) => r.id === nueva.id)) l.reposiciones.push(nueva as never)
          return
        }
        if (destino === 'lineas') Object.assign(nueva, { stock_inicial: fila.stock_inicial ?? 0, stock_final: fila.stock_final ?? null, reposiciones: [] })
        if (destino === 'cajeros') Object.assign(nueva, { orden: fila.orden ?? 0 })
        const l = lista(destino)
        if (!l.some((x) => x.id === nueva.id)) l.push(nueva)
      })
      break
    }
    case 'actualizar': {
      const destino = LISTA_DE[op.tabla]
      if (destino === 'reposiciones') {
        for (const l of d.lineas) l.reposiciones = l.reposiciones.map((r) => (r.id === op.id ? { ...r, ...op.cambios } : r))
        return
      }
      const nombre = destino as Lista
      ;(d[nombre] as unknown as ConId[]) = lista(nombre).map((x) => (x.id === op.id ? { ...x, ...op.cambios } : x))
      break
    }
    case 'caja': {
      d.caja = { ...(d.caja ?? {}), ...op.fila, actualizado_en: new Date().toISOString() } as DetalleEvento['caja']
      break
    }
    case 'papelera': {
      const id = op.id
      const sacar = (nombre: Lista, cond: (x: Fila) => boolean) => {
        ;(d[nombre] as unknown as Fila[]) = (d[nombre] as unknown as Fila[]).filter((x) => !cond(x))
      }
      switch (op.papelera) {
        case 'barra':
          sacar('barras', (x) => x.id === id)
          sacar('lineas', (x) => x.barra_id === id)
          sacar('retiros', (x) => x.barra_id === id)
          break
        case 'linea':
          sacar('lineas', (x) => x.id === id)
          break
        case 'reposicion':
          for (const l of d.lineas) l.reposiciones = l.reposiciones.filter((r) => r.id !== id)
          break
        case 'retiro':
          sacar('retiros', (x) => x.id === id)
          break
        case 'bebida_abierta':
          sacar('bebidaAbierta', (x) => x.id === id)
          break
        case 'gasto':
          sacar('gastos', (x) => x.id === id)
          break
        case 'cajero':
          sacar('cajeros', (x) => x.id === id)
          sacar('retirosCajeros', (x) => x.cajero_id === id)
          break
        case 'retiro_cajero':
          sacar('retirosCajeros', (x) => x.id === id)
          break
      }
      break
    }
  }
}

/** Datos del evento + los cambios todavía no confirmados por la base (en orden). */
export function superponerPendientes(detalle: DetalleEvento, pendientes: Pendiente[], yo: string): DetalleEvento {
  const propios = pendientes.filter((p) => p.eventoId === detalle.evento.id && p.estado !== 'error')
  if (!propios.length) return detalle
  const d = copiar(detalle)
  for (const p of propios) aplicar(d, p.op, yo)
  // Mismo orden que trae la base
  d.retiros.sort((a, b) => b.hora.localeCompare(a.hora))
  d.bebidaAbierta.sort((a, b) => b.hora.localeCompare(a.hora))
  d.gastos.sort((a, b) => a.hora.localeCompare(b.hora))
  d.retirosCajeros.sort((a, b) => a.hora.localeCompare(b.hora))
  for (const l of d.lineas) l.reposiciones.sort((a, b) => a.hora.localeCompare(b.hora))
  d.lineas.sort((a, b) => a.articulo.nombre.localeCompare(b.articulo.nombre, 'es'))
  return d
}
