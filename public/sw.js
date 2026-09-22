// COSOM service worker v8.4
// Important: application code is intentionally NOT cached.
// The app is online-first and Firebase Hosting serves index/app/styles with no-store.
// This prevents old PWA caches from mixing releases after frequent deployments.
const CACHE = 'cosom-static-v8.4';
const STATIC = [
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__')) return;

  // Never intercept navigations or application files. They always come from Hosting.
  if (request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname === '/index.html' ||
      url.pathname === '/app.js' ||
      url.pathname === '/styles.css' ||
      url.pathname === '/sw.js' ||
      url.pathname === '/manifest.webmanifest') {
    return;
  }

  // Only immutable app icons get an offline cache.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
