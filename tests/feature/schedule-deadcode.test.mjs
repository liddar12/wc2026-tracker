/* schedule-deadcode.test.mjs — RJ30-9b. The dead card renderer
 * (scheduleCard / prettyStage / formatKickoffLocal) was deleted from
 * app/views/schedule-view.js — the active renderScheduleView uses
 * largeMatchCard + actualForCard. Guard both the deletion and the live date
 * helpers it must NOT have removed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const src = readFileSync(new URL('app/views/schedule-view.js', root), 'utf8');

test('dead functions are gone from schedule-view.js', () => {
  assert.ok(!/function\s+scheduleCard\b/.test(src), 'scheduleCard deleted');
  assert.ok(!/function\s+prettyStage\b/.test(src), 'prettyStage deleted');
  assert.ok(!/function\s+formatKickoffLocal\b/.test(src), 'formatKickoffLocal deleted');
});

test('live date helpers are retained (regression: do not over-delete)', () => {
  for (const fn of ['utcDateISO', 'toLocalDateISO', 'shortLocalDate', 'formatLocalDateISO']) {
    assert.match(src, new RegExp(`function\\s+${fn}\\b`), `${fn} retained`);
  }
});

test('renderScheduleView still wires largeMatchCard + actualForCard', () => {
  assert.match(src, /largeMatchCard/, 'uses largeMatchCard');
  assert.match(src, /actualForCard/, 'uses actualForCard');
});
