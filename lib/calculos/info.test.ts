import { describe, expect, it } from 'vitest'
import { agruparNotas, limpiarPersonal, personalInicial, personalParaEditar, semanaDe, totalPersonal } from './info'

describe('Semanas', () => {
  it('la semana va de lunes a domingo', () => {
    // miércoles 18/11/2026
    expect(semanaDe(new Date(2026, 10, 18))).toEqual({ desde: '2026-11-16', hasta: '2026-11-22' })
  })
  it('un domingo pertenece a la semana que termina ese día', () => {
    expect(semanaDe(new Date(2026, 10, 22))).toEqual({ desde: '2026-11-16', hasta: '2026-11-22' })
  })
  it('un lunes empieza semana nueva', () => {
    expect(semanaDe(new Date(2026, 10, 23))).toEqual({ desde: '2026-11-23', hasta: '2026-11-29' })
  })
})

describe('Agrupar notas', () => {
  const notas = [{ fecha: '2026-11-21' }, { fecha: '2026-11-30' }, { fecha: '2026-11-17' }, { fecha: '2026-11-10' }, { fecha: '2026-12-05' }]
  const g = agruparNotas(notas, new Date(2026, 10, 18))
  it('esta semana, ordenadas por fecha', () => {
    expect(g.semana.map((n) => n.fecha)).toEqual(['2026-11-17', '2026-11-21'])
  })
  it('próximas, de la más cercana a la más lejana', () => {
    expect(g.proximas.map((n) => n.fecha)).toEqual(['2026-11-30', '2026-12-05'])
  })
  it('pasadas, de la más reciente a la más vieja', () => {
    expect(g.pasadas.map((n) => n.fecha)).toEqual(['2026-11-10'])
  })
})

describe('Personal a convocar', () => {
  it('trae los roles de siempre', () => {
    expect(personalInicial().map((p) => p.rol)).toEqual(['Seguridad', 'Limpieza', 'Bartenders', 'Cajeros', 'Técnico'])
  })
  it('al guardar saca los roles vacíos y suma el total', () => {
    const lista = personalInicial()
    lista[0] = { rol: 'Seguridad', cantidad: 4, detalle: ' 2 en puerta ' }
    lista[2] = { rol: 'Bartenders', cantidad: 6, detalle: '' }
    lista.push({ rol: 'DJ', cantidad: null, detalle: 'Llega 22 hs' })
    const limpio = limpiarPersonal(lista)
    expect(limpio).toEqual([
      { rol: 'Seguridad', cantidad: 4, detalle: '2 en puerta' },
      { rol: 'Bartenders', cantidad: 6, detalle: '' },
      { rol: 'DJ', cantidad: null, detalle: 'Llega 22 hs' },
    ])
    expect(totalPersonal(limpio)).toBe(10)
  })
  it('al editar vuelve a mostrar todos los roles más los extra', () => {
    const p = personalParaEditar([{ rol: 'Limpieza', cantidad: 2, detalle: '' }, { rol: 'DJ', cantidad: 1, detalle: '' }])
    expect(p.map((x) => [x.rol, x.cantidad])).toEqual([
      ['Seguridad', null],
      ['Limpieza', 2],
      ['Bartenders', null],
      ['Cajeros', null],
      ['Técnico', null],
      ['DJ', 1],
    ])
  })
})
