/* ═══════════════════════════════════════════════════════
   ISAGI'S DASHBOARD — sw.js
   Service Worker for offline support (Cache-first strategy).
═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'isagi-dashboard-v1';

// All files to pre-cache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ─── INSTALL: cache all core assets ─── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Add origins we can, skip failures (e.g. missing icons)
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(() => { /* icon may not exist yet — that's ok */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE: delete old caches ─── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── FETCH: cache-first, fallback to network ─── */
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin or same-scope URLs
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (fonts, etc.) — let them go through normally
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Not in cache: fetch from network and cache for next time
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        return response;
      }).catch(() => {
        // Offline fallback: return index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
