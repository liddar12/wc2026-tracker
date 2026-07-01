/* rj30-2-match-insights.test.mjs — RJ30.2 Match Intelligence, Wave-1 A.
 *
 * Unit-tests app/lib/match-insights.js (pure, deterministic, $0) + asserts the
 * scrape_match_stats.py scraper structure and the data/match_stats.json shape.
 * Named distinctly from the pre-existing tests/feature/match-insights.test.mjs
 * (which covers an earlier, unrelated increment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { insightsFor, goalsFromEvents } from '../../app/lib/match-insights.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

// A row where team_a dominates possession + finishes clinically.
const dominantRow = {
  team_a: 'Spain', team_b: 'Italy',
  stats: {
    a: { possessionPct: 64, totalShots: 12, shotsOnTarget: 4, passPct: 88 },
    b: { possessionPct: 36, totalShots: 5, shotsOnTarget: 1, passPct: 74 },
  },
  key_events: [
    { minute: '20', type: 'goal', team: 'Spain' },
    { minute: '55', type: 'goal', team: 'Spain' },
    { minute: '70', type: 'yellow', team: 'Italy' },
  ],
};

test('insightsFor: empty / missing inputs are safe (return [])', () => {
  assert.deepEqual(insightsFor(null), []);
  assert.deepEqual(insightsFor({}), []);
  assert.deepEqual(insightsFor({ team_a: 'A', team_b: 'B' }), []);
  assert.deepEqual(insightsFor({ stats: null }), []);
  // stats present but all below threshold → no lines
  assert.deepEqual(insightsFor({
    team_a: 'A', team_b: 'B',
    stats: { a: { possessionPct: 51 }, b: { possessionPct: 49 } }, key_events: [],
  }), []);
});

test('insightsFor: dominant possession line (>=58%)', () => {
  const lines = insightsFor(dominantRow);
  assert.ok(lines.some((l) => l.includes('Spain') && /possession/i.test(l)),
    `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => /64%/.test(l)), 'shows rounded pct');
});

test('insightsFor: clinical finishing (goals vs shots on target)', () => {
  const lines = insightsFor(dominantRow);
  assert.ok(lines.some((l) => /clinical/i.test(l) && l.includes('Spain')),
    `got: ${JSON.stringify(lines)}`);
});

test('insightsFor: caps at 3 lines and is deterministic', () => {
  const modelRow = { predicted_winner: 'Spain' };
  const xgRow = { team_a: 'Spain', team_b: 'Italy', team_a_xg: 0.9, team_b_xg: 1.8 };
  const a = insightsFor(dominantRow, xgRow, modelRow);
  const b = insightsFor(dominantRow, xgRow, modelRow);
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(a.length <= 3, `<=3 lines, got ${a.length}`);
});

test('insightsFor: model agreement — pick backs up the play', () => {
  const lines = insightsFor(dominantRow, null, { predicted_winner: 'Spain' });
  assert.ok(lines.some((l) => /Model favored Spain/.test(l) && /backs it up/.test(l)),
    `got: ${JSON.stringify(lines)}`);
});

test('insightsFor: model disagreement — other side running the game', () => {
  // Model likes Italy, but Spain dominates shots + possession.
  const lines = insightsFor(dominantRow, null, { predicted_winner: 'Italy' });
  assert.ok(lines.some((l) => /Model favored Italy/.test(l) && /running the game/.test(l)),
    `got: ${JSON.stringify(lines)}`);
});

test('insightsFor: model row accepts group_matchups upset_risk.favored shape', () => {
  const lines = insightsFor(dominantRow, null, { upset_risk: { favored: 'Spain' } });
  assert.ok(lines.some((l) => /Model favored Spain/.test(l)), `got: ${JSON.stringify(lines)}`);
});

test('goalsFromEvents: counts goals per side, own-goals credit the opponent', () => {
  assert.deepEqual(goalsFromEvents(dominantRow), { a: 2, b: 0 });
  const og = {
    team_a: 'A', team_b: 'B',
    key_events: [
      { type: 'goal', team: 'A' },
      { type: 'own-goal', team: 'B' }, // B's own goal → point for A
      { type: 'pen-goal', team: 'B' },
    ],
  };
  assert.deepEqual(goalsFromEvents(og), { a: 2, b: 1 });
  assert.equal(goalsFromEvents({ key_events: [] }), null, 'no events → null');
  assert.equal(goalsFromEvents({}), null, 'no key_events → null');
});

test('insightsFor: xG read — out-shooting the lower-xG side', () => {
  // Model xG favors Italy heavily, but Spain out-shoots 12 vs 5 (>=+4).
  const xgRow = { team_a: 'Spain', team_b: 'Italy', team_a_xg: 0.7, team_b_xg: 2.0 };
  // Strip the higher-salience signals so xG read has room in the cap.
  const flatRow = {
    team_a: 'Spain', team_b: 'Italy',
    stats: {
      a: { possessionPct: 50, totalShots: 12, shotsOnTarget: 2 },
      b: { possessionPct: 50, totalShots: 5, shotsOnTarget: 1 },
    },
    key_events: [],
  };
  const lines = insightsFor(flatRow, xgRow, null);
  assert.ok(lines.some((l) => /out-shooting/.test(l) && /Spain/.test(l)),
    `got: ${JSON.stringify(lines)}`);
});

/* ---- scraper structure + data-file shape ---- */

test('scrape_match_stats.py: ESPN summary boxscore + self-test + $0', () => {
  const s = read('scripts/scrape_match_stats.py');
  assert.match(s, /\/summary/, 'uses the summary endpoint');
  assert.match(s, /boxscore/, 'reads boxscore');
  assert.match(s, /possessionPct/, 'extracts possession');
  assert.match(s, /shotsOnTarget/, 'extracts shots on target');
  assert.match(s, /keyEvents|key_events/, 'compact key-events timeline');
  assert.match(s, /--self-test|_self_test/, 'has a self-test');
  assert.match(s, /ensure_ascii=True/, 'repo on-disk encoding convention');
  assert.match(s, /TEAM_RENAMES/, 'canonical team-name mapping');
});

test('data/match_stats.json exists with a valid keyed shape', () => {
  const p = 'data/match_stats.json';
  assert.ok(existsSync(new URL(p, root)), 'match_stats.json written by the scraper');
  const d = J(p);
  assert.equal(typeof d, 'object');
  assert.ok(d.__meta__, 'stamps __meta__ freshness');
  assert.ok(d.__meta__.updated_at, 'meta has updated_at (never "never")');
  // Every non-meta row is a well-formed match_stats row.
  for (const [k, row] of Object.entries(d)) {
    if (k === '__meta__') continue;
    assert.ok(row.team_a && row.team_b, `${k}: teams`);
    assert.ok(row.stats && row.stats.a && row.stats.b, `${k}: two-sided stats`);
    assert.ok(Array.isArray(row.key_events), `${k}: key_events array`);
    // The row feeds the insights lib without throwing.
    assert.ok(Array.isArray(insightsFor(row)), `${k}: insightsFor safe`);
  }
});
