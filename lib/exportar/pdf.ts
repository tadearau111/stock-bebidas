import { textoCelda, type Reporte } from './reportes'

/** Carga el logo (versión negra para papel) como data URL. Si falla, el PDF sale sin logo. */
async function logo(): Promise<string | null> {
  try {
    const r = await fetch('/logo-hub-negro.png')
    const blob = await r.blob()
    return await new Promise((ok) => {
      const lector = new FileReader()
      lector.onload = () => ok(lector.result as string)
      lector.onerror = () => ok(null)
      lector.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** Arma el PDF (A4, para imprimir o mandar). */
export async function reporteAPdf(reporte: Reporte, opciones: { logo?: string | null } = {}): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const anchoMax = Math.max(...reporte.secciones.map((s) => s.columnas.length))
  const doc = new jsPDF({ orientation: anchoMax > 7 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const margen = 14
  const imagen = opciones.logo !== undefined ? opciones.logo : await logo()

  // Encabezado
  let y = margen
  if (imagen) {
    doc.addImage(imagen, 'PNG', margen, y - 2, 10, 11.5)
  }
  const x = imagen ? margen + 14 : margen
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110)
  doc.text('HUB · Stock de Bebidas', x, y + 2)
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20)
  doc.text(reporte.titulo, x, y + 9)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90)
  doc.text(reporte.subtitulo, x, y + 15)
  y += 23

  // Datos clave
  if (reporte.datos.length) {
    autoTable(doc, {
      startY: y,
      body: reporte.datos,
      theme: 'plain',
      styles: { fontSize: 9.5, cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 4 } },
      columnStyles: { 0: { fontStyle: 'bold', textColor: 60 } },
      margin: { left: margen, right: margen },
      tableWidth: 'wrap',
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  }

  // Secciones
  for (const s of reporte.secciones) {
    if (y > alto - 40) {
      doc.addPage()
      y = margen
    }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20)
    doc.text(s.titulo, margen, y)
    y += 2
    autoTable(doc, {
      startY: y,
      head: [s.columnas.map((c) => c.titulo)],
      body: s.filas.map((f) => f.map((v, i) => textoCelda(v, s.columnas[i]?.tipo))),
      foot: s.total ? [s.total.map((v, i) => (v == null ? '' : textoCelda(v, s.columnas[i]?.tipo)))] : undefined,
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 1.6, textColor: 30, overflow: 'linebreak' },
      headStyles: { fillColor: [28, 28, 31], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [235, 235, 237], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 246, 247] },
      columnStyles: Object.fromEntries(s.columnas.map((c, i) => [i, c.tipo && c.tipo !== 'texto' ? { halign: 'right' } : {}])),
      margin: { left: margen, right: margen },
      didParseCell: (d) => {
        if (d.section === 'body' && s.resaltar?.includes(d.row.index)) {
          d.cell.styles.textColor = [198, 40, 40]
          d.cell.styles.fontStyle = 'bold'
        }
        if ((d.section === 'head' || d.section === 'foot') && s.columnas[d.column.index]?.tipo && s.columnas[d.column.index].tipo !== 'texto') {
          d.cell.styles.halign = 'right'
        }
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
    if (s.nota) {
      doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(110)
      const lineas = doc.splitTextToSize(s.nota, ancho - margen * 2)
      doc.text(lineas, margen, y + 1)
      y += lineas.length * 4
    }
    y += 6
  }

  // Pie con número de página
  const paginas = doc.getNumberOfPages()
  const generado = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date())
    .replace(/ | /g, ' ')
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130)
    doc.text(`Generado el ${generado}`, margen, alto - 8)
    doc.text(`Página ${i} de ${paginas}`, ancho - margen, alto - 8, { align: 'right' })
  }

  return doc.output('blob')
}
