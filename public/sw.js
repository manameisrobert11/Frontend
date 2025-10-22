/* public/sw.js */
const VERSION = 'v6';
const RUNTIME = `runtime-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(ASSETS).then((c) => c.addAll([OFFLINE_URL])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil((async () => {
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    const keep = new Set([ASSETS, RUNTIME]);
    const names = await caches.keys();
    await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

function isHttp(url) {
  try { return new URL(url).protocol.startsWith('http'); } catch { return false; }
}
function sameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

self.addEventListener('fetch', (evt) => {
  const req = evt.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const urlStr = req.url;
  const url = new URL(urlStr);

  // Ignore non-http(s) (e.g. chrome-extension://) and cross-origin
  if (!isHttp(urlStr) || !sameOrigin(urlStr)) return;

  // 1) Navigations: network → preload → offline fallback
  if (req.mode === 'navigate') {
    evt.respondWith((async () => {
      try {
        const preload = 'navigationPreload' in self.registration ? await evt.preloadResponse : null;
        if (preload) return preload;
        const net = await fetch(req);
        return net;
      } catch {
        const cache = await caches.open(ASSETS);
        const offline = await cache.match(OFFLINE_URL);
        return offline || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // 2) Static same-origin assets: cache-first (safe cache.put only on OK/basic responses)
  const isLikelyStatic =
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(url.pathname);

  if (isLikelyStatic) {
    evt.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const resp = await fetch(req);
        if (resp && resp.ok && resp.type === 'basic') {
          cache.put(req, resp.clone());
        }
        return resp;
      } catch {
        // return something valid even on failure
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // 3) Everything else same-origin GET: network-first (no caching)
  evt.respondWith((async () => {
    try {
      return await fetch(req);
    } catch {
      // If it was cached earlier somehow, serve it; else a small fallback
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      return new Response('Network error', { status: 408 });
    }
  })());
});
