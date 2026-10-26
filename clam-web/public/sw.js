const VERSION = 'clam-v1'
const CACHE = `clam-shell-${VERSION}`
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, fallback = '/') {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    const hit = await cache.match(request)
    if (hit) return hit
    return cache.match(fallback)
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/audio/')) return

  if (url.pathname === '/api/books' || url.pathname === '/__auth/me') {
    event.respondWith(networkFirst(request))
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
    event.respondWith(cacheFirst(request))
  }
})
