/* schedule-kickoffs.test.mjs — June-13 RCA: three group-stage 04:00Z nightcaps
   shipped 24h early (Australia–Türkiye shown "Fri Jun 12" instead of the real
   "Sat Jun 13 / 04:00Z Sun"). scrape_schedule.py (FIFA, robots-blocked) never
   self-corrected. Fix: ESPN-reconciled kickoffs + reconcile_schedule.py cron.
   These lock the corrected data and the automation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

function kickoffOf(rows, a, b) {
  const m = rows.find((r) => (r.team_a === a && r.team_b === b) || (r.team_a === b && r.team_b === a));
  return m?.kickoff_utc;
}

test('the 3 corrected group games match ESPN ground truth (not 24h early)', () => {
  const rows = J('data/schedule_full.json');
  // ESPN-verified kickoffs (UTC):
  assert.equal(kickoffOf(rows, 'Australia', 'Turkiye'), '2026-06-14T04:00:00Z');
  assert.equal(kickoffOf(rows, 'Austria', 'Jordan'), '2026-06-17T04:00:00Z');
  assert.equal(kickoffOf(rows, 'Tunisia', 'Japan'), '2026-06-21T04:00:00Z');
  // and the old wrong values are gone
  assert.notEqual(kickoffOf(rows, 'Australia', 'Turkiye'), '2026-06-13T04:00:00Z');
});

test('Australia–Türkiye renders as Sat Jun 13 in Chicago (the reported bug)', () => {
  const rows = J('data/schedule_full.json');
  const iso = kickoffOf(rows, 'Australia', 'Turkiye');
  const chicago = new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric',
  });
  assert.match(chicago, /Saturday, June 13/, `expected Sat Jun 13 Chicago, got "${chicago}"`);
});

test('reconcile_schedule.py: ESPN source, instant-compare, placeholder-safe', () => {
  const s = read('scripts/reconcile_schedule.py');
  assert.match(s, /site\.api\.espn\.com/, 'pulls ESPN scoreboard');
  assert.match(s, /parse_instant/, 'compares by instant, not string (no seconds churn)');
  assert.match(s, /is_placeholder/, 'never rewrites bracket-placeholder matches');
  assert.match(s, /ensure_ascii=True/, 'matches the on-disk encoding (no cosmetic churn)');
});

test('crons run the reconciler (daily + hourly self-heal)', () => {
  assert.match(read('.github/workflows/daily_update.yml'), /reconcile_schedule\.py/);
  assert.match(read('.github/workflows/frequent_update.yml'), /reconcile_schedule\.py/);
});
