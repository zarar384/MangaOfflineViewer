// по изменению FILES_TO_CACHE - поменяй версию CACHE_NAME для очистки старого кэша
const CACHE_NAME = 'manga-viewer-v0.008';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/script.js',
  '/worker.js',
  '/styles.css',
  '/logo.png',
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
