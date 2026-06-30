/* push.js — RJ30-3 (RJ30-B). Client Web Push subscribe lifecycle.
   - Reads the VAPID PUBLIC key from window.__WC26_CONFIG__.vapidPublicKey
     (injected at build by scripts/write-runtime-config.mjs). The private key
     NEVER touches the client.
   - Gating predicates live in ./lib/pwa-install.js (shared with the install
     banner + unit-tested in push-client-gate.test.mjs); re-exported here for
     convenience so the settings card has a single import.
   - saveSubscription/deleteSubscription mirror favorites.js's authed
     Supabase write pattern (getCompetitionState().client / .user). */

import { getCompetitionState } from './competition.js';
import { getFavoriteTeam } from './favorites.js';
import {
  isPushSupported,
  canSubscribeHere as canSubscribeHereGate,
  isInstalledIOSPWA,
  isIOSSafari,
  isStandalonePWA,
  permissionState,
} from './lib/pwa-install.js';

export {
  isPushSupported,
  isInstalledIOSPWA,
  isIOSSafari,
  isStandalonePWA,
  permissionState,
};

/** The VAPID public key, read at call time so a late config injection is seen. */
export function vapidPublicKey() {
  try {
    return (typeof window !== 'undefined' && window.__WC26_CONFIG__ && window.__WC26_CONFIG__.vapidPublicKey) || '';
  } catch {
    return '';
  }
}

/** True when we can subscribe here (push APIs + a VAPID key + iOS install gate). */
export function canSubscribeHere() {
  return canSubscribeHereGate(vapidPublicKey());
}

/** Standard VAPID base64url -> Uint8Array decoder for applicationServerKey. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribe: prompt for permission (user-gesture only), subscribe via the SW,
 *  and upsert the row into push_subscriptions. Throws on permission denial or
 *  unsupported context so the UI can show the right copy. */
export async function enablePush() {
  if (!canSubscribeHere()) throw new Error('Push not available here');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission-' + perm);
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
  });
  await saveSubscription(sub);
  return sub;
}

/** Unsubscribe locally and delete the server row. Tolerant of missing state. */
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await deleteSubscription(sub.endpoint);
      try { await sub.unsubscribe(); } catch { /* already gone */ }
    }
  } catch { /* nothing to disable */ }
}

/** Is there a live push subscription on this device right now? */
export async function getStatus() {
  if (!isPushSupported()) return { supported: false, subscribed: false, permission: permissionState() };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub;
  } catch { /* ignore */ }
  return { supported: true, subscribed, permission: permissionState() };
}

/** Upsert a subscription row, mirroring favorites.js's authed write. Best-effort. */
export async function saveSubscription(sub) {
  try {
    const state = getCompetitionState?.();
    if (!state?.client || !state?.user) return;
    const json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    const keys = json.keys || {};
    const fav = getFavoriteTeam();
    const teams = fav ? [fav] : [];
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || null;
    const { error } = await state.client
      .from('push_subscriptions')
      .upsert({
        user_id: state.user.id,
        endpoint: json.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        teams,
        user_agent: ua,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,endpoint' });
    if (error) console.warn('push save failed:', error.message || error);
  } catch (e) {
    // Network / import errors are non-fatal — the subscription still exists in
    // the browser and re-syncs on next launch.
  }
}

/** Delete the server row for an endpoint (on disable / 410 prune signal). */
export async function deleteSubscription(endpoint) {
  try {
    const state = getCompetitionState?.();
    if (!state?.client || !state?.user) return;
    await state.client.from('push_subscriptions')
      .delete().eq('user_id', state.user.id).eq('endpoint', endpoint);
  } catch { /* non-fatal */ }
}

/** Patch the notify_goals / notify_kickoffs prefs on the current subscription. */
export async function updatePrefs(prefs) {
  try {
    const state = getCompetitionState?.();
    if (!state?.client || !state?.user) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const patch = { updated_at: new Date().toISOString() };
    if (typeof prefs.notify_goals === 'boolean') patch.notify_goals = prefs.notify_goals;
    if (typeof prefs.notify_kickoffs === 'boolean') patch.notify_kickoffs = prefs.notify_kickoffs;
    await state.client.from('push_subscriptions')
      .update(patch).eq('user_id', state.user.id).eq('endpoint', sub.endpoint);
  } catch { /* non-fatal */ }
}

let _resubBound = false;
/** Re-save the subscription when the SW reports a pushsubscriptionchange. */
export function bindResubscribeListener() {
  if (_resubBound || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  _resubBound = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PUSH_RESUBSCRIBED' && event.data.subscription) {
      void saveSubscription(event.data.subscription);
    }
  });
}
