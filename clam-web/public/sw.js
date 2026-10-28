const VERSION = 'clam-v4'
const CACHE = `clam-shell-${VERSION}`
const PRIVATE_CACHE = `clam-private-${VERSION}`
let privateEpoch = 0

async function clearPrivate() {
  privateEpoch += 1
  await caches.delete(PRIVATE_CACHE)
}
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/theme-init.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('clam-') && key !== CACHE && key !== PRIVATE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, fallback = '/', isPrivate = false) {
  const epoch = privateEpoch
  const cache = await caches.open(isPrivate ? PRIVATE_CACHE : CACHE)
  try {
    const response = await fetch(request)
    const pathname = new URL(request.url).pathname
    let signedOut = response.status === 401
    if (pathname === '/__auth/me' && response.ok) {
      const session = await response.clone().json()
      signedOut = !session.signedIn
    }
    if (isPrivate && signedOut) await clearPrivate()
    else if (response.ok && (!isPrivate || epoch === privateEpoch)) await cache.put(request, response.clone())
    return response
  } catch {
    if (isPrivate && epoch !== privateEpoch) return Response.error()
    const hit = await cache.match(request)
    if (hit) {
      if (new URL(request.url).pathname === '/__auth/me') {
        const session = await hit.clone().json()
        if (!session.signedIn || !(Number(session.expires) > Date.now() / 1000)) {
          await clearPrivate()
          return Response.json({ signedIn: false, username: null })
        }
      }
      return hit
    }
    if (isPrivate) return Response.json({ error: 'Unavailable offline' }, { status: 503 })
    return cache.match(fallback)
  }
}

async function cacheFirst(request, isPrivate = false) {
  const epoch = privateEpoch
  const cache = await caches.open(isPrivate ? PRIVATE_CACHE : CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && (!isPrivate || epoch === privateEpoch)) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.method === 'POST' && (url.pathname === '/__auth/logout' || url.pathname === '/__auth/login')) {
    event.respondWith((async () => {
      await clearPrivate().catch(() => {})
      return fetch(request)
    })())
    return
  }
  if (request.method !== 'GET') return
  if (url.pathname.startsWith('/audio/')) return

  if (url.pathname === '/api/books' || url.pathname === '/__auth/me' || url.pathname.startsWith('/subtitle/')) {
    event.respondWith(networkFirst(request, '/', true))
    return
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__auth/')) return
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'))
    return
  }
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/cover/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/theme-init.js'
  ) {
    event.respondWith(cacheFirst(request, url.pathname.startsWith('/cover/')))
  }
})
