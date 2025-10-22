/* public/sw.js */
const VERSION = 'app-shell-v1';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const SHELL_URLS = [
  '/',              // your SPA entry
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil((async () => {
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    const keep = new Set([SHELL, RUNTIME]);
    const names = await caches.keys();
    await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

const isHttp = (u) => { try { return new URL(u).protocol.startsWith('http'); } catch { return false; } };
const sameOrigin = (u) => { try { return new URL(u).origin === self.location.origin; } catch { return false; } };

self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;

  const url = req.url;
  if (!isHttp(url) || !sameOrigin(url)) return;

  // ✅ Navigations → App Shell (index.html), even when offline
  if (req.mode === 'navigate') {
    evt.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        // Try preload / network, keep cache fresh
        const preload = 'navigationPreload' in self.registration ? await evt.preloadResponse : null;
        const net = preload || await fetch(req);
        cache.put('/index.html', net.clone());
        return net;
      } catch {
        const cached = await cache.match('/index.html');
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Cache-first for same-origin static assets
  const p = new URL(url).pathname;
  const isStatic = p.startsWith('/assets/') || /\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(p);

  if (isStatic) {
    evt.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
        return resp;
      } catch {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Default: network-first for other same-origin GETs
  evt.respondWith((async () => {
    try { return await fetch(req); }
    catch {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      return cached || new Response('Offline', { status: 408 });
    }
  })());
});
