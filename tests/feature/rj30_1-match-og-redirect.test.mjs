/* rj30_1-match-og-redirect.test.mjs — RJ30.1 C-1.
   Locks the no-JS safety net (AC3) and the netlify.toml redirect-ordering
   invariant: /m/* MUST be declared before the SPA catch-all /*. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../../netlify/functions/match-card.mjs';

const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async (u) => {
    const m = String(u).match(/\/data\/([\w.-]+)$/);
    if (!m) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`data/${m[1]}`, 'utf8')) };
  };
});
test.after(() => { globalThis.fetch = realFetch; });

test('AC3 + edge: no-JS fallbacks present and cache-control short', async () => {
  const req = new Request(
    'https://worldcup2026.j5lagenticstrategy.com/.netlify/functions/match-card?pair=Mexico__vs__Korea%20Republic',
  );
  const res = await handler(req);
  const body = await res.text();
  assert.match(body, /<meta http-equiv="refresh" content="0; url=[^"]*#\/matchup\//);
  assert.match(body, /<script>location\.replace\(/);
  assert.match(body, /<a [^>]*href="[^"]*#\/matchup\/[^"]*"[^>]*>/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
});

test('netlify.toml: /m/* redirect is declared BEFORE the /* catch-all', () => {
  const toml = readFileSync('netlify.toml', 'utf8');
  const idxM = toml.indexOf('from = "/m/*"');
  const idxCatchAll = toml.indexOf('from = "/*"');
  assert.ok(idxM >= 0, '/m/* redirect must exist in netlify.toml');
  assert.ok(idxCatchAll >= 0, '/* catch-all must exist in netlify.toml');
  assert.ok(idxM < idxCatchAll, '/m/* must precede the /* catch-all (load-bearing ordering)');
  // points at the match-card function with the pair splat
  assert.match(toml, /from = "\/m\/\*"[\s\S]*?to = "\/\.netlify\/functions\/match-card\?pair=:splat"/);
});
