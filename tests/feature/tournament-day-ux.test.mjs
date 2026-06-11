/* tournament-day-ux.test.mjs — June-11 evening fixes:
   1) hero countdown disappears once the opener has kicked off
   2) Golden Boot list is columned: Odds | Goals (actual) | Proj (final total)
   3) Today/Schedule cards receive the real result (score digits render) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('hero countdown is gated to pre-kickoff only', () => {
  const s = read('app/views/home-view.js');
  assert.match(s, /kickoffMs > Date\.now\(\)/, 'computes a future-kickoff gate');
  assert.match(s, /\$\{showCountdown \? renderCountdownShell/, 'shell only renders pre-kickoff');
  assert.match(s, /if \(showCountdown\) \{\s*startCountdownTicker/, 'ticker only starts pre-kickoff');
});

test('Golden Boot list has Odds / Goals / Proj columns from real fields', () => {
  const v = read('app/views/golden-awards-view.js');
  assert.match(v, /function bootTable/, 'boot table renderer exists');
  assert.match(v, /<span>Odds<\/span><span>Goals<\/span><span>Proj<\/span>/, 'column headers');
  assert.match(v, /c\.currentGoals/, 'actual goals column');
  assert.match(v, /c\.projGoals/, 'projected final total column');
  assert.match(v, /data-testid="gb-odds-list"/, 'keeps the e2e list contract');
  assert.ok(!v.includes('function liveCard'), 'separate live-scorers card removed');
  const css = read('app/styles.css');
  assert.match(css, /\.gb-table-row \{/, 'table styled');
});

test('Home + Schedule wire actualForCard into the match cards', () => {
  for (const f of ['app/views/home-view.js', 'app/views/schedule-view.js']) {
    const s = read(f);
    assert.match(s, /actualForCard\(data\.actualResults, m\)/, `${f} looks up the result`);
    assert.match(s, /actual: found\.actual/, `${f} passes the score to the card`);
  }
});
