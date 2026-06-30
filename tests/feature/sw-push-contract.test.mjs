/* sw-push-contract.test.mjs — RJ30-3 (RJ30-B). The service worker must gain
   push + notificationclick + pushsubscriptionchange handlers WITHOUT ever
   adding a fetch handler (the no-offline contract from CLAUDE.md / r16). Also
   re-asserts the r14-version-sync invariant locally so a push bump can't drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sw = fs.readFileSync('sw.js', 'utf8');

test('sw.js registers a push handler', () => {
  assert.ok(/addEventListener\(\s*['"]push['"]/.test(sw), 'push listener present');
});

test('sw.js registers a notificationclick handler', () => {
  assert.ok(/addEventListener\(\s*['"]notificationclick['"]/.test(sw), 'notificationclick listener present');
});

test('sw.js registers a pushsubscriptionchange handler', () => {
  assert.ok(/addEventListener\(\s*['"]pushsubscriptionchange['"]/.test(sw), 'pushsubscriptionchange listener present');
});

test('sw.js does NOT register a fetch handler (no-offline contract preserved)', () => {
  assert.ok(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'NO fetch handler may be added');
});

test('sw.js push handler calls showNotification (iOS bans silent push)', () => {
  assert.ok(/showNotification\(/.test(sw), 'every push must show a notification');
});

test('sw.js VERSION still matches version-purge APP_VERSION (lockstep bump)', () => {
  const vp = fs.readFileSync('app/lib/version-purge.js', 'utf8');
  const swV = sw.match(/const VERSION = '([^']+)'/);
  const appV = vp.match(/APP_VERSION = '([^']+)'/);
  assert.ok(swV && appV);
  assert.equal(appV[1], swV[1], `version drift: APP_VERSION=${appV?.[1]} vs SW VERSION=${swV?.[1]}`);
});
