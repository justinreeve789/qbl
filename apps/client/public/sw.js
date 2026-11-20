/**
 * QuestLab's service worker. It makes the site installable as an app and keeps it from showing
 * the browser's own "no connection" page, and nothing more: the game is multiplayer and needs the
 * server, so it does not try to play offline.
 *
 *   /assets/*    Vite's content-hashed bundles: from the cache when there, else the network (and
 *                kept). A name never changes content, so a cached copy is never stale.
 *   pages        always the network; with no connection, offline.html (which retries by itself).
 *   the rest     not touched: the API, the multiplayer socket, uploaded media, scenario assets,
 *                the editor and the docs go straight to the network as if there were no worker.
 *
 * Change VERSION when the files in SHELL change, so installed copies fetch them again.
 */
const VERSION = 'qbl-pwa-1';
const SHELL = `${VERSION}-shell`;
const ASSETS = 'qbl-assets';
const SHELL_FILES = ['/offline.html', '/icons/icon-192.png', '/icons/favicon-32.png'];
// The bundles of a few builds back are plenty; older ones are dropped.
const MAX_ASSETS = 80;
const PASS_THROUGH = /^\/(api|game|media|scenario-assets|editor|docs)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || PASS_THROUGH.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html', { cacheName: SHELL })));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(fromCacheOrNetwork(request));
  }
});

async function fromCacheOrNetwork(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}
