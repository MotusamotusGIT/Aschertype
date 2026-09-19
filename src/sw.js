// Aschertype Service Worker
// Caches the app shell for offline use. Does NOT cache Supabase API calls,
// auth responses, or anything user-specific.

const VERSION = 'v2';
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
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
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
  const url = new URL(request.url);

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
          // Cache a fresh copy of the shell on every successful navigation.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 5. For same-origin static assets: cache-first, network fallback.
  //    Only cache successful (ok) same-origin responses — a 404 or an
  //    error response must never be pinned in the cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // 6. Everything else (cross-origin, non-Supabase): network only, no cache.
  //    This prevents third-party assets from being cached and served stale.
});