/* push-diff.test.mjs — RJ30-3 (RJ30-B). Goal/kickoff diff CORE.
   Pure functions, no network. Imports netlify/functions/_lib/push-diff-core.mjs
   and feeds in-memory fixtures (no dependency on another epic's generated file).

   Mirrors the node:test + node:assert/strict style of match-status.test.mjs.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffGoals,
  imminentKickoffs,
  targetTeamsForNotice,
  GOAL_BACKFILL_GUARD_MS,
} from '../../netlify/functions/_lib/push-diff-core.mjs';

const ISO = (ms) => new Date(ms).toISOString();
const KEY = 'Mexico__vs__South Africa';

function liveFixture(now) {
  return {
    events: {
      [KEY]: { events: [{ minute: "9'", type: 'goal', player: 'X', team: 'Mexico' }] },
    },
    results: {
      group_stage: {
        [KEY]: { score_a: 1, score_b: 0, status: 'STATUS_FIRST_HALF', kickoff_utc: ISO(now - 10 * 60000) },
      },
    },
    schedule: [
      { match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(now - 10 * 60000) },
    ],
  };
}

test('diffGoals: a new goal on a LIVE match with no prior state emits one notice', () => {
  const now = Date.now();
  const { events, results, schedule } = liveFixture(now);
  const out = diffGoals(events, results, schedule, [], now);
  assert.equal(out.length, 1);
  assert.equal(out[0].match_id, KEY);
  assert.deepEqual(out[0].teams, ['Mexico', 'South Africa']);
  assert.equal(out[0].player, 'X');
  assert.equal(out[0].nextSeq, 1);
  assert.equal(out[0].kind, 'goal');
});

test('diffGoals: already-sent goal (seq=1) is de-duplicated to zero notices', () => {
  const now = Date.now();
  const { events, results, schedule } = liveFixture(now);
  const state = [{ match_id: KEY, kind: 'goal', seq: 1 }];
  const out = diffGoals(events, results, schedule, state, now);
  assert.equal(out.length, 0);
});

test('diffGoals: STATUS_SCHEDULED stub never notifies even with a goal event present', () => {
  const now = Date.now();
  const { events, schedule } = liveFixture(now);
  const results = {
    group_stage: {
      [KEY]: { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED', kickoff_utc: ISO(now + 60 * 60000) },
    },
  };
  const out = diffGoals(events, results, schedule, [], now);
  assert.equal(out.length, 0);
});

test('diffGoals: a long-finished match (kickoff 5h ago) with no state row does NOT blast historic goals', () => {
  const now = Date.now();
  const ko = now - 5 * 60 * 60 * 1000;
  const events = {
    [KEY]: {
      events: [
        { minute: "9'", type: 'goal', player: 'A', team: 'Mexico' },
        { minute: "40'", type: 'goal', player: 'B', team: 'Mexico' },
        { minute: "88'", type: 'goal', player: 'C', team: 'South Africa' },
      ],
    },
  };
  const results = {
    group_stage: { [KEY]: { score_a: 2, score_b: 1, status: 'STATUS_FULL_TIME', kickoff_utc: ISO(ko) } },
  };
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(ko) }];
  const out = diffGoals(events, results, schedule, [], now);
  assert.equal(out.length, 0, 'no historic blast for a match outside the backfill guard with no prior state');
});

test('diffGoals: a final goal that just completed still notifies (FINAL within guard window)', () => {
  const now = Date.now();
  const ko = now - 100 * 60000; // ~1h40m ago, inside the 3h guard
  const events = {
    [KEY]: { events: [{ minute: "90'", type: 'goal', player: 'Z', team: 'Mexico' }] },
  };
  const results = {
    group_stage: { [KEY]: { score_a: 1, score_b: 0, status: 'STATUS_FULL_TIME', kickoff_utc: ISO(ko) } },
  };
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(ko) }];
  const out = diffGoals(events, results, schedule, [], now);
  assert.equal(out.length, 1, 'the final goal of a just-finished match still notifies');
  assert.equal(out[0].nextSeq, 1);
});

test('diffGoals: two new goals from prior seq=1 emit one notice carrying nextSeq=3', () => {
  const now = Date.now();
  const events = {
    [KEY]: {
      events: [
        { minute: "9'", type: 'goal', player: 'A', team: 'Mexico' },
        { minute: "40'", type: 'goal', player: 'B', team: 'Mexico' },
        { minute: "70'", type: 'goal', player: 'C', team: 'Mexico' },
      ],
    },
  };
  const results = {
    group_stage: { [KEY]: { score_a: 3, score_b: 0, status: 'STATUS_SECOND_HALF', kickoff_utc: ISO(now - 70 * 60000) } },
  };
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(now - 70 * 60000) }];
  const out = diffGoals(events, results, schedule, [{ match_id: KEY, kind: 'goal', seq: 1 }], now);
  // We collapse "N new goals" into a single notice (latest player), carrying nextSeq.
  assert.equal(out.length, 1);
  assert.equal(out[0].player, 'C', 'body uses the latest goal scorer');
  assert.equal(out[0].nextSeq, 3);
});

test('imminentKickoffs: a kickoff within the 15-min lead with no state emits a kickoff notice', () => {
  const now = Date.now();
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(now + 10 * 60000) }];
  const out = imminentKickoffs(schedule, {}, [], now, 15);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'kickoff');
  assert.deepEqual(out[0].teams, ['Mexico', 'South Africa']);
  assert.equal(out[0].match_id, KEY);
});

test('imminentKickoffs: already-sent kickoff is de-duplicated', () => {
  const now = Date.now();
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(now + 10 * 60000) }];
  const out = imminentKickoffs(schedule, {}, [{ match_id: KEY, kind: 'kickoff', seq: 0 }], now, 15);
  assert.equal(out.length, 0);
});

test('imminentKickoffs: a kickoff outside the lead window (40 min away) emits nothing', () => {
  const now = Date.now();
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(now + 40 * 60000) }];
  const out = imminentKickoffs(schedule, {}, [], now, 15);
  assert.equal(out.length, 0);
});

test('imminentKickoffs: a match already LIVE is not re-announced as a kickoff', () => {
  const now = Date.now();
  const schedule = [{ match_id: KEY, team_a: 'Mexico', team_b: 'South Africa', stage: 'group', kickoff_utc: ISO(now + 5 * 60000) }];
  const results = { group_stage: { [KEY]: { status: 'STATUS_FIRST_HALF', kickoff_utc: ISO(now + 5 * 60000) } } };
  const out = imminentKickoffs(schedule, results, [], now, 15);
  assert.equal(out.length, 0);
});

test('targetTeamsForNotice returns the two canonical team names', () => {
  assert.deepEqual(targetTeamsForNotice({ teams: ['Mexico', 'South Africa'] }), ['Mexico', 'South Africa']);
});

test('GOAL_BACKFILL_GUARD_MS is a sane 3h window', () => {
  assert.equal(GOAL_BACKFILL_GUARD_MS, 3 * 60 * 60 * 1000);
});
