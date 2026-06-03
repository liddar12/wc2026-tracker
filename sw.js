/* WC26 Tracker service worker.
 *
 * Strategy:
 *   - App shell HTML/JS/CSS: NETWORK-FIRST with cache fallback. This ensures
 *     code changes deployed to main propagate on next visit (still works
 *     offline via the cache fallback).
 *   - Icons: cache-first (they rarely change).
 *   - /data/*.json: stale-while-revalidate (fast UI, fresh data in background).
 *
 * Bump VERSION whenever shell behaviour changes; the activate handler purges
 * any cache that doesn't match the current VERSION prefix so stale shell
 * assets are evicted automatically.
 */
const VERSION = 'wc26-v13';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'app/main.js',
  'app/data-loader.js',
  'app/state.js',
  'app/markets.js',
  'app/pull-to-refresh.js',
  'app/predictions.js',
  'app/ref-bias.js',
  'app/theme.js',
  'app/styles.css',
  'app/views/matchup-list.js',
  'app/views/matchup-detail.js',
  'app/views/group-view.js',
  'app/views/bracket-view.js',
  'app/views/my-picks.js',
  'app/views/team-detail.js',
  'app/views/schedule-view.js',
  'app/views/venues-view.js',
  'app/views/venue-detail.js',
  'app/views/winner-view.js',
  'app/components/matchup-card.js',
  'app/components/confidence-bar.js',
  'app/components/market-bar.js',
  'app/components/market-odds.js',
  'app/components/model-market-divergence.js',
  'app/components/biggest-movers.js',
  'app/components/what-changed.js',
  'app/components/watchlist-star.js',
  'app/components/search-overlay.js',
  'app/components/skeleton.js',
  'app/components/sparkline.js',
  'app/components/tooltip.js',
  'app/components/upset-badge.js',
  'app/components/team-flag.js',
  'app/components/venues-map.svg.js',
  'app/components/when-where-watch.js',
  'app/components/lineups.js',
  'app/components/referee.js',
  'app/components/h2h.js',
  'app/components/form.js',
  'app/components/scorers.js',
  'app/components/weather.js',
  'app/components/travel-rest.js',
  'app/components/xg.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'assets/wc26/trionda-header-64.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_ASSETS.map((p) => new Request(p, { cache: 'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ type: 'VERSION', version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }

  if (url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  const isShell =
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json');
  if (isShell) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req) || await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await caches.match('index.html') || await caches.match('./');
      if (shell) return shell;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}
