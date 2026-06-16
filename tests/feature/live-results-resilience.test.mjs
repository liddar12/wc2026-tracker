/* live-results-resilience.test.mjs — June-16 RCA: GitHub throttled the 15-min
   live_update cron to ~every 3-5h, so France-Senegal's 3-1 final never got
   scraped (frozen at 0-0 STATUS_SCHEDULED). Two-layer fix:
   (1) run scrape_live_results in the crons that DO fire (frequent/daily/
       pre-kickoff), not only the throttled 15-min one;
   (2) widen the client live-poll window so a just-finished game still merges
       its final from ESPN even when checked hours later. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeLiveScores } from '../../app/live-scores.js';
import { actualForCard } from '../../app/components/large-match-card.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('live-results scrape runs in the reliable crons, not just throttled */15', () => {
  assert.match(read('.github/workflows/frequent_update.yml'), /scrape_live_results\.py/, 'hourly floor');
  assert.match(read('.github/workflows/daily_update.yml'), /scrape_live_results\.py/, 'daily reconcile');
  assert.match(read('.github/workflows/pre_kickoff_update.yml'), /scrape_live_results\.py/, 'pre-kickoff path');
  assert.match(read('.github/workflows/live_update.yml'), /scrape_live_results\.py/, 'live path retained');
});

test('live-poll window covers a just-finished match (>2h post-kickoff)', () => {
  const p = read('app/live-poller.js');
  assert.match(p, /LIVE_WINDOW_MS = 3\.5 \* 3600 \* 1000/, 'window widened to 3.5h');
});

test('a finished ESPN result merges and renders as FINAL with the score', () => {
  // France kicked off 19:00Z; this simulates the client polling at ~21:40Z.
  const data = {
    scheduleFull: [
      { match_id: 'France__vs__Senegal', stage: 'group', team_a: 'France', team_b: 'Senegal', kickoff_utc: '2026-06-16T19:00:00Z' },
    ],
    actualResults: {
      group_stage: {
        // stale pipeline record (what prod had: frozen at kickoff)
        'France__vs__Senegal': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED', kickoff_utc: '2026-06-16T19:00Z' },
      },
    },
  };
  const board = [{ teams: { France: 3, Senegal: 1 }, status: 'STATUS_FULL_TIME', minute: '' }];
  const changed = mergeLiveScores(data, board);
  assert.equal(changed, 1, 'stale 0-0 gets overwritten by the final');
  const found = actualForCard(data.actualResults, data.scheduleFull[0]);
  assert.equal(found.mode, 'final');
  assert.equal(found.actual.score_a, 3);
  assert.equal(found.actual.score_b, 1);
});
