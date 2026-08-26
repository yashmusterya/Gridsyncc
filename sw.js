// GridSync service worker.
//
// Deliberately conservative: it caches the app shell (HTML/CSS/JS/icons) so the
// app opens instantly and degrades to a readable offline screen, but it NEVER
// caches /api/* responses. Charger availability, grid load and dynamic pricing
// are the whole point of this app - serving a stale cached copy of any of them
// would show a driver a charger that is actually occupied or broken.

const CACHE_VERSION = 'gridsync-v2';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.webmanifest',
    '/favicon.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/offline.html'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            // addAll rejects the whole install if any single entry 404s, so add
            // them individually and tolerate misses.
            .then(cache => Promise.all(
                APP_SHELL.map(url => cache.add(url).catch(() => null))
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never intercept API traffic or cross-origin requests (Google Maps,
    // Open Charge Map, fonts): always straight to the network.
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;

    // Navigations: network-first so a deploy is picked up immediately, with the
    // cached shell (then a dedicated offline page) as the fallback.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(c => c.put('/index.html', copy)).catch(() => {});
                    return response;
                })
                .catch(() => caches.match('/index.html').then(r => r || caches.match('/offline.html')))
        );
        return;
    }

    // Static assets: cache-first, refreshed in the background.
    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request).then(response => {
                if (response && response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(c => c.put(request, copy)).catch(() => {});
                }
                return response;
            }).catch(() => cached);

            return cached || network;
        })
    );
});
