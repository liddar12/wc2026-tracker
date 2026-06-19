/* staleness-watchdog.test.mjs — P0-A2 (docs/POSTMORTEM_2026-06-19.md): model
   inputs (teams/players) silently froze from May 28 through the group stage with
   no alert. This watchdog makes that loud. Tests the script contract + wiring. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('check_staleness.py: API-based age, tournament-gated, dedupes, non-blocking', () => {
  const s = read('scripts/check_staleness.py');
  assert.match(s, /api\.github\.com\/repos\/.*\/commits\?path=/, 'uses commits API (shallow-clone safe), not git log');
  assert.match(s, /THRESHOLD_HOURS = 36/, '36h threshold');
  assert.match(s, /TOURNAMENT_START|TOURNAMENT_END/, 'gated to tournament window');
  assert.match(s, /teams\.json/, 'watches teams.json');
  assert.match(s, /players\.json/, 'watches players.json');
  assert.match(s, /state=open[^\n]*per_page=1/, 'dedupes against an open issue');
  assert.match(s, /raise SystemExit\(0\)/, 'never fails the job');
  assert.match(s, /"stale-data"|LABEL = "stale-data"/, 'labeled stale-data');
});

test('daily cron runs the watchdog with a token + issues:write', () => {
  const y = read('.github/workflows/daily_update.yml');
  assert.match(y, /check_staleness\.py/, 'watchdog runs in daily cron');
  assert.match(y, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'token passed');
  assert.match(y, /issues: write/, 'can open issues');
});
