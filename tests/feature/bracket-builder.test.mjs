import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveSlotFromUserPicks,
  buildR32Seeding,
  computeRounds,
  getPickFor,
  setPickFor,
  clearDownstream,
  stageOfMatchNumber,
  isStage3Complete,
  getChampion,
  getRunnerUp,
  knockoutWhatsLeft,
  ROUND_LABELS,
  MATCH_RANGES,
} from '../../app/bracket-builder.js';

function loadData() {
  const scheduleFull = JSON.parse(fs.readFileSync('data/schedule_full.json', 'utf8'));
  const groupMatchups = JSON.parse(fs.readFileSync('data/group_matchups.json', 'utf8'));
  const teams = JSON.parse(fs.readFileSync('data/teams.json', 'utf8'));
  return { scheduleFull, groupMatchups, teams };
}

test('stageOfMatchNumber maps the FIFA numbering correctly', () => {
  assert.equal(stageOfMatchNumber(73), 'R32');
  assert.equal(stageOfMatchNumber(88), 'R32');
  assert.equal(stageOfMatchNumber(89), 'R16');
  assert.equal(stageOfMatchNumber(96), 'R16');
  assert.equal(stageOfMatchNumber(97), 'QF');
  assert.equal(stageOfMatchNumber(100), 'QF');
  assert.equal(stageOfMatchNumber(101), 'SF');
  assert.equal(stageOfMatchNumber(102), 'SF');
  assert.equal(stageOfMatchNumber(103), 'ThirdPlace');
  assert.equal(stageOfMatchNumber(104), 'Final');
});

test('resolveSlotFromUserPicks resolves "1A" / "2B" to user picks', () => {
  const userPicks = { groups: { A: ['TeamA1', 'TeamA2', 'TeamA3', 'TeamA4'] } };
  assert.equal(resolveSlotFromUserPicks('1A', userPicks, {}), 'TeamA1');
  assert.equal(resolveSlotFromUserPicks('2A', userPicks, {}), 'TeamA2');
  // No pick → returns the placeholder
  assert.equal(resolveSlotFromUserPicks('1Z', { groups: {} }, {}), '1Z');
});

test('resolveSlotFromUserPicks resolves "3 ABCDF" to first eligible best-third', () => {
  const data = {
    groupMatchups: {
      A: { teams: ['TeamA3'] },
      B: { teams: ['TeamB3'] },
      C: { teams: ['TeamC3'] },
      D: { teams: ['TeamD3'] },
      F: { teams: ['TeamF3'] },
    }
  };
  const picks = { best_thirds: ['TeamC3', 'TeamA3'] };
  assert.equal(resolveSlotFromUserPicks('3 ABCDF', picks, data), 'TeamC3');
  // If none of the best_thirds belong to allowed groups, fallback to placeholder
  const picks2 = { best_thirds: ['TeamH3'] };
  assert.equal(resolveSlotFromUserPicks('3 ABCDF', picks2, data), '3 ABCDF');
});

test('buildR32Seeding emits 16 entries with team_a/team_b resolved when possible', () => {
  const data = loadData();
  data.groupMatchups = Object.fromEntries(
    Object.entries(data.groupMatchups).map(([letter, info]) => [letter, info])
  );
  // Provide a complete fictional user pick set
  const userPicks = { groups: {}, best_thirds: [] };
  for (const [letter, info] of Object.entries(data.groupMatchups)) {
    userPicks.groups[letter] = (info.teams || []).slice(0, 4);
    userPicks.best_thirds.push(info.teams?.[2]);
  }
  userPicks.best_thirds = userPicks.best_thirds.slice(0, 8);
  const r32 = buildR32Seeding(data, { userPicks });
  assert.equal(r32.length, 16);
  // Every entry has real match numbers in [73,88]
  for (const m of r32) {
    assert.ok(m.match_number >= 73 && m.match_number <= 88, `match ${m.match_number} out of range`);
    assert.ok(m.team_a && m.team_b, `m=${m.match_number} missing teams: a=${m.team_a}, b=${m.team_b}`);
  }
});

test('computeRounds creates 5 rounds with halving counts: 16/8/4/2/1', () => {
  const r32 = Array.from({ length: 16 }, (_, i) => ({
    match_number: 73 + i,
    team_a: `A${i}`,
    team_b: `B${i}`,
    kickoff_utc: null,
  }));
  const rounds = computeRounds(r32, { picks: {} });
  assert.equal(rounds.length, 5);
  assert.deepEqual(rounds.map((r) => r.matches.length), [16, 8, 4, 2, 1]);
  assert.deepEqual(rounds.map((r) => r.key), ROUND_LABELS);
});

test('downstream rounds cascade picks correctly', () => {
  const r32 = Array.from({ length: 16 }, (_, i) => ({
    match_number: 73 + i,
    team_a: `A${i}`,
    team_b: `B${i}`,
  }));
  const draft = { picks: {} };
  // Pick A0 in match 73; A1 in 74; … round 1 just picks team_a
  for (let i = 0; i < 16; i++) {
    setPickFor(draft, 73 + i, `A${i}`, { team_a: `A${i}`, team_b: `B${i}` });
  }
  const rounds = computeRounds(r32, draft);
  // R16 has 8 matches with team_a = winners of pair (0,1), (2,3)…
  assert.equal(rounds[1].matches[0].team_a, 'A0');
  assert.equal(rounds[1].matches[0].team_b, 'A1');
  // Now pick the R16 to cascade to QF
  setPickFor(draft, 89, 'A0', { team_a: 'A0', team_b: 'A1' });
  const r2 = computeRounds(r32, draft);
  assert.equal(r2[2].matches[0].team_a, 'A0');
});

test('clearDownstream wipes only later-round picks', () => {
  const draft = { picks: {} };
  setPickFor(draft, 73, 'TeamX'); // R32
  setPickFor(draft, 89, 'TeamX'); // R16
  setPickFor(draft, 97, 'TeamX'); // QF
  setPickFor(draft, 104, 'TeamX'); // Final
  // Change an R32 pick → all later rounds cleared
  clearDownstream(draft, 73);
  assert.equal(getPickFor(draft, 73), 'TeamX');  // R32 itself untouched
  assert.equal(getPickFor(draft, 89), null);
  assert.equal(getPickFor(draft, 97), null);
  assert.equal(getPickFor(draft, 104), null);
});

test('isStage3Complete requires every match in every round picked', () => {
  const r32 = Array.from({ length: 16 }, (_, i) => ({
    match_number: 73 + i, team_a: `A${i}`, team_b: `B${i}`,
  }));
  const draft = { picks: {} };
  // Empty draft → not complete
  let rounds = computeRounds(r32, draft);
  assert.equal(isStage3Complete(rounds), false);
  // Fill every match through to the Final
  for (let mn = 73; mn <= 88; mn++) setPickFor(draft, mn, `pickR32_${mn}`);
  for (let mn = 89; mn <= 96; mn++) setPickFor(draft, mn, `pickR16_${mn}`);
  for (let mn = 97; mn <= 100; mn++) setPickFor(draft, mn, `pickQF_${mn}`);
  for (let mn = 101; mn <= 102; mn++) setPickFor(draft, mn, `pickSF_${mn}`);
  setPickFor(draft, 104, 'Champion');
  rounds = computeRounds(r32, draft);
  assert.equal(isStage3Complete(rounds), true);
});

test('getChampion + getRunnerUp pull from the final match', () => {
  const r32 = Array.from({ length: 16 }, (_, i) => ({
    match_number: 73 + i, team_a: `A${i}`, team_b: `B${i}`,
  }));
  const draft = { picks: {} };
  for (let mn = 73; mn <= 88; mn++) setPickFor(draft, mn, `A${mn-73}`, { team_a: `A${mn-73}`, team_b: `B${mn-73}` });
  for (let mn = 89; mn <= 96; mn++) setPickFor(draft, mn, `A${(mn-89)*2}`, { team_a: `A${(mn-89)*2}`, team_b: `A${(mn-89)*2+1}` });
  for (let mn = 97; mn <= 100; mn++) setPickFor(draft, mn, `A${(mn-97)*4}`, { team_a: `A${(mn-97)*4}`, team_b: `A${(mn-97)*4+2}` });
  for (let mn = 101; mn <= 102; mn++) setPickFor(draft, mn, `A${(mn-101)*8}`, { team_a: `A${(mn-101)*8}`, team_b: `A${(mn-101)*8+4}` });
  setPickFor(draft, 104, 'A0', { team_a: 'A0', team_b: 'A8' });
  const rounds = computeRounds(r32, draft);
  assert.equal(getChampion(rounds), 'A0');
  assert.equal(getRunnerUp(rounds), 'A8');
});

test('knockoutWhatsLeft lists missing rounds + 3rd-place game', () => {
  const r32 = Array.from({ length: 16 }, (_, i) => ({
    match_number: 73 + i, team_a: `A${i}`, team_b: `B${i}`,
  }));
  const rounds = computeRounds(r32, { picks: {} });
  const left = knockoutWhatsLeft(rounds, { picks: {} });
  assert.ok(left.some((s) => s.includes('R32: 0/16')));
  assert.ok(left.some((s) => s.includes('3rd-place game')));
});

test('MATCH_RANGES covers the full knockout numbering with no gaps', () => {
  assert.deepEqual(MATCH_RANGES.R32, { min: 73, max: 88 });
  assert.deepEqual(MATCH_RANGES.R16, { min: 89, max: 96 });
  assert.deepEqual(MATCH_RANGES.QF, { min: 97, max: 100 });
  assert.deepEqual(MATCH_RANGES.SF, { min: 101, max: 102 });
  assert.deepEqual(MATCH_RANGES.Final, { min: 104, max: 104 });
});

test('R7: buildR32Seeding never assigns the same best-third to multiple slots', async () => {
  const fs = await import('node:fs');
  const scheduleFull = JSON.parse(fs.readFileSync('data/schedule_full.json', 'utf8'));
  const groupMatchups = JSON.parse(fs.readFileSync('data/group_matchups.json', 'utf8'));
  const data = { scheduleFull, groupMatchups };
  // Build a complete user pick set.
  const userPicks = { groups: {}, best_thirds: [] };
  for (const [letter, info] of Object.entries(data.groupMatchups)) {
    userPicks.groups[letter] = (info.teams || []).slice(0, 4);
    userPicks.best_thirds.push(info.teams?.[2]);
  }
  userPicks.best_thirds = userPicks.best_thirds.slice(0, 8);

  const r32 = buildR32Seeding(data, { userPicks });
  // Collect every team appearing in any R32 slot
  const teamCounts = {};
  for (const m of r32) {
    for (const t of [m.team_a, m.team_b]) {
      if (typeof t !== 'string') continue;
      if (/^\d[A-L]$|^3 [A-L]+$/.test(t)) continue; // skip unresolved placeholders
      teamCounts[t] = (teamCounts[t] || 0) + 1;
    }
  }
  // No team should appear more than once across R32
  const dupes = Object.entries(teamCounts).filter(([, n]) => n > 1);
  assert.deepEqual(dupes, [], `Duplicate R32 assignments: ${JSON.stringify(dupes)}`);
  // And every one of the 8 best_thirds (assuming groups are properly placed)
  // appears at most once in R32 — at least one should appear though
  const thirdsInR32 = userPicks.best_thirds.filter((t) => teamCounts[t]);
  assert.ok(thirdsInR32.length > 0, 'No best_thirds appeared in R32 — placement regressed');
});

test('R7: resolveSlotFromUserPicks honors usedThirds set across multiple calls', () => {
  const data = {
    groupMatchups: {
      A: { teams: ['A3'] }, B: { teams: ['B3'] }, C: { teams: ['C3'] },
    },
  };
  const picks = { best_thirds: ['A3', 'B3', 'C3'] };
  const used = new Set();
  // Slot "3 ABC" should pick A3 (first eligible) and mark it used
  const first = resolveSlotFromUserPicks('3 ABC', picks, data, used);
  assert.equal(first, 'A3');
  // Next call with same allowed set should pick B3 (A3 already used)
  const second = resolveSlotFromUserPicks('3 ABC', picks, data, used);
  assert.equal(second, 'B3');
  // Third call should pick C3
  const third = resolveSlotFromUserPicks('3 ABC', picks, data, used);
  assert.equal(third, 'C3');
  // Fourth call (nothing left) returns placeholder
  const fourth = resolveSlotFromUserPicks('3 ABC', picks, data, used);
  assert.equal(fourth, '3 ABC');
});
