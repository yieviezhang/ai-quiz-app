/* Service worker.
 *
 * Bumping VERSION is the entire deploy ritual. Nothing else.
 *
 * Deliberately does NOT call skipWaiting() on install: that swaps assets
 * underneath a running page and you end up with half-old JS against half-new
 * JSON. The page shows an update pill instead and asks for the swap.
 */

const VERSION = 'v1.1.1';

// Managed by tools/bank.py -- do not edit by hand. It lives in this file, not
// only in version.json, because sw.js is fetched with updateViaCache:'none'
// and the browser only notices a new worker when these bytes change. A bank
// update that left sw.js untouched would serve the old questions forever.
const BANK = 2;

const CACHE = `aiquiz-${VERSION}-b${BANK}`;

// All relative. This app is served from a GitHub Pages subpath, so a leading
// slash would resolve to the domain root and 404.
//
// Week files are deliberately absent: they are read from data/index.json at
// install time, so adding a week stays a data-only change.
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
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/** Authored week files, read from the bank index rather than hardcoded. */
async function weekFiles() {
  try {
    const res = await fetch('./data/index.json', { cache: 'reload' });
    if (!res.ok) throw new Error(String(res.status));
    const index = await res.json();
    return (index.weeks || []).map(w => w.file).filter(Boolean);
  } catch (err) {
    // Not fatal: the fetch handler still caches week files on first use.
    console.warn('[sw] bank index unavailable at install', err);
    return [];
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = [...PRECACHE, ...await weekFiles()];
    // Add individually: one 404 must not fail the whole install.
    await Promise.all(urls.map(async url => {
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
