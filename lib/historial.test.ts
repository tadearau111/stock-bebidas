import { describe, expect, it } from 'vitest'
import { describir, formatoValor, type Nombres, type RegistroAuditoria } from './historial'

const base = { id: 1, registro_id: 'x', usuario_id: 'u1', fecha: '2026-11-17T03:00:00Z', articulo_id: null, evento_id: null }
const nombres: Nombres = {
  usuarios: new Map([['u1', 'Laura']]),
  articulos: new Map([['a1', 'Coca Cola 2.0 L']]),
  eventos: new Map([['e1', 'Casamiento']]),
  roles: new Map([['r1', 'Encargado de la noche']]),
}

describe('Historial en lenguaje simple', () => {
  it('muestra el valor anterior y el nuevo del stock final', () => {
    const d = describir({ ...base, tabla: 'barra_articulos', accion: 'modificacion', cambios: { stock_final: { antes: 7, despues: 9 } } } as RegistroAuditoria)
    expect(d.titulo).toBe('modificó un artículo de barra')
    expect(d.cambios).toEqual([{ campo: 'Stock final', antes: '7', despues: '9' }])
  })

  it('un ingreso se describe como ingreso', () => {
    const d = describir(
      { ...base, tabla: 'movimientos', accion: 'alta', cambios: { tipo: { antes: null, despues: 'ingreso' }, cantidad: { antes: null, despues: 24 }, id: { antes: null, despues: 'x' } } } as RegistroAuditoria,
    )
    expect(d.titulo).toBe('cargó un ingreso de stock')
    expect(d.cambios.map((c) => c.campo)).toEqual(['Tipo', 'Cantidad']) // oculta el id
  })

  it('desactivar un usuario', () => {
    const d = describir({ ...base, tabla: 'perfiles', accion: 'modificacion', cambios: { activo: { antes: true, despues: false } } } as RegistroAuditoria)
    expect(d.titulo).toBe('desactivó un usuario')
    expect(d.cambios[0]).toEqual({ campo: 'Activo', antes: 'Sí', despues: 'No' })
  })

  it('reemplaza ids por nombres', () => {
    expect(formatoValor('rol_id', 'r1', nombres)).toBe('Encargado de la noche')
    expect(formatoValor('usuario_id', 'u1', nombres)).toBe('Laura')
  })

  it('formatea fracciones, tipos, precios y vacíos', () => {
    expect(formatoValor('cuartos', 2)).toBe('½')
    expect(formatoValor('tipo', 'cortesia')).toBe('Cortesía')
    expect(formatoValor('precio_venta', 2500)).toBe('$ 2.500')
    expect(formatoValor('stock_final', null)).toBe('—')
    expect(formatoValor('fecha', '2026-11-20')).toBe('20/11/2026')
  })

  it('una reposición borrada', () => {
    const d = describir({ ...base, tabla: 'reposiciones', accion: 'baja', cambios: { cantidad: { antes: 6, despues: null } } } as RegistroAuditoria)
    expect(d.titulo).toBe('borró una reposición')
    expect(d.cambios[0]).toEqual({ campo: 'Cantidad', antes: '6', despues: '—' })
  })
})
