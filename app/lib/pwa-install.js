/* pwa-install.js — RJ30-3 (RJ30-B). Shared install/standalone/iOS predicates
   and the push capability gate. Extracted so install-prompt.js and the push
   opt-in card agree on "is this an installed iOS PWA" (the UA + standalone
   logic used to live only in install-prompt.js:11-20). Pure functions over
   window/navigator, read at CALL time (so tests can swap the global shim per
   case). No DOM, no side effects. */

/** True when the page is running as an installed/standalone PWA (either the
 *  display-mode media query or the legacy iOS navigator.standalone flag). */
export function isStandalonePWA() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch { /* matchMedia may be absent in test shims */ }
  return !!(window.navigator && window.navigator.standalone);
}

/** True for iOS Safari (iPhone/iPad/iPod) and NOT an in-app Chrome/Firefox/Edge
 *  WebView. Exact logic moved from install-prompt.js:17-20. */
export function isIOSSafari() {
  if (typeof window === 'undefined') return false;
  const ua = (window.navigator && window.navigator.userAgent) || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

/** True only when this is an installed (Add-to-Home-Screen) iOS PWA — the ONLY
 *  context where iOS Web Push works (iOS 16.4+). */
export function isInstalledIOSPWA() {
  return isIOSSafari() && isStandalonePWA();
}

/** Push API surface present? (serviceWorker + PushManager + Notification.) */
export function isPushSupported() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    typeof window.PushManager !== 'undefined' &&
    typeof window.Notification !== 'undefined'
  );
}

/** Can we subscribe to push HERE, right now?
 *  - Requires the push APIs AND a VAPID public key (passed in, or read by the
 *    caller from window.__WC26_CONFIG__).
 *  - iOS gate: on iOS Safari, push ONLY works installed — a plain tab is false.
 *  - Other platforms: supported if the APIs + a key exist. */
export function canSubscribeHere(vapidPublicKey) {
  if (!isPushSupported() || !vapidPublicKey) return false;
  if (isIOSSafari() && !isStandalonePWA()) return false;
  return true;
}

/** Current Notification permission, or 'denied' when Notification is absent. */
export function permissionState() {
  if (typeof window !== 'undefined' && typeof window.Notification !== 'undefined') {
    return window.Notification.permission;
  }
  if (typeof Notification !== 'undefined') return Notification.permission;
  return 'denied';
}
