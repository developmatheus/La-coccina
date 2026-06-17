const CACHE_NAME = 'lc-local-service-v1';
const APP_SHELL = [
  '/local-service.html',
  '/ASSETS/js/config.js',
  '/ASSETS/js/security.js',
  '/ASSETS/imagens/local-service.webmanifest',
  '/ASSETS/imagens/android-chrome-192x192.png',
  '/ASSETS/imagens/android-chrome-512x512.png',
  '/ASSETS/imagens/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/local-service.html', cloned));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return cache.match('/local-service.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      });
    })
  );
});
