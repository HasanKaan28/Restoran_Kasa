// Keeps Restoran Kasa opening without a network. The page registers this file with its version
// and build (sw.js?v=1.0.0&b=3f2a9c1d0b7e), so each deploy installs a new worker with its own
// cache (rk-1.0.0+3f2a9c1d0b7e) and drops the last, even a deploy that kept the version.
// Market Kasa lives on the same site and keeps its caches beside ours (mk2-…): this worker names,
// reads and clears only its own rk-… caches, never theirs.
const PARAMS = new URL(self.location.href).searchParams;
const VERSION = [PARAMS.get('v') || 'dev', PARAMS.get('b')].filter(Boolean).join('+');
const CACHE = `rk-${VERSION}`;
// The page and what it names outside the build: its icon, the manifest and the manifest's icons.
const STATIC_FILES = [
  './manifest.json',
  './logo.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];
const SHELL = ['./', './index.html', ...STATIC_FILES];
/** Where each of those files lives, by path, for the fetch handler. */
const STATIC_URLS = new Map(
  STATIC_FILES.map((path) => {
    const url = new URL(path, self.location.href);
    return [url.pathname, url.href];
  }),
);
// The built files the page names: the first visit loads them before this worker is in charge.
const ASSET_REFERENCE = /(?:src|href)="(\.?\/?assets\/[^"]+)"/g;

/**
 * Keeps the page, its icon and every built file: the build lists them in precache.json (the
 * camera's scanner and the fonts load later, so the page does not name them). Without that list,
 * the files the page names.
 */
async function cacheShell() {
  const cache = await caches.open(CACHE);
  const page = await fetch('./index.html', { cache: 'no-store' });
  const html = await page.clone().text();
  const named = [...html.matchAll(ASSET_REFERENCE)].map((match) => match[1]);
  const listed = await fetch('./precache.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : []))
    .catch(() => []);
  const assets = [
    ...new Set([
      ...named.map((path) => new URL(path, self.location.href).href),
      ...listed.map((path) => new URL(path, self.location.href).href),
    ]),
  ];
  await cache.addAll([...SHELL.filter((path) => path !== './index.html'), ...assets]);
  await cache.put('./index.html', page);
}

/** An HTML page, as the host serves the app and the menu. */
function isPage(response) {
  return (response.headers.get('content-type') || '').toLowerCase().startsWith('text/html');
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('rk-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  // The seller's yönetim page needs the network anyway and is no register's: the browser loads it
  // as it is, and it never takes the place of the app's kept copy.
  if (request.mode === 'navigate' && /\/yonetim(\.html|\/|\/index\.html)?$/.test(url.pathname)) {
    return;
  }
  if (request.mode === 'navigate') {
    // The guests' QR menu (menu.html) is a page of its own under the same scope: it is kept
    // apart, so opening it never replaces the app's kept copy, nor does offline open the app.
    const page = url.pathname.endsWith('/menu.html') ? './menu.html' : './index.html';
    // The page first from the network, so a new release is seen; the kept copy when offline.
    // Only a page is kept: a link to the manifest or a built file opened in the tab is shown as
    // it is, and never takes the place of the app's copy.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && isPage(response)) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(page, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .open(CACHE)
            .then((cache) => cache.match(page))
            .then((cached) => cached || Response.error()),
        ),
    );
    return;
  }
  const kept = STATIC_URLS.get(url.pathname);
  if (kept) {
    // The icon, the manifest and its icons: each deploy keeps its own copy, so the kept one is
    // right, and the tab, the header and the home screen show them offline too.
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(kept).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) {
                void cache.put(kept, response.clone());
              }
              return response;
            }),
        ),
      ),
    );
    return;
  }
  if (url.pathname.includes('/assets/')) {
    // Built files carry a hash in their name: a kept copy is always the right one.
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) {
                void cache.put(request, response.clone());
              }
              return response;
            }),
        ),
      ),
    );
  }
});

// A tapped "Masa 5 hazır" notification (src/notify/system.ts): brings the app forward and asks
// it to open that tab; with no window of the app open, opens one at the tab's address.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tabId = event.notification.data && event.notification.data.tabId;
  const address = typeof tabId === 'string' ? `./#/tables/${tabId}` : './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const app = windows.find((client) => !/\/(menu|yonetim)\.html/.test(client.url));
      if (app) {
        if (typeof tabId === 'string') {
          app.postMessage({ type: 'rk-open-tab', tabId });
        }
        return app.focus();
      }
      return self.clients.openWindow(new URL(address, self.location.href).href);
    }),
  );
});
