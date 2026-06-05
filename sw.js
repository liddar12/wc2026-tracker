/* WC26 Tracker service worker.
 *
 * R16 (Phase 3): OFFLINE / FILE CACHING REMOVED.
 *   - The SW no longer precaches any asset and does NOT intercept fetches, so
 *     every request goes to the network (no offline boot, no stale shell).
 *   - It stays REGISTERED (reversible — re-add caching here later if wanted).
 *   - `activate` deletes ALL previously-created caches (the wc26-v15-* shell +
 *     data caches that used to enable offline), so existing installs stop
 *     serving cached files on their next visit.
 *
 * Keep VERSION in sync with app/lib/version-purge.js APP_VERSION (the
 * r14-version-sync test enforces this).
 */
const VERSION = 'wc26-v16';

self.addEventListener('install', () => {
  // No precache. Take over immediately so the no-cache behaviour applies on the
  // next navigation rather than waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purge every cache this app ever created — nothing should be served
    // offline anymore.
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('wc26-')).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ type: 'VERSION', version: VERSION });
  }
});

// NOTE: intentionally NO 'fetch' handler. Without one the service worker does
// not control any request, so all fetches hit the network directly. This is
// what removes offline usage.
