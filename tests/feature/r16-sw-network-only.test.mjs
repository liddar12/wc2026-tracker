import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R16 Phase 3: the service worker must no longer provide offline/file caching.
const sw = readFileSync('sw.js', 'utf8');
const vp = readFileSync('app/lib/version-purge.js', 'utf8');

test('R16 #SW1: SW + APP_VERSION are both wc26-v16 (lockstep)', () => {
  assert.match(sw, /const VERSION = 'wc26-v16'/, 'sw.js VERSION must be wc26-v16');
  assert.match(vp, /APP_VERSION = 'wc26-v16'/, 'APP_VERSION must be wc26-v16');
});

test('R16 #SW2: no precache and no fetch caching (network-only)', () => {
  assert.doesNotMatch(sw, /addAll/, 'must not precache a shell');
  assert.doesNotMatch(sw, /SHELL_ASSETS\s*=/, 'must not declare a precache list');
  assert.doesNotMatch(sw, /cacheFirst|networkFirst|staleWhileRevalidate/, 'no cache strategies');
  assert.doesNotMatch(sw, /addEventListener\(\s*['"]fetch/, 'no fetch handler → all requests hit the network');
});

test('R16 #SW3: activate purges previously-created caches', () => {
  assert.match(sw, /caches\.delete/, 'must delete old caches on activate');
  assert.match(sw, /caches\.keys\(\)/, 'must enumerate caches to purge them');
});

test('R16 #SW4: SW stays registered (no self-unregister rollout)', () => {
  const idx = readFileSync('index.html', 'utf8');
  assert.match(idx, /serviceWorker\.register\('sw\.js'\)/, 'index.html still registers the SW');
  assert.doesNotMatch(sw, /unregister\(/, 'SW must not self-unregister (kept reversible)');
});
