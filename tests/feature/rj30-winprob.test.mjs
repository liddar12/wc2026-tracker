/* rj30-winprob.test.mjs — locks the pure live win-probability model
   (app/lib/win-prob.js). Pure functions only — no DOM, no generated data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveWinProb, winProbSeries, priorFromMatch, estimateExtraTime } from '../../app/lib/win-prob.js';

const P = { pa: 0.50, pd: 0.25, pb: 0.25 };

test('outputs are a normalized distribution', () => {
  const r = liveWinProb({ ...P, scoreA: 0, scoreB: 0, minute: 1, stage: 'group' });
  assert.ok(Math.abs(r.a + r.d + r.b - 1) < 1e-9);
  for (const v of [r.a, r.d, r.b]) assert.ok(v >= 0 && v <= 1);
});

test('at minute ~1 with 0-0, result ≈ prior (clock weight ~0)', () => {
  const r = liveWinProb({ ...P, scoreA: 0, scoreB: 0, minute: 1, stage: 'group' });
  assert.ok(Math.abs(r.a - P.pa) < 0.05);
});

test('leading late raises the leader and crushes the trailer (monotonic in minute)', () => {
  const early = liveWinProb({ ...P, scoreA: 1, scoreB: 0, minute: 20, stage: 'group' });
  const late = liveWinProb({ ...P, scoreA: 1, scoreB: 0, minute: 88, stage: 'group' });
  assert.ok(late.a > early.a);          // later ⇒ more sure
  assert.ok(late.b < 0.10);             // trailer nearly dead at 88'
  assert.ok(late.a > P.pa);             // above pre-match prior
});

test('bigger lead ⇒ higher win% (monotonic in margin)', () => {
  const one = liveWinProb({ ...P, scoreA: 1, scoreB: 0, minute: 70, stage: 'group' });
  const two = liveWinProb({ ...P, scoreA: 2, scoreB: 0, minute: 70, stage: 'group' });
  assert.ok(two.a > one.a);
});

test('drawing late inflates the draw segment vs kickoff', () => {
  const ko = liveWinProb({ ...P, scoreA: 0, scoreB: 0, minute: 1, stage: 'group' });
  const late = liveWinProb({ ...P, scoreA: 1, scoreB: 1, minute: 85, stage: 'group' });
  assert.ok(late.d > ko.d);
});

test('knockout: no draw mass, two-way split', () => {
  const r = liveWinProb({ pa: 0.6, pd: 0, pb: 0.4, scoreA: 0, scoreB: 0, minute: 80, stage: 'round_of_16' });
  assert.equal(r.d, 0);
  assert.ok(Math.abs(r.a + r.b - 1) < 1e-9);
});

test('clamps — never exactly 0/1 so the sparkline never flatlines', () => {
  const r = liveWinProb({ ...P, scoreA: 5, scoreB: 0, minute: 95, stage: 'group' });
  assert.ok(r.a < 1 && r.b > 0);
});

test('trailing team symmetric to leading team', () => {
  const r = liveWinProb({ ...P, scoreA: 0, scoreB: 1, minute: 88, stage: 'group' });
  assert.ok(r.b > r.a);                 // the team that leads (b) is favored
  assert.ok(r.a < 0.10);
});

test('missing/NaN minute never yields NaN (treated as a stage default)', () => {
  const r = liveWinProb({ ...P, scoreA: 1, scoreB: 0, minute: NaN, stage: 'group' });
  for (const v of [r.a, r.d, r.b]) assert.ok(Number.isFinite(v));
  assert.ok(Math.abs(r.a + r.d + r.b - 1) < 1e-9);
});

test('knockout late tie favors the higher-prior side (draw mass pushed to model pick)', () => {
  const r = liveWinProb({ pa: 0.7, pd: 0, pb: 0.3, scoreA: 0, scoreB: 0, minute: 90, stage: 'round_of_16' });
  assert.ok(r.a > r.b);                 // a is the model's advance pick
  assert.equal(r.d, 0);
});

test('winProbSeries returns a numeric leader-win% trajectory ending near current', () => {
  const match = { probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } };
  const found = { mode: 'live', actual: { score_a: 1, score_b: 0, minute: '72' } };
  const series = winProbSeries(match, found);
  assert.ok(Array.isArray(series) && series.length >= 2);
  for (const v of series) assert.ok(v >= 0 && v <= 100);
  // monotone-ish: the last sample (current minute, leading) is at/above the first
  assert.ok(series[series.length - 1] >= series[0]);
});

test('winProbSeries on a non-live record returns an empty array', () => {
  const match = { probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } };
  assert.deepEqual(winProbSeries(match, { mode: 'final', actual: { score_a: 1, score_b: 0 } }), []);
  assert.deepEqual(winProbSeries(match, null), []);
});

// --- priorFromMatch: knockout detection + advance_pct prior --------------------

test('priorFromMatch: group row → 3-way prior, knockout=false', () => {
  const p = priorFromMatch({ stage: 'group', probabilities: { team_a_wins: 50, draw: 25, team_b_wins: 25 } });
  assert.equal(p.knockout, false);
  assert.ok(p.pd > 0);
});

test('priorFromMatch: is_knockout flag forces knockout=true and pd=0', () => {
  const p = priorFromMatch({ is_knockout: true, probabilities: { team_a_wins: 45, draw: 30, team_b_wins: 25 } });
  assert.equal(p.knockout, true);
  assert.equal(p.pd, 0);
});

test('priorFromMatch: non-group stage forces knockout even without the flag', () => {
  const p = priorFromMatch({ stage: 'round_of_16', probabilities: { team_a_wins: 45, draw: 30, team_b_wins: 25 } });
  assert.equal(p.knockout, true);
  assert.equal(p.pd, 0);
});

test('priorFromMatch: knockout PREFERS advance_pct as the to-advance prior', () => {
  // advance_pct (62/38) must win over the raw regulation probabilities (48/27/25).
  const p = priorFromMatch({
    stage: 'quarterfinals',
    advance_pct_a: 62, advance_pct_b: 38,
    probabilities: { team_a_wins: 48, draw: 27, team_b_wins: 25 },
  });
  assert.equal(p.knockout, true);
  assert.equal(p.pd, 0);
  assert.ok(Math.abs(p.pa - 0.62) < 1e-9, `pa=${p.pa}`);
  assert.ok(Math.abs(p.pb - 0.38) < 1e-9, `pb=${p.pb}`);
});

test('priorFromMatch: knockout falls back to probabilities when advance_pct absent', () => {
  const p = priorFromMatch({ stage: 'semifinals', probabilities: { team_a_wins: 60, draw: 20, team_b_wins: 20 } });
  assert.equal(p.knockout, true);
  assert.equal(p.pd, 0);
  assert.ok(p.pa > p.pb);
});

test('priorFromMatch: no prior anywhere → null', () => {
  assert.equal(priorFromMatch({ stage: 'group' }), null);
  assert.equal(priorFromMatch(null), null);
});

// --- estimateExtraTime: deterministic ET/PK likelihood ------------------------

test('estimateExtraTime: group stage is always 0/0 (no ET/PK in groups)', () => {
  const r = estimateExtraTime({ scoreA: 0, scoreB: 0, minute: 89, stage: 'group' });
  assert.deepEqual(r, { etPct: 0, pkPct: 0 });
});

test('estimateExtraTime: level scoreline late ⇒ high extra-time chance', () => {
  const r = estimateExtraTime({ scoreA: 1, scoreB: 1, minute: 88, stage: 'round_of_16' });
  assert.ok(r.etPct >= 70, `etPct=${r.etPct}`);
  assert.ok(r.pkPct > 0 && r.pkPct < r.etPct, `pkPct=${r.pkPct}`);
});

test('estimateExtraTime: level early ⇒ lower than level late (clock monotone)', () => {
  const early = estimateExtraTime({ scoreA: 0, scoreB: 0, minute: 10, stage: 'round_of_16' });
  const late = estimateExtraTime({ scoreA: 0, scoreB: 0, minute: 88, stage: 'round_of_16' });
  assert.ok(late.etPct > early.etPct);
});

test('estimateExtraTime: a two-goal lead late is effectively decided ⇒ ~0', () => {
  const r = estimateExtraTime({ scoreA: 2, scoreB: 0, minute: 85, stage: 'quarterfinals' });
  assert.ok(r.etPct <= 5, `etPct=${r.etPct}`);
});

test('estimateExtraTime: integer, clamped, NaN-safe, deterministic', () => {
  const a = estimateExtraTime({ scoreA: 1, scoreB: 1, minute: NaN, stage: 'final' });
  const b = estimateExtraTime({ scoreA: 1, scoreB: 1, minute: NaN, stage: 'final' });
  assert.deepEqual(a, b, 'deterministic');
  for (const v of [a.etPct, a.pkPct]) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `bad pct ${v}`);
  }
});
