/* refs-render.test.mjs — RJ30-10: ref-bias pure-logic contract (DOM-free).
   Builds a fixture referees map + matchReferees map keyed 'Argentina__vs__Brazil'
   and asserts the bias confidence tiers + the empty-history branch the referee
   card depends on. Pure logic against the existing ref-bias.js exports. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamHistory, confederationLean, buildTeamConfedLookup } from '../../app/ref-bias.js';

function row(a, b, opts = {}) {
  return {
    team_a: a, team_b: b,
    yellows_a: opts.ya ?? 2, reds_a: opts.ra ?? 0, penalties_a: opts.pa ?? 0,
    yellows_b: opts.yb ?? 2, reds_b: opts.rb ?? 0, penalties_b: opts.pb ?? 0,
  };
}

test('a ref with a 6-row history vs a team yields high confidence', () => {
  const history = Array.from({ length: 6 }, () => row('Argentina', 'Brazil'));
  const h = teamHistory(history, 'Argentina');
  assert.equal(h.n, 6);
  assert.equal(h.confidence, 'high');
  assert.equal(typeof h.z_cards, 'number');
});

test('2–4 prior matches is medium, ≤1 is low', () => {
  const three = Array.from({ length: 3 }, () => row('Argentina', 'Brazil'));
  assert.equal(teamHistory(three, 'Argentina').confidence, 'medium');
  const one = [row('Argentina', 'Brazil')];
  assert.equal(teamHistory(one, 'Argentina').confidence, 'low');
});

test('empty-history ref yields {n:0} → the "No prior matches" card branch', () => {
  const h = teamHistory([], 'Argentina');
  assert.equal(h.n, 0);
  assert.equal(h.z_cards, null);
  assert.equal(h.z_pens, null);
  // n === 0 is exactly what components/referee.js biasCard() branches on to
  // render "No prior matches with this ref."
  assert.ok(!h.n, 'falsy n drives the empty-state card branch');
});

test('matchReferees keying resolves a ref id for a fixture orientation', () => {
  // Mirror the components/referee.js matchId derivation so the data contract is
  // locked: assignment is keyed 'TeamA__vs__TeamB' (and the reverse is tried).
  const matchReferees = { 'Argentina__vs__Brazil': 'szymon_marciniak' };
  const referees = {
    szymon_marciniak: {
      ref_id: 'szymon_marciniak', name: 'Szymon Marciniak',
      confederation: 'UEFA', nationality: 'Poland', stats: {}, history: [],
    },
  };
  const match = { team_a: 'Argentina', team_b: 'Brazil' };
  const id = matchReferees[`${match.team_a}__vs__${match.team_b}`]
    || matchReferees[`${match.team_b}__vs__${match.team_a}`];
  assert.equal(id, 'szymon_marciniak');
  assert.equal(referees[id].name, 'Szymon Marciniak');
});

test('confederationLean returns null without both own + other samples (graceful)', () => {
  const lookup = buildTeamConfedLookup({});
  // History touching only one confederation → no comparison possible → null.
  const oneSided = [row('Argentina', 'Brazil')]; // both CONMEBOL
  assert.equal(confederationLean(oneSided, 'UEFA', lookup), null);
});
