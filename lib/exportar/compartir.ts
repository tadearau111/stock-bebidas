// Descargar archivos y compartir por WhatsApp.

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Link de WhatsApp con el texto ya escrito (el usuario elige a quién mandarlo). */
export function linkWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`
}

export type ResultadoCompartir = 'compartido' | 'cancelado' | 'link'

/**
 * En el celular: abre el menú de compartir con el archivo (se elige WhatsApp).
 * Si el dispositivo no puede compartir archivos (ej: computadora), abre
 * WhatsApp con un resumen en texto.
 */
export async function compartirPorWhatsApp(blob: Blob, nombre: string, texto: string): Promise<ResultadoCompartir> {
  const archivo = new File([blob], nombre, { type: blob.type })
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav?.canShare?.({ files: [archivo] })) {
    try {
      await nav.share({ files: [archivo], title: nombre, text: texto })
      return 'compartido'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelado'
      // si falla por otro motivo, seguimos con el link
    }
  }
  window.open(linkWhatsApp(texto), '_blank', 'noopener')
  return 'link'
}
