/* Service worker.
 *
 * Bumping VERSION is the entire deploy ritual. Nothing else.
 *
 * Deliberately does NOT call skipWaiting() on install: that swaps assets
 * underneath a running page and you end up with half-old JS against half-new
 * JSON. The page shows an update pill instead and asks for the swap.
 */

const VERSION = 'v1.1.0';
const CACHE = `aiquiz-${VERSION}`;

// All relative. This app is served from a GitHub Pages subpath, so a leading
// slash would resolve to the domain root and 404.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/app.js',
  './js/bank.js',
  './js/chrome.js',
  './js/mathtext.js',
  './js/quiz.js',
  './js/router.js',
  './js/share.js',
  './js/store.js',
  './js/sync.js',
  './js/ui.js',
  './data/index.json',
  './data/week-01.json',
  './data/week-02.json',
  './data/week-03.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Add individually: one 404 must not fail the whole install.
    await Promise.all(PRECACHE.map(async url => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] precache miss', url, err);
      }
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // version.json is the one file that must always be fresh.
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      // Offline and uncached: a navigation still gets the app shell.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
