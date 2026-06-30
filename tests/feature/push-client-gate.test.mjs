/* push-client-gate.test.mjs — RJ30-3 (RJ30-B). The iOS-install gate logic in
   app/lib/pwa-install.js (canSubscribeHere / isInstalledIOSPWA / isPushSupported).
   These are pure predicates over window/navigator; we hand-roll a global shim
   per case (jsdom is not in the stack), matching the existing pure-logic tests. */
import test from 'node:test';
import assert from 'node:assert/strict';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

// Node 24 exposes a getter-only (but configurable) global `navigator`, so a
// plain `global.navigator = …` throws under ESM strict mode. defineGlobal swaps
// it via Object.defineProperty, which the configurable descriptor allows.
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

function setEnv({ ua = IOS_UA, standalone = false, hasNotification = true, hasPushManager = true, hasSW = true } = {}) {
  const matchMedia = (q) => ({
    matches: typeof q === 'string' && q.includes('display-mode: standalone') ? standalone : false,
    media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  const nav = {
    userAgent: ua,
    standalone,
  };
  if (hasSW) nav.serviceWorker = { ready: Promise.resolve({}) };
  defineGlobal('navigator', nav);
  global.window = {
    matchMedia,
    navigator: global.navigator,
  };
  if (hasPushManager) global.window.PushManager = function PushManager() {};
  if (hasNotification) {
    global.window.Notification = { permission: 'default', requestPermission: async () => 'granted' };
    global.Notification = global.window.Notification;
  } else {
    delete global.window.Notification;
    delete global.Notification;
  }
  // mirror PushManager onto global for `'PushManager' in window` checks via window
}

function clearEnv() {
  delete global.window;
  delete global.navigator;
  delete global.Notification;
}

// Fresh import each case (the module reads window at call time, not import time,
// so a single import is fine — but we re-set the env before each call).
const mod = await import('../../app/lib/pwa-install.js');

test('isStandalonePWA: false in a normal tab, true when display-mode standalone', () => {
  setEnv({ standalone: false });
  assert.equal(mod.isStandalonePWA(), false);
  setEnv({ standalone: true });
  assert.equal(mod.isStandalonePWA(), true);
  clearEnv();
});

test('isIOSSafari: true for iPhone Safari UA, false for desktop', () => {
  setEnv({ ua: IOS_UA });
  assert.equal(mod.isIOSSafari(), true);
  setEnv({ ua: DESKTOP_UA });
  assert.equal(mod.isIOSSafari(), false);
  clearEnv();
});

test('isInstalledIOSPWA: only true when iOS Safari AND standalone', () => {
  setEnv({ ua: IOS_UA, standalone: false });
  assert.equal(mod.isInstalledIOSPWA(), false);
  setEnv({ ua: IOS_UA, standalone: true });
  assert.equal(mod.isInstalledIOSPWA(), true);
  setEnv({ ua: DESKTOP_UA, standalone: true });
  assert.equal(mod.isInstalledIOSPWA(), false);
  clearEnv();
});

test('isPushSupported: false when Notification is absent (graceful)', () => {
  setEnv({ hasNotification: false });
  assert.equal(mod.isPushSupported(), false);
  clearEnv();
});

test('isPushSupported: true when serviceWorker + PushManager + Notification all present', () => {
  setEnv({});
  assert.equal(mod.isPushSupported(), true);
  clearEnv();
});

test('canSubscribeHere: iOS Safari TAB (not standalone) is gated to false', () => {
  setEnv({ ua: IOS_UA, standalone: false });
  assert.equal(mod.canSubscribeHere('a-vapid-key'), false);
  clearEnv();
});

test('canSubscribeHere: installed iOS PWA with a VAPID key is true', () => {
  setEnv({ ua: IOS_UA, standalone: true });
  assert.equal(mod.canSubscribeHere('a-vapid-key'), true);
  clearEnv();
});

test('canSubscribeHere: desktop with APIs + VAPID key is true', () => {
  setEnv({ ua: DESKTOP_UA, standalone: false });
  assert.equal(mod.canSubscribeHere('a-vapid-key'), true);
  clearEnv();
});

test('canSubscribeHere: false without a VAPID key even on a supported platform', () => {
  setEnv({ ua: DESKTOP_UA });
  assert.equal(mod.canSubscribeHere(''), false);
  clearEnv();
});

test('permissionState: returns the Notification.permission, or denied when unavailable', () => {
  setEnv({ hasNotification: true });
  global.Notification.permission = 'granted';
  assert.equal(mod.permissionState(), 'granted');
  clearEnv();
  assert.equal(mod.permissionState(), 'denied');
});
