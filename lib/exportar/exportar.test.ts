import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { Articulo, DetalleEvento } from '../tipos'
import { nombreHoja, reporteAExcel } from './excel'
import { reporteAPdf } from './pdf'
import { linkWhatsApp } from './compartir'
import { reporteCajaFuerteMes, reporteDeposito, reporteEvento, reporteFaltantes, slug, textoCelda } from './reportes'

const art = (nombre: string, stock: number, minimo: number, costo: number | null = null, mayorista: number | null = null, extra: Partial<Articulo> = {}): Articulo => ({
  id: slug(nombre),
  local_id: 'l',
  nombre,
  marca: null,
  tamano: null,
  unidad: 'unidad',
  stock_minimo: minimo,
  precio_costo: costo,
  precio_mayorista: mayorista,
  activo: true,
  creado_en: '',
  actualizado_en: '',
  stock_actual: stock,
  bajo_minimo: stock < minimo,
  faltante: Math.max(minimo - stock, 0),
  cantidad_movimientos: 1,
  ...extra,
})

const articulos = [art('Coca Cola', 18, 24, 1, 2), art('Hielo', 37, 10, null, null, { unidad: 'bolsa' }), art('Fernet', 0, 6, 9000, 30000), art('Viejo', 5, 0, null, null, { activo: false })]
const ahora = new Date('2026-11-16T15:00:00-03:00')

describe('Reporte de depósito', () => {
  const r = reporteDeposito(articulos, 'Salón principal', ahora)
  it('incluye solo artículos activos, ordenados', () => {
    expect(r.secciones[0].filas.map((f) => f[0])).toEqual(['Coca Cola', 'Fernet', 'Hielo'])
  })
  it('marca en rojo los que están bajo mínimo', () => {
    expect(r.secciones[0].resaltar).toEqual([0, 1])
  })
  it('calcula el stock valorizado a costo', () => {
    expect(r.datos.find((d) => d[0] === 'Stock valorizado a costo')?.[1]).toBe('$ 18,00')
  })
  it('arma el texto para WhatsApp', () => {
    expect(r.textoWhatsApp).toContain('🔴 Coca Cola: 18 u.')
    expect(r.textoWhatsApp).toContain('Hielo: 37 bolsas')
  })
  it('nombre de archivo con fecha', () => {
    expect(r.nombreArchivo).toBe('deposito-2026-11-16')
  })
})

describe('Lista de faltantes', () => {
  it('lista lo que hay que comprar, primero lo que más falta (a igual cantidad, por nombre)', () => {
    const r = reporteFaltantes([...articulos, art('Agua', 9, 10)], 'Salón principal', ahora)
    expect(r.secciones[0].filas.map((f) => [f[0], f[5]])).toEqual([
      ['Coca Cola', 6],
      ['Fernet', 6],
      ['Agua', 1],
    ])
    expect(r.datos.find((d) => d[0] === 'Costo estimado de la compra')?.[1]).toBe('$ 54.006,00')
    expect(r.textoWhatsApp).toContain('• Fernet: comprar *6* u. (hay 0)')
  })
  it('si no falta nada lo dice', () => {
    const r = reporteFaltantes([art('Coca', 30, 10)], 'Salón', ahora)
    expect(r.textoWhatsApp).toContain('No hay artículos por debajo del mínimo')
  })
})

const detalle: DetalleEvento = {
  evento: { id: 'e', local_id: 'l', fecha: '2026-11-20', nombre: 'Casamiento García', personas: 100, notas: null, creado_en: '', tipo_barra: 'propia', archivado: false, archivado_en: null },
  barras: [
    { id: 'b1', evento_id: 'e', nombre: 'Barra 1', orden: 1 },
    { id: 'b2', evento_id: 'e', nombre: 'Barra VIP', orden: 2 },
  ],
  lineas: [
    { id: 'l1', barra_id: 'b1', articulo_id: 'coca-cola', stock_inicial: 12, stock_final: 2, articulo: { nombre: 'Coca Cola', unidad: 'unidad', marca: null, tamano: null }, reposiciones: [] },
    { id: 'l2', barra_id: 'b2', articulo_id: 'coca-cola', stock_inicial: 5, stock_final: 0, articulo: { nombre: 'Coca Cola', unidad: 'unidad', marca: null, tamano: null }, reposiciones: [{ id: 'r', barra_articulo_id: 'l2', tipo: 'detalle', cantidad: 5, hora: '2026-11-21T01:00:00Z' }] },
  ],
  retiros: [
    { id: 'x', barra_id: 'b1', articulo_id: 'coca-cola', trago_id: null, tipo: 'personal', cantidad: 2, retirado_por: 'Juan', hora: '2026-11-21T02:00:00Z', articulo: { nombre: 'Coca Cola', unidad: 'unidad' } },
    { id: 'y', barra_id: 'b1', articulo_id: null, trago_id: 't', tipo: 'cortesia', cantidad: 3, retirado_por: 'Mesa 1', hora: '2026-11-21T02:10:00Z', trago: { nombre: 'Trago Absolut' } },
  ],
  bebidaAbierta: [
    { id: 'a1', articulo_id: 'fernet', cuartos: 2, hora: '', articulo: { nombre: 'Fernet' } },
    { id: 'a2', articulo_id: 'fernet', cuartos: 2, hora: '', articulo: { nombre: 'Fernet' } },
  ],
  caja: null,
  gastos: [],
}

describe('Resumen de evento', () => {
  it('con costos: tiene consumo, barras, retiros, tragos, bebida abierta y costos', () => {
    const r = reporteEvento(detalle, articulos, { incluirCostos: true })
    expect(r.secciones.map((s) => s.titulo)).toEqual(['Consumo total por artículo', 'Barra 1', 'Barra VIP', 'Retiros de personal', 'Cortesías', 'Tragos y vasos retirados', 'Bebida abierta', 'Costos'])
    // cortesía de trago: cuenta en el detalle y en el total
    const cort = r.secciones.find((s) => s.titulo === 'Cortesías')!
    expect(cort.filas).toEqual([['Mesa 1', 'Trago Absolut', 3, 'vasos', 'Barra 1', expect.any(String)]])
    expect(cort.total?.[0]).toBe('Total: 1 retiro')
    expect(cort.total?.[3]).toBe('3 vasos')
    expect(r.datos.find((d) => d[0] === 'Cortesías')?.[1]).toBe('1 (3 vasos)')
    expect(r.datos.find((d) => d[0] === 'Retiros de personal')?.[1]).toBe('1 (2 u.)')
    expect(r.textoWhatsApp).toContain('• Mesa 1: Trago Absolut 3 vasos')
    expect(r.textoWhatsApp).toContain('• Juan: Coca Cola 2 u.')
    // Coca: barra 1 consumió 10, VIP 10 → 20; personal 2 → venta 18
    expect(r.secciones[0].filas[0]).toEqual(['Coca Cola', 20, 2, 0, 18, 0.2])
    // Cada barra muestra de dónde sale el total: consumido x precio (barra propia → costo)
    const barra1 = r.secciones.find((s) => s.titulo === 'Barra 1')!
    expect(barra1.columnas.map((c) => c.titulo)).toEqual(['Artículo', 'Stock inicial', 'Reposiciones', 'Stock final', 'Consumido', 'Precio costo', 'Total'])
    expect(barra1.filas[0]).toEqual(['Coca Cola', 12, 0, 2, 10, 1, 10])
    expect(barra1.total).toEqual(['Total Barra 1', null, null, null, null, null, 10])
    const vip = r.secciones.find((s) => s.titulo === 'Barra VIP')!
    expect(vip.filas[0]).toEqual(['Coca Cola', 5, 5, 0, 10, 1, 10])
    // Costos: resumen por barra y total general
    const costos = r.secciones.find((s) => s.titulo === 'Costos')!
    expect(costos.filas).toEqual([
      ['Barra 1', 10],
      ['Barra VIP', 10],
    ])
    expect(costos.total).toEqual(['Total general', 20])
    expect(r.datos.find((d) => d[0] === 'Tipo de barra')?.[1]).toBe('Barra propia (precio costo)')
    expect(r.textoWhatsApp).toContain('*Total a precio costo:* $ 20,00')
    expect(r.nombreArchivo).toBe('evento-casamiento-garcia-2026-11-20')
  })
  it('barra concesionada: calcula con precio mayorista', () => {
    const r = reporteEvento({ ...detalle, evento: { ...detalle.evento, tipo_barra: 'concesionada' } }, articulos, { incluirCostos: true })
    const barra1 = r.secciones.find((s) => s.titulo === 'Barra 1')!
    expect(barra1.columnas[5].titulo).toBe('Precio mayorista')
    expect(barra1.filas[0]).toEqual(['Coca Cola', 12, 0, 2, 10, 2, 20])
    expect(r.secciones.find((s) => s.titulo === 'Costos')!.total).toEqual(['Total general', 40])
    expect(r.textoWhatsApp).toContain('*Total a precio mayorista:* $ 40,00')
  })
  it('sin costos (para quien no gestiona eventos) no muestra precios', () => {
    const r = reporteEvento(detalle, articulos, { incluirCostos: false })
    expect(r.secciones.some((s) => s.titulo === 'Costos')).toBe(false)
    expect(r.secciones.find((s) => s.titulo === 'Barra 1')!.columnas.map((c) => c.titulo)).toEqual(['Artículo', 'Stock inicial', 'Reposiciones', 'Stock final', 'Consumido'])
    expect(r.textoWhatsApp).not.toContain('$')
    expect(r.datos.some((d) => d[0].includes('precio'))).toBe(false)
  })
})

describe('Archivos', () => {
  it('genera un Excel válido con una hoja por sección', async () => {
    const r = reporteEvento(detalle, articulos, { incluirCostos: true })
    const blob = await reporteAExcel(r)
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(await blob.arrayBuffer())
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Consumo total por artículo', 'Barra 1', 'Barra VIP', 'Retiros de personal', 'Cortesías', 'Tragos y vasos retirados', 'Bebida abierta', 'Costos'])
    const consumo = libro.getWorksheet('Consumo total por artículo')!
    expect(consumo.getRow(2).getCell(1).value).toBe('Coca Cola')
    expect(consumo.getRow(2).getCell(2).value).toBe(20) // número real, no texto
  })
  it('genera un PDF', async () => {
    const blob = await reporteAPdf(reporteDeposito(articulos, 'Salón', ahora), { logo: null })
    const inicio = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))
    expect(inicio).toBe('%PDF-')
    expect(blob.size).toBeGreaterThan(1000)
  })
  it('nombres de hoja válidos y únicos', () => {
    const usados = new Set<string>()
    expect(nombreHoja('Barra 1', usados)).toBe('Barra 1')
    expect(nombreHoja('Barra 1', usados)).toBe('Barra 1 (2)')
    expect(nombreHoja('Barra: VIP/Terraza [nueva]', usados)).toBe('Barra  VIP Terraza  nueva')
    expect(nombreHoja('x'.repeat(40), usados)).toHaveLength(31)
  })
})

describe('WhatsApp y formatos', () => {
  it('arma el link con el texto codificado', () => {
    expect(linkWhatsApp('Hola *mundo*')).toBe('https://wa.me/?text=Hola%20*mundo*')
  })
  it('formatea celdas', () => {
    expect(textoCelda(1500.5, 'pesos')).toBe('$ 1.500,50')
    expect(textoCelda(null)).toBe('—')
    expect(textoCelda(0.25, 'numero')).toBe('0,25')
  })
})

describe('Caja en el resumen del evento', () => {
  const conCaja: DetalleEvento = {
    ...detalle,
    caja: {
      evento_id: 'e', notas: null, actualizado_en: '', actualizado_por: null,
      efectivo_real: 100000, efectivo_sistema: 102000, cierre_lotes: 250000, tarjetas_sistema: 250000,
      boleteria_efectivo: 40000, boleteria_lotes: 60000, guardarropas_efectivo: 8000, guardarropas_lotes: 2000,
      cambio_proxima_caja: 20000, vasos_no_devueltos: 4,
    },
    gastos: [{ id: 'g', evento_id: 'e', monto: 5000, detalle: 'Hielo de emergencia', hora: '2026-11-21T03:00:00Z' }],
  }
  it('agrega la caja y los gastos, también para encargados', () => {
    const r = reporteEvento(conCaja, articulos, { incluirCostos: false })
    const caja = r.secciones.find((s) => s.titulo === 'Caja')!
    expect(caja.filas.find((f) => f[0] === 'Barras · Diferencia efectivo')?.[1]).toBe(-2000)
    expect(caja.filas.find((f) => f[0] === 'RETIRO A CAJA FUERTE')?.[1]).toBe(148000 - 5000 - 20000)
    expect(caja.total).toEqual(['VENTA TOTAL + BOLETERÍA + GUARDARROPAS', 460000])
    expect(caja.resaltar).toEqual([2]) // falta efectivo
    expect(caja.nota).toContain('Vasos no devueltos: 4')
    expect(r.secciones.find((s) => s.titulo === 'Gastos de la noche')!.total).toEqual(['Total gastos', 5000, null])
    expect(r.textoWhatsApp).toContain('*Retiro a caja fuerte:* $ 123.000,00')
  })
  it('si no se cargó nada de caja, no aparece', () => {
    const r = reporteEvento(detalle, articulos, { incluirCostos: true })
    expect(r.secciones.some((s) => s.titulo === 'Caja')).toBe(false)
  })
})

describe('Resumen mensual de caja fuerte', () => {
  it('arma el resumen y los movimientos del mes', () => {
    const r = reporteCajaFuerteMes(
      {
        anio: 2026, mes: 11, saldo_inicial: 0, efectivo: 148000, gastos: 8500, retiros: 0, ingresos: 50000, saldo_final: 189500,
        renglones: [
          { clase: 'ingreso', fecha: '2026-11-01T10:00:00', titulo: 'Ingreso', detalle: 'Saldo inicial', monto: 50000, saldo: 50000, evento_id: null },
          { clase: 'efectivo', fecha: '2026-11-14', titulo: 'Efectivo real', detalle: 'Casamiento', monto: 148000, saldo: 198000, evento_id: 'e' },
          { clase: 'gastos', fecha: '2026-11-14', titulo: 'Gastos', detalle: 'Casamiento', monto: -8500, saldo: 189500, evento_id: 'e', items: [{ detalle: 'Hielo de emergencia', monto: 5000 }, { detalle: 'Propina DJ', monto: 3500 }] },
        ],
      },
      'Salón',
      'Cerrado',
    )
    expect(r.titulo).toBe('Caja fuerte · Noviembre 2026')
    expect(r.secciones[0].total).toEqual(['= Saldo al cierre del mes', 189500])
    expect(r.secciones[1].filas[1]).toEqual(['14/11/2026', 'Efectivo real', 'Casamiento', 148000, 198000])
    expect(r.secciones[1].resaltar).toEqual([2])
    expect(r.textoWhatsApp).toContain('*Saldo al cierre: $ 189.500,00*')
    expect(r.nombreArchivo).toBe('caja-fuerte-2026-11')
    const det = r.secciones.find((s) => s.titulo === 'Detalle de gastos')!
    expect(det.filas).toEqual([
      ['14/11/2026', 'Casamiento', 'Hielo de emergencia', 5000],
      ['14/11/2026', 'Casamiento', 'Propina DJ', 3500],
    ])
    expect(r.textoWhatsApp).toContain('• Casamiento: Hielo de emergencia $ 5.000,00')
  })
})
