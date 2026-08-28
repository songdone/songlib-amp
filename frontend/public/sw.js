const CACHE_NAME = 'songlib-amp-static-v22'
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/songlib-amp-app-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/apple-touch-icon.png',
  '/visuals/login-bg.jpg',
  '/visuals/songlib-login-bg-base.jpg',
  '/visuals/fallback-artist.svg',
  '/visuals/fallback-player.svg',
  '/visuals/fallback-cover-vinyl.svg',
]

const isMusicOrMutableRequest = request => {
  const url = new URL(request.url)
  return url.pathname.startsWith('/api/player/') ||
    url.pathname.includes('/stream') ||
    url.pathname.startsWith('/api/local/files/') ||
    url.pathname.startsWith('/api/plex/items/') ||
    url.pathname.startsWith('/api/downloads') ||
    request.destination === 'audio' ||
    request.headers.get('range')
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.registration.navigationPreload?.enable(),
  ]).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET' || isMusicOrMutableRequest(request)) return
  const url = new URL(request.url)
  const isNavigation = request.mode === 'navigate' || url.pathname.endsWith('.html')
  const isVersionedAsset = url.origin === self.location.origin && ['/assets/', '.js', '.css'].some(value => url.pathname.includes(value))
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
    return
  }
  if (isVersionedAsset) {
    event.respondWith(caches.match(request).then(cached => {
      const update = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()))
        return response
      })
      return cached || update
    }))
    return
  }
  if (isNavigation) {
    event.respondWith((event.preloadResponse || Promise.resolve()).then(preloaded => preloaded || fetch(request, { cache: 'no-store' })).then(response => {
      const copy = response.clone()
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
      return response
    }).catch(() => caches.match(request)))
    return
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    const copy = response.clone()
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
    return response
  })))
})
