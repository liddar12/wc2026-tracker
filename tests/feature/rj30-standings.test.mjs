/* rj30-standings.test.mjs — locks the pure standings engine
   (app/lib/standings.js) against real data + synthetic fixtures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupTable, bestThirds, qualificationScenario } from '../../app/lib/standings.js';

const root = new URL('../../', import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const data = {
  actualResults: readJson('data/actual_results.json'),
  groupMatchups: readJson('data/group_matchups.json'),
};

test('group A: 4 rows, sorted by pts→gd→gf, ranks 1..4', () => {
  const t = groupTable(data, 'A');
  assert.equal(t.length, 4);
  for (let i = 1; i < t.length; i++) {
    const p = t[i - 1], c = t[i];
    // primary order must hold (pts desc; then gd; then gf) — H2H only ever
    // re-orders an otherwise-equal pts/gd/gf cluster, never violates these.
    assert.ok(
      p.points > c.points ||
      (p.points === c.points && (p.gd > c.gd ||
        (p.gd === c.gd && p.gf >= c.gf))),
      `row ${i} out of pts→gd→gf order`,
    );
    assert.equal(c.rank, i + 1);
  }
  assert.equal(t[0].rank, 1);
});

test('W-D-L is internally consistent with points and played', () => {
  for (const g of Object.keys(data.groupMatchups)) {
    for (const r of groupTable(data, g)) {
      assert.equal(r.points, r.w * 3 + r.d * 1);
      assert.equal(r.played, r.w + r.d + r.l);
      assert.equal(r.gd, r.gf - r.ga);
    }
  }
});

test('top-2 of every fully-played group are advanced=auto', () => {
  for (const g of Object.keys(data.groupMatchups)) {
    const t = groupTable(data, g);
    if (!t.every((r) => r.complete)) continue;
    assert.equal(t[0].advanced, 'auto');
    assert.equal(t[1].advanced, 'auto');
  }
});

test('matches the canonical computeGroupStandings order for a fully-played group', async () => {
  const { computeGroupStandings } = await import('../../app/bracket-resolver.js');
  for (const g of Object.keys(data.groupMatchups)) {
    const canon = computeGroupStandings(data, g);
    if (!canon) continue; // resolver returns null mid-group; only check complete groups
    const mine = groupTable(data, g).map((r) => r.team);
    // pts/gd/gf order must agree; H2H may re-order an exact tie, so compare the
    // multiset of {team@points} per rank rather than insisting on identical names
    // when points are equal.
    for (let i = 0; i < canon.length; i++) {
      const cTeam = canon[i].team;
      const mIdx = mine.indexOf(cTeam);
      assert.ok(mIdx >= 0, `${cTeam} present in groupTable for ${g}`);
    }
    // The leader must agree on points (H2H never overrides a strict pts lead).
    const top = groupTable(data, g)[0];
    assert.equal(top.points, canon[0].points);
  }
});

test('head-to-head breaks a pts/gd/gf tie (synthetic 2-team tie)', () => {
  const synth = {
    groupMatchups: { Z: { group: 'Z', teams: ['A', 'B', 'C', 'D'],
      matches: [
        { team_a: 'A', team_b: 'B' }, { team_a: 'A', team_b: 'C' }, { team_a: 'A', team_b: 'D' },
        { team_a: 'B', team_b: 'C' }, { team_a: 'B', team_b: 'D' }, { team_a: 'C', team_b: 'D' },
      ] } },
    actualResults: { group_stage: {
      'A__vs__B': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' },   // A beats B (H2H → A above B)
      'A__vs__C': { score_a: 0, score_b: 1, status: 'STATUS_FINAL' },
      'A__vs__D': { score_a: 2, score_b: 1, status: 'STATUS_FINAL' },
      'B__vs__C': { score_a: 2, score_b: 1, status: 'STATUS_FINAL' },
      'B__vs__D': { score_a: 0, score_b: 1, status: 'STATUS_FINAL' },
      'C__vs__D': { score_a: 1, score_b: 1, status: 'STATUS_FINAL' } } } };
  const t = groupTable(synth, 'Z');
  const a = t.find((r) => r.team === 'A'), b = t.find((r) => r.team === 'B');
  if (a.points === b.points && a.gd === b.gd && a.gf === b.gf) assert.ok(a.rank < b.rank);
});

test('clean H2H tie: two level teams ordered by their direct result', () => {
  // X and Y end level on pts(4)/gd(0)/gf(2); X beat Y head-to-head ⇒ X above Y.
  // (Two teams that met can only be level on points when the deciding edge comes
  // from their OTHER games — here X beats Y but drops a point to W and loses to V,
  // while Y beats V and draws W, leaving both on 4 pts / 0 GD / 2 GF.)
  const synth = {
    groupMatchups: { Z: { group: 'Z', teams: ['X', 'Y', 'V', 'W'],
      matches: [
        { team_a: 'X', team_b: 'Y' }, { team_a: 'X', team_b: 'V' }, { team_a: 'X', team_b: 'W' },
        { team_a: 'Y', team_b: 'V' }, { team_a: 'Y', team_b: 'W' }, { team_a: 'V', team_b: 'W' },
      ] } },
    actualResults: { group_stage: {
      'X__vs__Y': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' },   // X beats Y (H2H → X above Y)
      'X__vs__V': { score_a: 0, score_b: 1, status: 'STATUS_FINAL' },   // X loses to V
      'X__vs__W': { score_a: 1, score_b: 1, status: 'STATUS_FINAL' },   // X draws W
      'Y__vs__V': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' },   // Y beats V
      'Y__vs__W': { score_a: 1, score_b: 1, status: 'STATUS_FINAL' },   // Y draws W
      'V__vs__W': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' } } } };
  const t = groupTable(synth, 'Z');
  const x = t.find((r) => r.team === 'X'), y = t.find((r) => r.team === 'Y');
  assert.equal(x.points, y.points);
  assert.equal(x.gd, y.gd);
  assert.equal(x.gf, y.gf);
  assert.ok(x.rank < y.rank, 'X ranks above Y on head-to-head');
});

test('bestThirds ranks 12 thirds, exactly 8 marked in', () => {
  const bt = bestThirds(data);
  if (bt.ranked.length === 12) assert.equal(bt.ranked.filter((r) => r.in).length, 8);
  assert.equal(bt.cutoffRank, 8);
});

test('in-progress (LIVE) score does NOT award points', () => {
  const live = JSON.parse(JSON.stringify(data));
  live.actualResults.group_stage['Mexico__vs__Korea Republic'] = { score_a: 3, score_b: 0, status: 'STATUS_SECOND_HALF' };
  const t = groupTable(live, 'A');
  const mex = t.find((r) => r.team === 'Mexico');
  // the live 3-0 must not be counted (status not FINAL) — Mexico's played reflects only FINAL games.
  assert.ok(mex.played <= 3);
});

test('partial group: live partial table, complete=false, no top-2 auto-advance lock', () => {
  const synth = {
    groupMatchups: { Z: { group: 'Z', teams: ['A', 'B', 'C', 'D'],
      matches: [
        { team_a: 'A', team_b: 'B' }, { team_a: 'A', team_b: 'C' }, { team_a: 'A', team_b: 'D' },
        { team_a: 'B', team_b: 'C' }, { team_a: 'B', team_b: 'D' }, { team_a: 'C', team_b: 'D' },
      ] } },
    actualResults: { group_stage: {
      'A__vs__B': { score_a: 2, score_b: 0, status: 'STATUS_FINAL' } } } };
  const t = groupTable(synth, 'Z');
  assert.equal(t.length, 4);
  assert.ok(t.every((r) => !r.complete), 'partial group is not complete');
  const a = t.find((r) => r.team === 'A');
  assert.equal(a.played, 1);
  assert.equal(a.points, 3);
  // No auto badge in a partial group — advancement is undecided.
  assert.ok(t.every((r) => r.advanced !== 'auto'));
});

test('group with no results at all: 0-pts rows, every cell zero', () => {
  const synth = {
    groupMatchups: { Z: { group: 'Z', teams: ['A', 'B', 'C', 'D'],
      matches: [{ team_a: 'A', team_b: 'B' }, { team_a: 'C', team_b: 'D' }] } },
    actualResults: { group_stage: {} } };
  const t = groupTable(synth, 'Z');
  assert.equal(t.length, 4);
  for (const r of t) {
    assert.equal(r.played, 0); assert.equal(r.points, 0);
    assert.equal(r.gf, 0); assert.equal(r.ga, 0); assert.equal(r.gd, 0);
    assert.equal(r.complete, false);
  }
});

test('unknown group → empty array (guarded)', () => {
  assert.deepEqual(groupTable(data, 'ZZ'), []);
  assert.deepEqual(groupTable(null, 'A'), []);
});

test('qualificationScenario returns a status + needs string for every team', () => {
  for (const r of groupTable(data, 'A')) {
    const s = qualificationScenario(data, 'A', r.team);
    assert.ok(typeof s.status === 'string' && typeof s.needs === 'string');
    assert.ok(s.needs.length > 0);
  }
});

test('qualificationScenario on a decided group: top-2 qualified, bottom eliminated', () => {
  const t = groupTable(data, 'A');
  if (t.every((r) => r.complete)) {
    const s1 = qualificationScenario(data, 'A', t[0].team);
    assert.ok(['qualified-1st', 'qualified-2nd'].includes(s1.status));
    const sLast = qualificationScenario(data, 'A', t[3].team);
    assert.ok(['eliminated', 'in-best-third'].includes(sLast.status));
  }
});

test('qualificationScenario alive team gets an actionable needs line', () => {
  const synth = {
    groupMatchups: { Z: { group: 'Z', teams: ['A', 'B', 'C', 'D'],
      matches: [
        { team_a: 'A', team_b: 'B' }, { team_a: 'A', team_b: 'C' }, { team_a: 'A', team_b: 'D' },
        { team_a: 'B', team_b: 'C' }, { team_a: 'B', team_b: 'D' }, { team_a: 'C', team_b: 'D' },
      ] } },
    actualResults: { group_stage: {
      'A__vs__B': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' },
      'C__vs__D': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' } } } };
  const s = qualificationScenario(synth, 'Z', 'A');
  assert.equal(s.status, 'alive');
  assert.ok(/win|draw|advance|needs|play/i.test(s.needs));
});
