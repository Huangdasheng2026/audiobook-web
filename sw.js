const CACHE = 'audiobook-v23-' + Date.now()
const URLS = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/tts.js', '/js/parsers.js', '/js/db.js', '/manifest.json']

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(URLS).catch(() => {}))
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => !key.startsWith('audiobook-v23')).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // HTML 和根路径：网络优先，确保新代码及时加载
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then(response => {
        if (response && response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(e.request, clone)).catch(() => {})
        }
        return response
      }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    )
    return
  }

  // JS / CSS 等静态资源：网络优先，失败时回退到缓存
  if (url.pathname.match(/\.(js|css|json|svg)$/)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then(response => {
        if (response && response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(e.request, clone)).catch(() => {})
        }
        return response
      }).catch(() => caches.match(e.request))
    )
    return
  }

  // 其他资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  )
})
