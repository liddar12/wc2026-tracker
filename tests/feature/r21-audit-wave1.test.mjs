/* r21-audit-wave1.test.mjs — regression locks for the June-11 audit fixes:
   1) scoring must ignore IN-PROGRESS live results (status-gating)
   2) KO rematch of a group pairing scores the knockout round (tier order)
   3) gap-window submit: group-save gates on groupsLocked; play funnel skips it
   4) live_update no longer runs the legacy conflicting results writer
   5) cron push race hardening + daily kalshi-before-models ordering
   6) hot-picks queries the real `picks` column
   7) version purge no longer deletes in-use draft keys
   8) invite links land on Pools */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreBracketWeighted } from '../../app/competition-scoring.js';
import { computeGroupStandings, lookupActual } from '../../app/bracket-resolver.js';
import { buildPostJoinPath } from '../../app/competition-rules.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('scoring ignores in-progress records; counts them once final', () => {
  const picks = [{ team_a: 'Spain', team_b: 'France', choice: 'team_a' }];
  const live = {
    actualResults: { round_of_16: { 'Spain__vs__France': { score_a: 1, score_b: 0, status: 'STATUS_IN_PROGRESS' } } },
  };
  assert.equal(scoreBracketWeighted(picks, live).score, 0, 'halftime 1-0 must not score');
  const done = {
    actualResults: { round_of_16: { 'Spain__vs__France': { score_a: 1, score_b: 0, status: 'STATUS_FULL_TIME' } } },
  };
  assert.equal(scoreBracketWeighted(picks, done).score, 2, 'final 1-0 scores R16 points');
  // records without a status field (manual/legacy) still count as final
  const legacy = { actualResults: { round_of_16: { 'Spain__vs__France': { score_a: 1, score_b: 0 } } } };
  assert.equal(scoreBracketWeighted(picks, legacy).score, 2);
});

test('KO rematch of a group-stage pairing scores the knockout occurrence', () => {
  const picks = [{ team_a: 'Mexico', team_b: 'Korea Republic', choice: 'team_a' }];
  const data = {
    actualResults: {
      group_stage: { 'Mexico__vs__Korea Republic': { score_a: 0, score_b: 1, status: 'STATUS_FULL_TIME' } },
      round_of_32: { 'Mexico__vs__Korea Republic': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' } },
    },
  };
  const res = scoreBracketWeighted(picks, data);
  assert.equal(res.score, 1, 'scores the R32 rematch (1pt), not 0 via the group record');
});

test('group standings: in-progress match does not count as played', () => {
  const gm = { A: { teams: ['X', 'Y'], matches: [{ team_a: 'X', team_b: 'Y' }] } };
  const inProgress = {
    groupMatchups: gm,
    actualResults: { group_stage: { 'X__vs__Y': { score_a: 1, score_b: 0, status: 'STATUS_IN_PROGRESS' } } },
  };
  assert.equal(computeGroupStandings(inProgress, 'A'), null, 'half-played group is not complete');
  const final = {
    groupMatchups: gm,
    actualResults: { group_stage: { 'X__vs__Y': { score_a: 1, score_b: 0, status: 'STATUS_FINAL' } } },
  };
  assert.equal(computeGroupStandings(final, 'A')[0].team, 'X');
});

test('lookupActual: live score visible but no winner until final', () => {
  const mid = { actualResults: { round_of_16: { 'A__vs__B': { score_a: 2, score_b: 0, status: 'STATUS_IN_PROGRESS' } } } };
  const r = lookupActual(mid, 'round_of_16', 'A', 'B');
  assert.equal(r.score_a, 2, 'live score still surfaces');
  assert.equal(r.winner, null, 'no winner mid-match (no premature advancement)');
  const done = { actualResults: { round_of_16: { 'A__vs__B': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' } } } };
  assert.equal(lookupActual(done, 'round_of_16', 'A', 'B').winner, 'A');
});

test('gap-window submit: group save gates on groupsLocked; funnel skips it', () => {
  const comp = read('app/competition.js');
  assert.match(comp, /saveGroupPredictionsForActiveGroup[\s\S]{0,600}lockState\.groupsLocked/, 'gates on groupsLocked');
  const play = read('app/views/play-view.js');
  assert.match(play, /lockState\?\.groupsLocked/, 'play funnel checks groupsLocked');
  assert.match(play, /fetchMyGroupPredictions/, 'keeps stored group score when skipping');
});

test('live_update: legacy update_results writer removed (single results writer)', () => {
  const y = read('.github/workflows/live_update.yml');
  // No RUN invocation of the legacy writer (an explanatory comment may still
  // name the file).
  assert.ok(!/run:\s*python\s+scripts\/update_results\.py/.test(y), 'update_results.py no longer runs');
  assert.match(y, /scrape_live_results\.py/, 'scrape_live_results remains');
});

test('cron workflows: push retry + correct daily ordering', () => {
  for (const wf of ['daily_update', 'frequent_update', 'live_update', 'pre_kickoff_update']) {
    const y = read(`.github/workflows/${wf}.yml`);
    assert.match(y, /until git push/, `${wf} retries pushes`);
    assert.match(y, /git pull --rebase/, `${wf} rebases on race`);
  }
  const daily = read('.github/workflows/daily_update.yml');
  assert.ok(
    daily.indexOf('scrape_kalshi.py') < daily.indexOf('build_dt_model.py'),
    'daily scrapes Kalshi BEFORE the model rebuilds'
  );
  const freq = read('.github/workflows/frequent_update.yml');
  assert.match(freq, /only if data changed/i, 'hourly version bump is conditional');
});

test('hot-picks queries the real picks column', () => {
  const v = read('app/views/hot-picks-view.js');
  assert.ok(!v.includes("select('payload')"), 'no nonexistent payload column');
  assert.match(v, /select\('picks'\)/, 'selects picks');
});

test('version purge keeps in-use draft keys', () => {
  const v = read('app/lib/version-purge.js');
  assert.ok(!/LEGACY_KEYS = \[[^\]]*bracketDrafts/.test(v), 'bracketDrafts not purged');
  assert.ok(!/LEGACY_KEYS = \[[^\]]*activeDraft/.test(v), 'activeDraft not purged');
});

test('invite links land on Pools', () => {
  assert.ok(buildPostJoinPath('/join/abc123', '').endsWith('#/pools'));
  const main = read('app/main.js');
  assert.match(main, /shouldOpenPicksForJoin\(\)\)\s*\{[^}]*setRoute\('pools'/, 'boot redirect goes to pools');
});

test('actualForCard: oriented scores, scheduled stubs excluded, mode from status', async () => {
  const { actualForCard } = await import('../../app/components/large-match-card.js');
  const ar = {
    group_stage: {
      'Mexico__vs__South Africa': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' },
      'USA__vs__Paraguay': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED' },
      'Spain__vs__France': { score_a: 1, score_b: 0, status: 'STATUS_IN_PROGRESS' },
    },
  };
  const fin = actualForCard(ar, { stage: 'group', team_a: 'Mexico', team_b: 'South Africa' });
  assert.deepEqual(fin.actual, { score_a: 2, score_b: 0 });
  assert.equal(fin.mode, 'final');
  const flip = actualForCard(ar, { stage: 'group', team_a: 'South Africa', team_b: 'Mexico' });
  assert.deepEqual(flip.actual, { score_a: 0, score_b: 2 });
  assert.equal(actualForCard(ar, { stage: 'group', team_a: 'USA', team_b: 'Paraguay' }), null, 'scheduled stub excluded');
  const live = actualForCard(ar, { stage: 'group', team_a: 'Spain', team_b: 'France' });
  assert.equal(live.mode, 'live');
});
