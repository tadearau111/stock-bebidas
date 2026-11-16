'use client'

import { useEffect, useState } from 'react'
import { Aviso, Boton, cx } from '@/components/ui'
import { compartirPorWhatsApp, descargar } from '@/lib/exportar/compartir'
import type { Reporte } from '@/lib/exportar/reportes'

type Formato = 'excel' | 'pdf' | 'whatsapp'

async function generar(reporte: Reporte, formato: 'excel' | 'pdf') {
  if (formato === 'excel') {
    const { reporteAExcel } = await import('@/lib/exportar/excel')
    return { blob: await reporteAExcel(reporte), nombre: `${reporte.nombreArchivo}.xlsx` }
  }
  const { reporteAPdf } = await import('@/lib/exportar/pdf')
  return { blob: await reporteAPdf(reporte), nombre: `${reporte.nombreArchivo}.pdf` }
}

/**
 * Botones "Excel", "PDF" y "WhatsApp" para un reporte.
 * `crear` arma el reporte en el momento (con los datos ya cargados en pantalla).
 */
export function BotonesExportar({ crear, compacto, className }: { crear: () => Reporte | null; compacto?: boolean; className?: string }) {
  const [ocupado, setOcupado] = useState<Formato | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok' | 'info'; texto: string } | null>(null)
  // Si el celular no dejó abrir "compartir" (tardó mucho en armar el archivo), se ofrece un segundo toque
  const [pendiente, setPendiente] = useState<{ blob: Blob; nombre: string; texto: string } | null>(null)

  // Precarga las librerías para que el archivo salga rápido
  useEffect(() => {
    const t = setTimeout(() => {
      import('@/lib/exportar/pdf').catch(() => {})
      import('@/lib/exportar/excel').catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [])

  const avisar = (tipo: 'error' | 'ok' | 'info', texto: string) => {
    setAviso({ tipo, texto })
    setTimeout(() => setAviso(null), 7000)
  }

  async function exportar(formato: Formato) {
    const reporte = crear()
    if (!reporte) return
    setAviso(null)
    setPendiente(null)
    setOcupado(formato)
    try {
      if (formato !== 'whatsapp') {
        const { blob, nombre } = await generar(reporte, formato)
        descargar(blob, nombre)
        avisar('ok', `Se descargó ${nombre}`)
        return
      }
      const { blob, nombre } = await generar(reporte, 'pdf')
      await enviar(blob, nombre, reporte.textoWhatsApp)
    } catch (e) {
      avisar('error', 'No se pudo generar el archivo: ' + (e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  async function enviar(blob: Blob, nombre: string, texto: string) {
    try {
      const r = await compartirPorWhatsApp(blob, nombre, texto)
      if (r === 'link') {
        // En la computadora: se abre WhatsApp con el resumen y se descarga el PDF para adjuntarlo
        descargar(blob, nombre)
        avisar('info', `Se abrió WhatsApp con el resumen y se descargó ${nombre} por si querés adjuntarlo.`)
      }
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError') setPendiente({ blob, nombre, texto })
      else throw e
    }
  }

  const boton = (f: Formato, texto: string) => (
    <Boton
      variante={f === 'whatsapp' ? 'primario' : 'secundario'}
      className={cx(compacto && 'min-h-9 px-3 text-xs')}
      onClick={() => exportar(f)}
      cargando={ocupado === f}
      textoCargando="Generando…"
      disabled={!!ocupado}
    >
      {texto}
    </Boton>
  )

  return (
    <div className={cx('space-y-2', className)}>
      <div className="flex flex-wrap gap-2">
        {boton('excel', 'Excel')}
        {boton('pdf', 'PDF')}
        {boton('whatsapp', 'Enviar por WhatsApp')}
      </div>
      {pendiente && (
        <Boton
          className="w-full"
          onClick={async () => {
            const p = pendiente
            setPendiente(null)
            await enviar(p.blob, p.nombre, p.texto)
          }}
        >
          El archivo está listo: tocá para enviarlo
        </Boton>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}
