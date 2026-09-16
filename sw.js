const CACHE_NAME = 'geop-shell-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './geop.png',
  './js/config.js',
  './js/storage.js',
  './js/auth.js',
  './js/events.js',
  './js/signatories.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin static requests; allow Supabase, OneSignal, and CDN queries to bypass
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((res) => res || fetch(event.request))
    );
  }
});
