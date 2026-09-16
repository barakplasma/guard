/**
 * A stand-in for the app's workbox precache, doing the one thing that matters
 * for ADR 011: can the solver's WebAssembly assets be served with the network
 * gone?
 *
 * Deliberately crude - cache everything on install, serve cache-first. The app
 * uses `vite-plugin-pwa`, which does this properly; the question here is
 * whether 5.2MB of `.wasm` and `.data` survives the round trip at all, not
 * whether this particular service worker is good.
 */
const CACHE = 'rota-probe-v1';
const ASSETS = [
  './',
  './minizinc.mjs',
  './minizinc-worker.js',
  './minizinc.wasm',
  './minizinc.data',
  './rota.mzn',
  './instance.dzn',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
