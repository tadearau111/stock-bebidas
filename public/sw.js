/*
 * Service worker de HUB · Stock de Bebidas.
 *
 * Guarda la app en el dispositivo para que abra y se pueda usar sin internet:
 *  - Las pantallas (HTML) y los archivos de la app (/_next/static) se guardan al instalar.
 *  - Pantallas: primero se pide a internet; si no hay, se usa lo guardado.
 *  - Archivos de la app: llevan un código único en el nombre, así que se usan de lo guardado.
 *  - Los datos (Supabase) NO pasan por acá: los maneja la app (memoria de datos + cola de cambios).
 *
 * La versión llega en la dirección (/sw.js?v=...): cada publicación nueva instala un service worker nuevo.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE_PAGINAS = `hub-paginas-${VERSION}`
const CACHE_ARCHIVOS = 'hub-archivos' // con hash en el nombre: sirven entre versiones
const CACHE_RSC = `hub-rsc-${VERSION}`

const PAGINAS = [
  '/',
  '/login',
  '/eventos',
  '/evento',
  '/info',
  '/deposito',
  '/movimientos',
  '/caja-fuerte',
  '/tareas-semana',
  '/usuarios',
  '/historial',
  '/papelera',
  '/mas',
]
const OTROS = ['/manifest.webmanifest', '/logo-hub.png', '/logo-hub-negro.png', '/icono-192.png', '/icono-512.png', '/icon.png', '/apple-icon.png']

/** Busca los archivos de la app que usa un texto (HTML o JS). */
function archivosEn(texto) {
  const encontrados = new Set()
  for (const m of texto.matchAll(/\/_next\/static\/[^"'\s)\\]+?\.(?:js|css|woff2?|png|svg|ico)/g)) encontrados.add(m[0])
  // Dentro de los JS, los chunks a veces aparecen sin la barra inicial
  for (const m of texto.matchAll(/(?:^|["'\s(])(static\/chunks\/[\w.-]+\.(?:js|css))/g)) encontrados.add('/_next/' + m[1])
  return encontrados
}

async function guardarTodo() {
  const paginas = await caches.open(CACHE_PAGINAS)
  const archivos = await caches.open(CACHE_ARCHIVOS)
  const pendientes = new Set()

  await Promise.all(
    PAGINAS.map(async (ruta) => {
      try {
        const r = await fetch(ruta, { cache: 'no-store', credentials: 'same-origin' })
        if (!r.ok) return
        await paginas.put(ruta, r.clone())
        for (const a of archivosEn(await r.text())) pendientes.add(a)
      } catch {}
    }),
  )
  await Promise.all(OTROS.map((u) => paginas.add(u).catch(() => {})))

  // Archivos de la app (y los que esos archivos cargan después, un nivel más)
  const vistos = new Set()
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    const lote = [...pendientes].filter((a) => !vistos.has(a))
    pendientes.clear()
    await Promise.all(
      lote.map(async (a) => {
        vistos.add(a)
        try {
          let r = await archivos.match(a)
          if (!r) {
            r = await fetch(a)
            if (!r.ok) return
            await archivos.put(a, r.clone())
          }
          if (a.endsWith('.js')) for (const b of archivosEn(await r.text())) if (!vistos.has(b)) pendientes.add(b)
        } catch {}
      }),
    )
  }
  // Se anota qué archivos usa esta versión (para borrar los viejos al activarse)
  await paginas.put('/__archivos-version.json', new Response(JSON.stringify([...vistos]), { headers: { 'content-type': 'application/json' } }))
}

/** Borra los archivos de versiones anteriores que esta versión ya no usa. */
async function limpiarArchivosViejos() {
  const lista = await (await caches.open(CACHE_PAGINAS)).match('/__archivos-version.json')
  if (!lista) return
  const usados = new Set(await lista.json())
  if (usados.size < 5) return // por las dudas: si la lista quedó incompleta, no se borra nada
  const archivos = await caches.open(CACHE_ARCHIVOS)
  for (const pedido of await archivos.keys()) {
    if (!usados.has(new URL(pedido.url).pathname)) await archivos.delete(pedido)
  }
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(guardarTodo().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.filter((n) => n.startsWith('hub-') && ![CACHE_PAGINAS, CACHE_ARCHIVOS, CACHE_RSC].includes(n)).map((n) => caches.delete(n)))
      await limpiarArchivosViejos().catch(() => {})
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return // Supabase y otros: directo a internet
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return

  // Archivos de la app: de lo guardado, y si no está, de internet (y se guarda)
  if (url.pathname.startsWith('/_next/static/')) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_ARCHIVOS)
        const guardado = await cache.match(pedido)
        if (guardado) return guardado
        const r = await fetch(pedido)
        if (r.ok) cache.put(pedido, r.clone())
        return r
      })(),
    )
    return
  }

  // Datos de navegación interna de Next (RSC): internet primero, si no hay, lo guardado
  if (pedido.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_RSC)
        try {
          const r = await fetch(pedido)
          if (r.ok) cache.put(pedido, r.clone())
          return r
        } catch (e) {
          const guardado = await cache.match(pedido)
          if (guardado) return guardado
          throw e // la app hace una navegación completa y la responde la página guardada
        }
      })(),
    )
    return
  }

  // Pantallas: internet primero (con un tiempo máximo); si no hay, lo guardado
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_PAGINAS)
        try {
          const r = await Promise.race([
            fetch(pedido),
            new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lento')), 6000)),
          ])
          if (r.ok) cache.put(url.pathname, r.clone())
          return r
        } catch {
          const guardado = (await cache.match(url.pathname)) || (await cache.match(pedido, { ignoreSearch: true })) || (await cache.match('/'))
          if (guardado) return guardado
          return new Response('<h1>Sin conexión</h1><p>Abrí la app una vez con internet para poder usarla sin conexión.</p>', {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        }
      })(),
    )
    return
  }

  // Íconos, logo, manifiesto: lo guardado y se actualiza de fondo
  if (OTROS.includes(url.pathname)) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_PAGINAS)
        const guardado = await cache.match(url.pathname)
        const deInternet = fetch(pedido)
          .then((r) => {
            if (r.ok) cache.put(url.pathname, r.clone())
            return r
          })
          .catch(() => null)
        return guardado || (await deInternet) || Response.error()
      })(),
    )
  }
})

self.addEventListener('message', (evento) => {
  if (evento.data === 'actualizar') self.skipWaiting()
})
