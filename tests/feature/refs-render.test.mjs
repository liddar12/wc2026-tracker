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

// ---- RJ30.1 Item 2: additive plain-language delta + both-empty collapse ------

test('teamHistory returns additive cards_delta_pct/pens_delta_pct (positive when above avg)', () => {
  // 6 rows of 4 yellows each against Argentina → mean_cards 4 > LEAGUE_CARDS_MEAN 2.9.
  const history = Array.from({ length: 6 }, () => row('Argentina', 'Brazil', { ya: 4 }));
  const h = teamHistory(history, 'Argentina');
  assert.equal(typeof h.cards_delta_pct, 'number', 'additive field present');
  assert.ok(h.cards_delta_pct > 0, 'above-average cards → positive delta');
  assert.equal(typeof h.pens_delta_pct, 'number');
});

test('teamHistory delta fields are null for an empty history (additive, no NaN)', () => {
  const h = teamHistory([], 'Argentina');
  assert.equal(h.cards_delta_pct, null);
  assert.equal(h.pens_delta_pct, null);
});

test('both-empty detection: hA.n===0 && hB.n===0 (the renderer collapse condition)', () => {
  // Exact condition components/referee.js collapses on → one "no history yet" note.
  const hA = teamHistory([], 'Argentina');
  const hB = teamHistory([], 'Brazil');
  assert.equal(hA.n, 0);
  assert.equal(hB.n, 0);
  assert.ok(!hA.n && !hB.n, 'both-empty drives the single collapsed note');
});

test('mixed case: one team has history, the other does not (collapse must NOT trigger)', () => {
  const history = Array.from({ length: 3 }, () => row('Argentina', 'Spain'));
  const hA = teamHistory(history, 'Argentina'); // has history
  const hB = teamHistory(history, 'Brazil');     // no overlap
  assert.ok(hA.n > 0);
  assert.equal(hB.n, 0);
  assert.ok(hA.n || hB.n, 'at least one side has history → per-team cards render, not the note');
});
