/* public/sw.js */
const VERSION = 'rv1.0.0';
const STATIC_CACHE = `static-${VERSION}`;
const CORE_ASSETS = [
  '/',               // app shell (for SPA navigations when cached)
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== STATIC_CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Navigation requests: try network first, fall back to cache, then offline.html
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const isNavigation = req.mode === 'navigate' ||
                       (req.destination === '' && req.headers.get('accept')?.includes('text/html'));

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update cache in background
          const resClone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, resClone));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match(req)) || (await cache.match('/offline.html'));
        })
    );
    return;
  }

  // For other GET requests: cache-first, then network
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, resClone));
        return res;
      }).catch(() => cached) // last-ditch
    )
  );
});
