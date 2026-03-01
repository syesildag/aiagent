/**
 * AI Agent Chat – Service Worker
 * Strategy:
 *  - Static assets (/static/)  → cache-first, update in background
 *  - App shell (/front/, /manifest, /icons) → network-first, fallback cache
 *  - API routes (/chat, /info, /model, /auth) → network only (no cache)
 */

const CACHE = 'aiagent-pwa-v1';

const PRECACHE_URLS = [
  '/static/vendors.js',
  '/static/main.js',
];

// ---------------------------------------------------------------------------
// Install – pre-cache core bundles
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate – clean up old caches
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Never cache API / auth / streaming routes
  const noCache = ['/chat', '/info', '/model', '/auth', '/login', '/logout', '/readyz', '/healthz'];
  if (noCache.some((p) => url.pathname.startsWith(p))) return;

  // Static bundle assets → cache-first, refresh cache in background
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else (app shell, manifest, icons) → network-first, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
