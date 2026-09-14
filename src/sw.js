// This service worker intentionally caches NOTHING. It only exists so
// the app can still register as an installable PWA — every request is
// left alone and goes straight to the network, so you always get
// whatever is actually deployed instead of a stale cached copy.
//
// activate() also wipes out any caches a previous version of this
// service worker created (aschertype-v6, v7, etc.), so old cached
// files left over on a user's device get cleared out once too.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// No fetch handler logic — every request just goes to the network as
// if there were no service worker in the loop at all.
self.addEventListener('fetch', () => {});