// Aschertype Service Worker
// Caches the app shell for offline use. Does NOT cache Supabase API calls,
// auth responses, or anything user-specific.

const VERSION = 'v22'; // lazy hcaptcha, persistent guest mode
const CACHE_NAME = `aschertype-${VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/theme-init.js',
  '/vendor/supabase.min.js',
  '/supabase-config.js',
  '/utils.js',
  '/ai-config.js',
  '/ai-bridge.js',
  '/i18n.js',
  '/language.json',
  '/db.js',
  '/renderer.js',
  '/auth.js',
  '/confirm.html',
  '/confirm.js',
  '/favicon.png',
  '/manifest.json',
];

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

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co')) return;
  if (url.pathname.startsWith('/auth') || url.pathname.includes('auth-token')) return;

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
});