/* results-elo.test.mjs — P0-A1 (docs/POSTMORTEM_2026-06-19.md): make the model
   move game-to-game. Server compute_elo feeds composite; client live-elo powers
   the movers card. Both must replay FINAL results only, all tiers,
   chronologically — and agree. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recomputeElo } from '../../app/live-elo.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

test('elo feeds the model: elo_scale.json fit + compute_elo wired before composite', () => {
  const scale = J('data/elo_scale.json');
  assert.ok(scale.r2 >= 0.999, `elo_raw→elo_scaled is linear (R^2=${scale.r2})`);
  const elo = read('scripts/compute_elo.py');
  assert.match(elo, /elo_current/, 'writes elo_current (keeps elo_raw as immutable seed)');
  assert.match(elo, /STATUS_FULL_TIME/, 'status-gated to FINAL');
  // compute_elo runs before rebuild_composite in every model-rebuilding cron
  for (const wf of ['daily_update', 'live_update', 'frequent_update']) {
    const y = read(`.github/workflows/${wf}.yml`);
    const e = y.indexOf('compute_elo.py');
    const c = y.indexOf('rebuild_composite.py');
    assert.ok(e !== -1 && e < c, `${wf}: compute_elo runs before rebuild_composite`);
  }
});

test('teams.json now carries results-driven elo_current (model un-frozen)', () => {
  const teams = J('data/teams.json');
  const withCurrent = Object.values(teams).filter((t) => typeof t.elo_current === 'number');
  assert.ok(withCurrent.length >= 40, 'elo_current populated across the field');
  // at least some team diverged from its pre-tournament seed
  const moved = Object.values(teams).some((t) => t.elo_current !== Math.round(t.elo_raw));
  assert.ok(moved, 'at least one team’s Elo moved from the seed');
});

test('client live-elo: FINAL-only, all tiers, no double-count vs seed', () => {
  const src = read('app/live-elo.js');
  assert.match(src, /FINAL/, 'status-gates to FINAL');
  assert.match(src, /KO_TIERS/, 'iterates all knockout tiers (not the old nonexistent key)');
  assert.ok(!/results\.knockouts/.test(src), 'old broken results.knockouts read removed');

  // a clear win raises the winner and lowers the loser; a scheduled stub does nothing
  const data = {
    meta: { data_version: 't1' },
    teams: { Spain: { elo_raw: 2000 }, Japan: { elo_raw: 1800 }, Italy: { elo_raw: 1900 }, Brazil: { elo_raw: 1950 } },
    actualResults: {
      group_stage: {
        'Spain__vs__Japan': { score_a: 3, score_b: 0, status: 'STATUS_FULL_TIME', kickoff_utc: '2026-06-12T19:00Z' },
        'Italy__vs__Brazil': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED', kickoff_utc: '2026-06-20T19:00Z' },
      },
    },
  };
  const elo = recomputeElo(data);
  assert.ok(elo.Spain.delta > 0, 'Spain gained from the win');
  assert.ok(elo.Japan.delta < 0, 'Japan lost');
  assert.equal(elo.Italy.delta, 0, 'scheduled 0-0 stub did NOT move Elo');
  assert.equal(elo.Brazil.delta, 0, 'scheduled stub did not move the opponent either');
});
