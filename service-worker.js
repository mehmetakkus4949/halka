// v2: önbellek stratejisi "cache-first"ten "network-first"e çevrildi.
// Sebep: cache-first, her güncelleme sonrası kullanıcılara eski (bozuk) sürümü
// göstermeye devam ediyordu. Artık önce ağdan taze sürüm denenir, sadece
// çevrimdışıyken önbellekteki sürüme düşülür.
const CACHE_NAME = 'cember-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // API isteklerine hiç dokunma — her zaman doğrudan ağa gitsin, önbelleğe alınmasın.
  if (url.includes('/api/')) return;

  // Her şey için: önce ağdan dene (her zaman taze sürüm), başarısız olursa
  // (çevrimdışı vs.) önbellekteki son bilinen sürümü göster.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
