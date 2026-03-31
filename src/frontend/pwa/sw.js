/**
 * AI Agent Chat – Service Worker
 * Strategy:
 *  - Static assets (/static/)  → cache-first, update in background
 *  - App shell (/ai/, /manifest, /icons) → network-first, fallback cache
 *  - API routes (/chat, /info, /model, /auth) → network only (no cache)
 */

const CACHE = 'aiagent-pwa-v3';

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
// Activate – clean up old caches, restore scheduled notifications
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() => restoreScheduledNotifications())
  );
});

// ---------------------------------------------------------------------------
// IndexedDB helpers – persist scheduled notifications across SW restarts
// ---------------------------------------------------------------------------
const IDB_NAME = 'sw-notifications-db';
const IDB_STORE = 'notifications';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function saveNotification(n) {
  return openDb().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(n);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    })
  );
}

function deleteNotification(id) {
  return openDb().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    })
  );
}

function getAllNotifications() {
  return openDb().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    })
  );
}

// ---------------------------------------------------------------------------
// Notification scheduling
// ---------------------------------------------------------------------------
const scheduledTimeouts = new Map(); // id → timeoutHandle

function scheduleNotification(n) {
  const { id, title, body, icon, fireAt, url } = n;
  const delay = fireAt - Date.now();

  // Skip if more than 1 minute stale
  if (delay < -60_000) {
    return deleteNotification(id);
  }

  // Cancel existing handle for this id if any
  if (scheduledTimeouts.has(id)) {
    clearTimeout(scheduledTimeouts.get(id));
  }

  const handle = setTimeout(async () => {
    scheduledTimeouts.delete(id);
    await deleteNotification(id);
    await self.registration.showNotification(title, {
      body,
      icon: icon || '/static/icons/icon-192.png',
      badge: '/static/icons/icon-96.png',
      data: { url: url || '/' },
    });
    // Notify open page clients so they can update UI state
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'NOTIFICATION_FIRED', id });
    }
  }, Math.max(0, delay));

  scheduledTimeouts.set(id, handle);
  return Promise.resolve();
}

async function restoreScheduledNotifications() {
  const notifications = await getAllNotifications();
  for (const n of notifications) {
    await scheduleNotification(n);
  }
}

// ---------------------------------------------------------------------------
// Push notifications via postMessage from main thread
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  // Legacy: immediate show (kept for backwards compat)
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: icon || '/static/icons/icon-192.png',
        badge: '/static/icons/icon-96.png',
      })
    );
  }

  // Schedule a notification to fire at a specific timestamp
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    const n = event.data.notification;
    event.waitUntil(
      saveNotification(n).then(() => scheduleNotification(n))
    );
  }

  // Cancel a previously scheduled notification
  if (event.data?.type === 'CANCEL_NOTIFICATION') {
    const { id } = event.data;
    if (scheduledTimeouts.has(id)) {
      clearTimeout(scheduledTimeouts.get(id));
      scheduledTimeouts.delete(id);
    }
    event.waitUntil(deleteNotification(id));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow(targetUrl);
      }
    })
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
