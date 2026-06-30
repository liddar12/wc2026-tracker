/* injuries-source.test.mjs — P0-B1 (docs/POSTMORTEM_2026-06-19.md): the old
   injuries source 404'd and wrote 0 entries silently. ESPN publishes no WC
   injury data (verified: per-team endpoints return 0 items), so the fix is an
   honest, future-proof scraper on the correct endpoint — not a fake source. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

test('scrape_injuries uses the correct ESPN endpoint, not the dead story URL', () => {
  const s = read('scripts/scrape_injuries.py');
  assert.match(s, /teams\/\{id\}\/injuries/, 'queries the per-team injuries endpoint');
  assert.ok(!/world-cup-2026\/story/.test(s), 'dead 404 story-tracker URL removed');
  assert.match(s, /source.*espn-team-injuries|"source": "espn-team-injuries"/, 'honest source label');
});

test('injuries.json has a valid honest shape (fresh meta, not a dead 404)', () => {
  const d = J('data/injuries.json');
  assert.ok(d.__meta__?.updated_at, 'fresh timestamp');
  assert.match(d.__meta__.source, /^espn-team-injuries/, 'honest ESPN source label (may append +api-football when the key is set)');
  assert.ok('note' in d.__meta__, 'documents that ESPN WC injury data is empty');
  assert.equal(typeof d.by_team, 'object');
});
