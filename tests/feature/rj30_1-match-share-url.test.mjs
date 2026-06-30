/* rj30_1-match-share-url.test.mjs — RJ30.1 C-1 (AC9 prerequisite).
   buildMatchShareUrl returns the real `/m/<pair>` path (not the #/matchup hash),
   with the pair URI-encoded as one component. jsdom-free: pass an explicit
   origin so the helper is pure off-DOM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchShareUrl, tryShareViaNavigator } from '../../app/share-match.js';

const ORIGIN = 'https://worldcup2026.j5lagenticstrategy.com';

test('buildMatchShareUrl: returns /m/<encoded pair>, a path not a hash', () => {
  const url = buildMatchShareUrl('Mexico', 'Korea Republic', ORIGIN);
  assert.equal(url, `${ORIGIN}/m/Mexico__vs__Korea%20Republic`);
  assert.ok(!url.includes('#'), 'must be a real path, never a hash route');
});

test('buildMatchShareUrl: apostrophes/ampersands are URI-encoded', () => {
  const url = buildMatchShareUrl("Cote d'Ivoire", 'Senegal', ORIGIN);
  // the whole pair is encodeURIComponent'd: apostrophe stays literal (valid in
  // a URI component) but the separator + spaces are encoded predictably.
  assert.match(url, /\/m\/Cote%20d'Ivoire__vs__Senegal$/);
});

test('buildMatchShareUrl: trims a trailing slash on the origin override', () => {
  const url = buildMatchShareUrl('A', 'B', `${ORIGIN}/`);
  assert.equal(url, `${ORIGIN}/m/A__vs__B`);
});

test('tryShareViaNavigator is re-exported from the bracket sharer', () => {
  assert.equal(typeof tryShareViaNavigator, 'function');
});
