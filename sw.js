/*
 * Service worker: makes the app work with no connection at all.
 *
 * Everything the app needs is precached on install, jsPDF included — it's served from this repo
 * rather than a CDN precisely so there is nothing left to fetch at runtime. Once installed, the
 * whole thing runs from the plant floor with no signal.
 *
 * CACHE is versioned: bump it whenever a precached file changes, or browsers will keep serving
 * the old copy. Old caches are deleted on activate.
 */
const VERSION = '11';
const CACHE = 'local200forms-v' + VERSION;

/* Must match the ?v= in index.html — bump both together, or the worker will keep serving the
   previous build from cache. */
const SHELL = [
  './',
  './index.html',
  './style.css?v=' + VERSION,
  './script.js?v=' + VERSION,
  './forms.config.js',
  './unifor-logo.js',
  './jspdf.umd.min.js',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one bad URL can't fail the whole install and leave the app uncached
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // nothing cross-origin is needed

  /*
   * Navigations go to the network first so a new deploy is picked up straight away, falling
   * back to the cached page when offline. Cache-first here would pin people to an old build
   * until the cache version changed.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  // Everything else is versioned by filename or ?v=, so serving it from cache is safe and fast
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
