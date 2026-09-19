// Aschertype Service Worker
// Caches the app shell for offline use. Does NOT cache Supabase API calls,
// auth responses, or anything user-specific.

const VERSION = 'v7'; // bump this on every deploy that changes cached files
const CACHE_NAME = `aschertype-${VERSION}`;

// The app shell — everything needed to boot the app offline.
// Do NOT include sw.js itself.
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/loader.js',
  '/supabase-config.js',
  '/utils.js',
  '/db.js',
  '/renderer.js',
  '/auth.js',
  '/confirm.html',
  '/confirm.js',
  '/favicon.png',
  '/manifest.json',
];

// ---------- install: pre-cache the app shell ----------
// Cache each file individually so one missing/failed asset doesn't
// abort the whole install (cache.addAll is all-or-nothing and throws
// on the first 404, which was leaving the SW in a broken state).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_SHELL.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((response) => {
              if (response && response.ok) {
                return cache.put(url, response);
              }
              console.warn('[SW] Skipped caching (bad response):', url, response && response.status);
            })
            .catch((err) => {
              console.warn('[SW] Skipped caching (fetch failed):', url, err.message);
            })
        )
      ).then(() => self.skipWaiting())
    )
  );
});

// ---------- activate: delete old caches, take control ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ---------- fetch: route requests ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return; // malformed request URL — let the browser handle it normally
  }

  // 1. Never intercept non-GET requests (POST/PUT/DELETE always go to network).
  if (request.method !== 'GET') return;

  // 2. Never cache Supabase API calls or Realtime WebSocket connections.
  //    These are user-specific and must always be fresh.
  if (url.hostname.endsWith('supabase.co')) return;

  // 3. Never cache auth-related paths on your own origin.
  if (url.pathname.startsWith('/auth') || url.pathname.includes('auth-token')) return;

  // 4. For navigation requests (HTML pages): network-first, fall back to
  //    cached index.html so the app boots offline instead of showing
  //    the browser's "no internet" page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put('/index.html', copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // 5. For same-origin static assets: cache-first, network fallback.
  //    Only cache successful (ok) same-origin responses — a 404 or an
  //    error response must never be pinned in the cache. Any failure
  //    along the way falls through to a plain network fetch rather
  //    than throwing, so a caching hiccup never breaks the request.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, copy))
                .catch(() => {});
            }
            return response;
          });
        })
        .catch(() => fetch(request))
    );
    return;
  }

  // 6. Everything else (cross-origin, non-Supabase): network only, no cache.
  //    This prevents third-party assets from being cached and served stale.
});