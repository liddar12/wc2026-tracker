import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import ogHandler from '../../netlify/functions/share-card.mjs';

test('R17 OG: branded card asset exists, is a JPEG, and is reasonably sized', () => {
  const buf = readFileSync('assets/og/share-card.jpg');
  // JPEG magic bytes FF D8 ... FF D9
  assert.equal(buf[0], 0xff, 'JPEG SOI byte 0');
  assert.equal(buf[1], 0xd8, 'JPEG SOI byte 1');
  const kb = statSync('assets/og/share-card.jpg').size / 1024;
  assert.ok(kb < 300, `OG card should be < 300KB (got ${kb.toFixed(0)}KB)`);
});

test('R17 OG: share-card function points og:image at the branded card with dimensions', async () => {
  const req = new Request('https://worldcup2026.j5lagenticstrategy.com/.netlify/functions/share-card?token=abc');
  const res = await ogHandler(req);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /og:image" content="[^"]*\/assets\/og\/share-card\.jpg"/, 'og:image → branded card');
  assert.match(body, /twitter:image" content="[^"]*\/assets\/og\/share-card\.jpg"/, 'twitter:image → branded card');
  assert.match(body, /og:image:width" content="1200"/);
  assert.match(body, /og:image:height" content="630"/);
  assert.match(body, /twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(body, /icons\/icon-512\.png/, 'no longer the app-icon fallback');
});
