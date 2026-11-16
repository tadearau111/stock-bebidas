import type { Reporte, Seccion } from './reportes'

const FORMATO_PESOS = '"$" #,##0.00'
const FORMATO_NUMERO = '#,##0.##'

/** Nombre de hoja válido para Excel (máx. 31 caracteres, sin caracteres prohibidos, único). */
export function nombreHoja(titulo: string, usados: Set<string>): string {
  const base = titulo.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Hoja'
  let nombre = base
  let i = 2
  while (usados.has(nombre.toLowerCase())) {
    const sufijo = ` (${i++})`
    nombre = base.slice(0, 31 - sufijo.length) + sufijo
  }
  usados.add(nombre.toLowerCase())
  return nombre
}

/** Arma el archivo .xlsx: una hoja "Resumen" con los datos clave y una hoja por sección. */
export async function reporteAExcel(reporte: Reporte): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const libro = new ExcelJS.Workbook()
  libro.creator = 'HUB · Stock de Bebidas'
  libro.created = new Date()
  const usados = new Set<string>()

  // Hoja de resumen
  const hoja = libro.addWorksheet(nombreHoja('Resumen', usados))
  hoja.getColumn(1).width = 32
  hoja.getColumn(2).width = 40
  hoja.addRow([reporte.titulo]).font = { bold: true, size: 16 }
  hoja.addRow([reporte.subtitulo]).font = { color: { argb: 'FF666666' } }
  hoja.addRow([])
  for (const [k, v] of reporte.datos) {
    const fila = hoja.addRow([k, v])
    fila.getCell(1).font = { bold: true }
  }
  hoja.addRow([])
  hoja.addRow(['Detalle en las hojas: ' + reporte.secciones.map((s) => s.titulo).join(', ')]).font = { italic: true, color: { argb: 'FF666666' } }

  for (const s of reporte.secciones) agregarSeccion(libro.addWorksheet(nombreHoja(s.titulo, usados)), s)

  const buffer = await libro.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

type Hoja = import('exceljs').Worksheet

function agregarSeccion(hoja: Hoja, s: Seccion) {
  hoja.columns = s.columnas.map((c, i) => ({
    header: c.titulo,
    key: String(i),
    width: Math.max(c.titulo.length + 4, i === 0 ? 26 : c.tipo === 'pesos' ? 16 : 12, ...s.filas.map((f) => String(f[i] ?? '').length + 2)),
    style: c.tipo === 'pesos' ? { numFmt: FORMATO_PESOS } : c.tipo === 'numero' ? { numFmt: FORMATO_NUMERO } : {},
  }))
  const cabecera = hoja.getRow(1)
  cabecera.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cabecera.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1C1F' } }
  cabecera.alignment = { vertical: 'middle' }
  hoja.views = [{ state: 'frozen', ySplit: 1 }]

  s.filas.forEach((f, i) => {
    const fila = hoja.addRow(f.map((v) => (v === null ? '' : v)))
    if (s.resaltar?.includes(i)) fila.font = { color: { argb: 'FFC62828' }, bold: true }
  })
  if (s.total) {
    const fila = hoja.addRow(s.total.map((v) => (v === null ? '' : v)))
    fila.font = { bold: true }
    fila.border = { top: { style: 'thin' } }
  }
  if (s.nota) {
    hoja.addRow([])
    hoja.addRow([s.nota]).font = { italic: true, color: { argb: 'FF666666' } }
  }
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columnas.length } }
}
