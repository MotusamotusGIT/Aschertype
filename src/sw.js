const CACHE_NAME = 'aschertype-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/renderer.js',
  '/supabase-config.js',
  '/db.js',
  '/auth.js',
  '/manifest.json',
  '/favicon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: 'reload' })).catch((err) => {
            console.warn(`[SW] Failed to cache asset: ${asset}`, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never intercept external API calls (Supabase, Quotes, external assets)
  if (
    event.request.url.includes('supabase.co') ||
    event.request.url.includes('quotable.io') ||
    event.request.url.includes('api.quotable.io')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => networkResponse)
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html') || caches.match('/');
          }
          return new Response('', { status: 408, statusText: 'Request Timed Out' });
        });
    })
  );
});