import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('R14: version-purge APP_VERSION matches sw.js VERSION (must bump together)', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const vp = fs.readFileSync('app/lib/version-purge.js', 'utf8');
  const swV = sw.match(/const VERSION = '([^']+)'/);
  const appV = vp.match(/APP_VERSION = '([^']+)'/);
  assert.ok(swV, 'sw.js VERSION not found');
  assert.ok(appV, 'version-purge APP_VERSION not found');
  assert.equal(appV[1], swV[1], `version drift: APP_VERSION=${appV[1]} vs SW VERSION=${swV[1]}`);
});

test('R14: parseHash empty/unknown defaults to home, not matchups', async () => {
  const { parseHash } = await import('../../app/state.js');
  assert.equal(parseHash('').view, 'home');
  assert.equal(parseHash('#').view, 'home');
  assert.equal(parseHash('#/').view, 'home');
  // legacy matchups still routable
  assert.equal(parseHash('#/matchups').view, 'matchups');
});
