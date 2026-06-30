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
const VERSION = 'wc26-v17';

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

// ---------------------------------------------------------------------------
// RJ30-3 (RJ30-B): Web Push. Adds push + notificationclick + pushsubscriptionchange.
// NO fetch handler is added — the no-offline contract above is preserved.
// iOS requires userVisibleOnly + a visible notification on EVERY push (silent
// pushes are banned), so every 'push' event below calls showNotification().
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'World Cup 2026', body: (event.data && event.data.text && event.data.text()) || '' };
  }
  const title = data.title || 'World Cup 2026';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'wc26',          // collapse per-match (tag = match_id)
    renotify: true,                    // a 2nd goal still alerts despite same tag
    data: { url: data.url || '/' },
    timestamp: data.ts || Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        // navigate() is missing on some WebKit versions — best-effort, fall
        // back to focus() (and openWindow if no client is open).
        try { if (c.navigate) await c.navigate(url); } catch { /* ignore */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const oldKey = event.oldSubscription
        && event.oldSubscription.options
        && event.oldSubscription.options.applicationServerKey;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: oldKey,
      });
      // Re-sync is best-effort: tell any open client to re-save the row. If no
      // client is open, the next app launch re-subscribes and re-saves anyway.
      const all = await self.clients.matchAll({ includeUncontrolled: true });
      all.forEach((c) => c.postMessage({ type: 'PUSH_RESUBSCRIBED', subscription: sub.toJSON() }));
    } catch { /* re-synced on next launch */ }
  })());
});
