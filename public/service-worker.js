// по изменению FILES_TO_CACHE - поменяй версию CACHE_NAME для очистки старого кэша
const urlParams = new URLSearchParams(location.search);
const CACHE_NAME = urlParams.get('cacheName') || 'default-cache';
const FILES_TO_CACHE = [
  '/',
  '/index.html', 
  '/service-worker.js',
  '/assets/*.css',
  '/assets/*.png',
  '/assets/*.js',
];

// service worker и кэширование статик файлов
self.addEventListener('install', (event) => {
  self.skipWaiting(); // активация при старте
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

// чистка старого кэша при создании нового service worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  return self.clients.claim();
});

// найден запрос -> берем из кеша
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
