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
const VERSION = '58';
const CACHE = 'local200forms-v' + VERSION;

/* Must match the ?v= in index.html — bump both together, or the worker will keep serving the
   previous build from cache. */
const SHELL = [
  './',
  './index.html',
  './style.css?v=' + VERSION,
  './script.js?v=' + VERSION,
  './annotate.js?v=' + VERSION,
  './forms.config.js',
  './unifor-logo.js',
  './jspdf.umd.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf-lib.min.js',
  './vendor/pdf.worker.min.mjs',
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
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

const SHARE_CACHE = 'local200forms-share';

/*
 * Android hands a shared file over as a POST to ./share, which is a URL nothing serves — this
 * worker is what answers it. The file is parked in a cache and the browser is sent on to the
 * app, which collects it on the way in. A redirect rather than a rendered response, so the
 * share URL doesn't stay in the address bar.
 */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const file = form.get('file');

    if (file && file.name) {
      await cache.put('shared-file', new Response(file, {
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-shared-name': encodeURIComponent(file.name),
        },
      }));
      return Response.redirect('./?shared=file', 303);
    }

    /*
     * Sharing text rather than a file is the more likely half of this: copying a grievance in
     * another app puts JSON on the clipboard, and its share sheet sends that as text with no
     * file attached. Handling only files meant those shares arrived and vanished.
     */
    const text = [form.get('text'), form.get('url'), form.get('title')]
      .map(v => (typeof v === 'string' ? v.trim() : ''))
      .find(v => v);
    if (text) {
      await cache.put('shared-file', new Response(text, {
        headers: { 'content-type': 'text/plain' },
      }));
      return Response.redirect('./?shared=text', 303);
    }
  } catch (err) {
    /* fall through and just open the app */
  }
  return Response.redirect('./', 303);
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/share')) {
    event.respondWith(receiveShare(request));
    return;
  }
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
