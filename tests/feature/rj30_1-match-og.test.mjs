/* rj30_1-match-og.test.mjs — RJ30.1 C-1 primary contract.
   Drives the match-card Netlify function with Request objects. Hermetic: stubs
   globalThis.fetch to serve the committed JSON from disk, so the resolver logic
   runs against real data shapes with no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, {
  parsePair,
  formatKickoff,
  resolveMatchServer,
  describeMatch,
} from '../../netlify/functions/match-card.mjs';

const realFetch = globalThis.fetch;
function stubFetch() {
  globalThis.fetch = async (u) => {
    const m = String(u).match(/\/data\/([\w.-]+)$/);
    if (!m) return { ok: false, status: 404, json: async () => ({}) };
    const body = readFileSync(`data/${m[1]}`, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
}
test.before(stubFetch);
test.after(() => { globalThis.fetch = realFetch; });

function reqFor(pair) {
  return new Request(
    `https://worldcup2026.j5lagenticstrategy.com/.netlify/functions/match-card?pair=${encodeURIComponent(pair)}`,
  );
}

// ---- pure helpers (no fetch) -------------------------------------------------

test('parsePair: splits on the LAST __vs__ and decodes both sides', () => {
  assert.deepEqual(parsePair('Mexico__vs__Korea%20Republic'),
    { a: 'Mexico', b: 'Korea Republic' });
  // last-separator defensiveness
  assert.deepEqual(parsePair('A__vs__B__vs__C'), { a: 'A__vs__B', b: 'C' });
  // missing separator → all into a, b empty
  assert.deepEqual(parsePair('LoneTeam'), { a: 'LoneTeam', b: '' });
});

test('formatKickoff: valid ISO formats to UTC, invalid/missing → empty string', () => {
  assert.equal(formatKickoff('2026-06-19T01:00:00Z'), 'Fri Jun 19, 01:00 UTC');
  assert.equal(formatKickoff(null), '');
  assert.equal(formatKickoff(''), '');
  assert.equal(formatKickoff('not-a-date'), '');
});

test('describeMatch: missing kickoff omits the clause, no Invalid Date', () => {
  const { desc } = describeMatch({
    a: 'Mexico', b: 'Korea Republic',
    match: { predicted_winner: 'Mexico', win_confidence_pct: 55, match_id: 'X' },
    source: 'group', scheduleFull: [],
  });
  assert.doesNotMatch(desc, /Invalid Date/);
  assert.match(desc, /Mexico 55%/);
});

// ---- AC1: group match, modeled ----------------------------------------------

test('AC1 group match: dynamic title + model pick + 1200x630 contract', async () => {
  const res = await handler(reqFor('Mexico__vs__Korea Republic'));
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /og:title" content="[^"]*Mexico[^"]*Korea Republic/);
  assert.match(body, /og:description" content="[^"]*Mexico[^"]*%/);   // pick %
  // group rows carry no kickoff_utc → looked up in schedule_full
  assert.match(body, /og:description" content="[^"]*UTC/);
  assert.match(body, /og:image:width" content="1200"/);
  assert.match(body, /og:image:height" content="630"/);
  assert.match(body, /twitter:card" content="summary_large_image"/);
  assert.match(body, /og:image" content="[^"]*\/assets\/og\/share-card\.jpg"/);
  // human bounce target is the hash route, each side encoded
  assert.match(body, /#\/matchup\/team_a\/Mexico\/team_b\/Korea%20Republic/);
});

// ---- AC2: knockout match, to-advance framing --------------------------------

test('AC2 knockout match: to-advance framing + round name + kickoff', async () => {
  const ko = JSON.parse(readFileSync('data/knockout_matchups.json', 'utf8'));
  const k = ko[0];
  const res = await handler(reqFor(`${k.team_a}__vs__${k.team_b}`));
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /to advance/i);
  assert.match(body, /Round of 32|Round of 16|Quarterfinal|Semifinal|Final/);
  // knockout rows carry kickoff_utc directly
  assert.match(body, /og:description" content="[^"]*UTC/);
});

// ---- AC3: human redirect -----------------------------------------------------

test('AC3 human redirect: meta-refresh + location.replace + <a> fallback', async () => {
  const res = await handler(reqFor('Mexico__vs__Korea Republic'));
  const body = await res.text();
  assert.match(body, /<meta http-equiv="refresh"/);
  assert.match(body, /location\.replace\(/);
  assert.match(body, /<a [^>]*href="[^"]*#\/matchup\//);
});

// ---- AC4: escaping -----------------------------------------------------------

test('AC4 escaping: apostrophe/ampersand never appear raw in any content=""', async () => {
  const res = await handler(reqFor("Cote d'Ivoire__vs__Senegal"));
  const body = await res.text();
  const contents = [...body.matchAll(/content="([^"]*)"/g)].map((m) => m[1]);
  for (const c of contents) {
    assert.ok(!/[<>']/.test(c), `raw <, > or ' leaked into content: ${c}`);
  }
  // the apostrophe should be present as an entity somewhere in the doc
  assert.match(body, /&#39;|&amp;/);
});

// ---- AC5: 1200x630 contract + image fallback --------------------------------

test('AC5 image contract: og:image points at an existing branded asset', async () => {
  const res = await handler(reqFor('Mexico__vs__Korea Republic'));
  const body = await res.text();
  assert.match(body, /og:image" content="[^"]*\/assets\/og\/share-card\.jpg"/);
  assert.match(body, /twitter:image" content="[^"]*\/assets\/og\/share-card\.jpg"/);
});

// ---- AC6: placeholder teams --------------------------------------------------

test('AC6 placeholder knockout pair does not throw, falls back to generic card', async () => {
  const res = await handler(reqFor('1A__vs__2B'));
  const body = await res.text();
  assert.equal(res.status, 200);                       // never 500
  assert.match(body, /2026 FIFA World Cup|WC26/);
  assert.match(body, /og:image" content="[^"]*\/assets\/og\/share-card\.jpg"/);
});

// ---- AC7: unknown pair -------------------------------------------------------

test('AC7 unknown pair → generic card, 200, still bounces to SPA', async () => {
  const res = await handler(reqFor('Atlantis__vs__El Dorado'));
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /2026 FIFA World Cup|WC26/);
  assert.match(body, /#\/matchup\/team_a\/Atlantis\/team_b\/El%20Dorado/);
});

// ---- AC8: either orientation -------------------------------------------------

test('AC8 either orientation resolves the same fixture', async () => {
  const a = await (await handler(reqFor('Mexico__vs__Korea Republic'))).text();
  const b = await (await handler(reqFor('Korea Republic__vs__Mexico'))).text();
  for (const body of [a, b]) {
    assert.match(body, /Mexico/);
    assert.match(body, /Korea Republic/);
    assert.match(body, /og:description" content="[^"]*%/);  // both carry the pick %
  }
});

// ---- resolver unit (both orientations against real data) --------------------

test('resolveMatchServer: group → knockout → schedule precedence, both orientations', () => {
  const groupMatchups = JSON.parse(readFileSync('data/group_matchups.json', 'utf8'));
  const knockoutMatchups = JSON.parse(readFileSync('data/knockout_matchups.json', 'utf8'));
  const scheduleFull = JSON.parse(readFileSync('data/schedule_full.json', 'utf8'));
  const data = { groupMatchups, knockoutMatchups, scheduleFull };

  const g1 = resolveMatchServer('Mexico', 'Korea Republic', data);
  assert.equal(g1.source, 'group');
  const g2 = resolveMatchServer('Korea Republic', 'Mexico', data);
  assert.equal(g2.source, 'group');

  const none = resolveMatchServer('Atlantis', 'El Dorado', data);
  assert.equal(none.match, null);
  assert.equal(none.source, null);
});

// ---- edge: fetch failure → generic card, never throws -----------------------

test('edge: all fetches failing → generic 200 card, never throws', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const res = await handler(reqFor('Mexico__vs__Korea Republic'));
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /og:title" content="[^"]*Mexico/);
  } finally {
    globalThis.fetch = saved;
  }
});

// ---- header contract ---------------------------------------------------------

test('headers: text/html + short cache-control', async () => {
  const res = await handler(reqFor('Mexico__vs__Korea Republic'));
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
});
