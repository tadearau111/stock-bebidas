import { describe, expect, it } from 'vitest'
import type { DetalleEvento } from '../tipos'
import { actualizar, aPapelera, esErrorDeRed, guardarCaja, insertar, type Operacion, type Pendiente } from './cola'
import { superponerPendientes } from './superponer'

const base: DetalleEvento = {
  evento: { id: 'e', local_id: 'l', fecha: '2026-11-20', nombre: 'Casamiento', personas: 100, notas: null, creado_en: '', tipo_barra: 'propia', archivado: false, archivado_en: null },
  barras: [{ id: 'b1', evento_id: 'e', nombre: 'Barra 1', orden: 1 }],
  lineas: [
    {
      id: 'l1',
      barra_id: 'b1',
      articulo_id: 'coca',
      stock_inicial: 12,
      stock_final: null,
      articulo: { nombre: 'Coca Cola', unidad: 'unidad', marca: null, tamano: null },
      reposiciones: [{ id: 'r0', barra_articulo_id: 'l1', tipo: 'detalle', cantidad: 6, hora: '2026-11-21T01:00:00Z' }],
    },
  ],
  retiros: [],
  bebidaAbierta: [],
  caja: null,
  gastos: [],
  cajeros: [],
  retirosCajeros: [],
}

let n = 0
const pend = (op: Operacion, estado: Pendiente['estado'] = 'pendiente', eventoId = 'e'): Pendiente => ({
  clave: `k${++n}`,
  eventoId,
  usuarioId: 'u',
  descripcion: '',
  op,
  creado: '',
  estado,
})

describe('Cambios sin conexión: se ven como si ya estuvieran guardados', () => {
  it('sin pendientes devuelve lo mismo', () => {
    expect(superponerPendientes(base, [], 'Laura')).toBe(base)
  })

  it('una reposición nueva se suma a su artículo, con quien la cargó', () => {
    const op = insertar('reposiciones', { barra_articulo_id: 'l1', evento_id: 'e', articulo_id: 'coca', tipo: 'detalle', cantidad: 4, hora: '2026-11-21T02:00:00Z' })
    const d = superponerPendientes(base, [pend(op)], 'Laura')
    expect(d.lineas[0].reposiciones.map((r) => r.cantidad)).toEqual([6, 4])
    expect(d.lineas[0].reposiciones[1].autor?.nombre).toBe('Laura')
    // no toca los datos originales
    expect(base.lineas[0].reposiciones).toHaveLength(1)
  })

  it('cambia el stock final y borra lo que se mandó a la papelera', () => {
    const d = superponerPendientes(base, [pend(actualizar('barra_articulos', 'l1', { stock_final: 3 })), pend(aPapelera('reposicion', 'r0'))], 'Laura')
    expect(d.lineas[0].stock_final).toBe(3)
    expect(d.lineas[0].reposiciones).toHaveLength(0)
  })

  it('un cajero creado sin conexión y su retiro (el retiro apunta al id del cajero)', () => {
    const cajero = insertar('evento_cajeros', { evento_id: 'e', nombre: 'Sofía', orden: 1 })
    const idCajero = String(cajero.filas[0].id)
    const retiro = insertar('cajero_retiros', { cajero_id: idCajero, evento_id: 'e', monto: 50000 })
    const d = superponerPendientes(base, [pend(cajero), pend(retiro)], 'Laura')
    expect(d.cajeros.map((c) => c.nombre)).toEqual(['Sofía'])
    expect(d.retirosCajeros[0]).toMatchObject({ cajero_id: idCajero, monto: 50000 })
    expect(typeof d.retirosCajeros[0].hora).toBe('string') // la hora es la de cuando se cargó
  })

  it('artículos nuevos en la barra muestran su nombre y arrancan en 0', () => {
    const op = insertar('barra_articulos', [{ barra_id: 'b1', evento_id: 'e', articulo_id: 'agua' }], [{ articulo: { nombre: 'Agua', unidad: 'unidad', marca: null, tamano: null } }])
    const d = superponerPendientes(base, [pend(op)], 'Laura')
    expect(d.lineas.map((l) => [l.articulo.nombre, l.stock_inicial, l.stock_final, l.reposiciones.length])).toEqual([
      ['Agua', 0, null, 0],
      ['Coca Cola', 12, null, 1],
    ])
  })

  it('la caja se completa con lo cargado', () => {
    const d = superponerPendientes(base, [pend(guardarCaja({ evento_id: 'e', efectivo_real: 1000 }))], 'Laura')
    expect(d.caja?.efectivo_real).toBe(1000)
  })

  it('borrar una barra se lleva sus artículos', () => {
    const d = superponerPendientes(base, [pend(aPapelera('barra', 'b1'))], 'Laura')
    expect(d.barras).toHaveLength(0)
    expect(d.lineas).toHaveLength(0)
  })

  it('no aplica los de otro evento ni los que dieron error, y no duplica lo ya enviado', () => {
    const op = insertar('evento_gastos', { evento_id: 'e', monto: 100, detalle: 'Hielo' })
    const ya = { ...base, gastos: [{ id: String(op.filas[0].id), evento_id: 'e', monto: 100, detalle: 'Hielo', hora: '2026-11-21T03:00:00Z' }] }
    const d = superponerPendientes(ya, [pend(op, 'enviado'), pend(insertar('evento_gastos', { evento_id: 'e', monto: 5, detalle: 'X' }), 'error'), pend(op, 'pendiente', 'otro')], 'Laura')
    expect(d.gastos).toHaveLength(1)
  })
})

describe('Detectar falta de conexión', () => {
  it('reconoce los errores de red de cada navegador', () => {
    expect(esErrorDeRed({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true)
    expect(esErrorDeRed({ message: 'TypeError: Load failed' })).toBe(true)
    expect(esErrorDeRed({ message: 'TypeError: NetworkError when attempting to fetch resource.' })).toBe(true)
  })
  it('un error de la base no es de conexión', () => {
    expect(esErrorDeRed({ message: 'new row violates row-level security policy', code: '42501' })).toBe(false)
  })
})
