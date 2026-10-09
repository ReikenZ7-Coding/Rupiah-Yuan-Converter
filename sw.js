/*
 * Service worker: makes the app load offline.
 *
 * The app shell (HTML/CSS/JS/icons) is cached and served instantly, then quietly
 * refreshed from the network, so an update shows up on the next launch.
 * Exchange-rate requests go to other origins and are never touched here: the app
 * does its own fetching and keeps its own last-good-rate cache.
 *
 * Bump CACHE_VERSION when you add or rename a file in SHELL.
 */
const CACHE_VERSION = 'v1';
const CACHE = 'idr-cny-' + CACHE_VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'converter.js', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('idr-cny-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    try {
      return await network;
    } catch (err) {
      if (request.mode === 'navigate') return (await cache.match('./')) || Response.error();
      return Response.error();
    }
  })());
});
