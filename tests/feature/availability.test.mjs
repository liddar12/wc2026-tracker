/* availability.test.mjs — P1-B2 (docs/POSTMORTEM_2026-06-19.md): surface the
   one reliable availability signal (suspensions from match events) on the
   matchup view, not just the Injuries page. A red bans the team's NEXT match;
   two accumulated yellows = a one-match ban. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suspendedForMatch, suspensions } from '../../app/lib/availability.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// USA group: M1 (Jun13) USA–Paraguay, M2 (Jun19) USA–Australia.
const data = {
  scheduleFull: [
    { team_a: 'USA', team_b: 'Paraguay', kickoff_utc: '2026-06-13T01:00:00Z' },
    { team_a: 'USA', team_b: 'Australia', kickoff_utc: '2026-06-19T19:00:00Z' },
    { team_a: 'Spain', team_b: 'Japan', kickoff_utc: '2026-06-14T19:00:00Z' },
    { team_a: 'Spain', team_b: 'Italy', kickoff_utc: '2026-06-20T19:00:00Z' },
  ],
  matchEvents: {
    'USA__vs__Paraguay': { events: [
      { type: 'red', player: 'Tim Ream', team: 'USA', minute: "70'" },
      { type: 'yellow', player: 'Weston McKennie', team: 'USA', minute: "30'" },
    ] },
    // McKennie's 2nd yellow (different match) → ban next USA match
    'Spain__vs__Japan': { events: [
      { type: 'goal', player: 'Olmo', team: 'Spain', minute: "10'" },
    ] },
  },
};

test('red card bans the team’s NEXT match (not the one it occurred in)', () => {
  // Ream was sent off in USA–Paraguay → suspended for USA–Australia
  const m2 = suspendedForMatch(data, { team_a: 'USA', team_b: 'Australia' });
  assert.ok(m2.team_a.some((s) => s.player === 'Tim Ream'), 'Ream out for the next match');
  // ...and NOT flagged for the match he was carded in
  const m1 = suspendedForMatch(data, { team_a: 'USA', team_b: 'Paraguay' });
  assert.ok(!m1.team_a.some((s) => s.player === 'Tim Ream'), 'not suspended in the card match');
});

test('orientation: ban attaches to the player’s team regardless of home/away', () => {
  const m2 = suspendedForMatch(data, { team_a: 'Australia', team_b: 'USA' });
  assert.ok(m2.team_b.some((s) => s.player === 'Tim Ream'), 'Ream attaches to USA (team_b here)');
  assert.equal(m2.team_a.length, 0, 'no Australia suspensions');
});

test('tournament list (Injuries page) reports who misses what', () => {
  const all = suspensions(data);
  const ream = all.find((s) => s.player === 'Tim Ream');
  assert.ok(ream, 'Ream listed');
  assert.match(ream.misses, /vs Australia/, 'shows the missed opponent');
  assert.match(ream.reason, /red/, 'reason is the red card');
});

test('matchup view wires the shared availability section', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /suspendedForMatch/, 'matchup uses the per-match availability');
  assert.match(md, /data-testid="match-availability"|dataset\.testid = 'match-availability'/, 'renders an availability section');
});
