import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dtRatingsByTeam, dtRating, dtWinner, dtAppTeamName, DT_NAME_MAP } from '../../app/lib/dt-model.js';
import { teamAnalytics, rankTeamsByModel } from '../../app/lib/team-analytics.js';

const dtModel = JSON.parse(readFileSync('data/dt_model.json', 'utf8'));
const data = { dtModel };

test('R16 DT: name map bridges DT country names to app team keys', () => {
  assert.equal(dtAppTeamName('South Korea'), 'Korea Republic');
  assert.equal(dtAppTeamName('Turkey'), 'Turkiye');
  assert.equal(dtAppTeamName('United States'), 'USA');
  assert.equal(dtAppTeamName('Czech Republic'), 'Czechia');
  assert.equal(dtAppTeamName('Spain'), 'Spain'); // unmapped passes through
});

test('R16 DT: every DT name maps to a real teams.json key', () => {
  const teamKeys = new Set(Object.keys(JSON.parse(readFileSync('data/teams.json', 'utf8'))));
  const unmatched = (dtModel.team_rankings || [])
    .map((r) => dtAppTeamName(r.country))
    .filter((name) => !teamKeys.has(name));
  assert.deepEqual(unmatched, [], `DT names with no teams.json match: ${unmatched.join(', ')}`);
});

test('R16 DT: ratings lookup keyed by app team name', () => {
  const map = dtRatingsByTeam(data);
  assert.ok(map.Spain, 'Spain present');
  assert.equal(typeof map.Spain.rating, 'number');
  assert.ok(map.Spain.rating > 0);
  // DT JSON country "South Korea" must be reachable under the app key.
  assert.ok(map['Korea Republic'], 'mapped key present');
  assert.equal(dtRating(data, 'Spain') > 0, true);
  assert.equal(dtRating(data, 'NotATeam'), 0, 'unknown team → 0');
});

test('R16 DT: winner = higher rating; unknown teams fall to 0 (team_a on tie)', () => {
  const map = dtRatingsByTeam(data);
  // Find two teams with different ratings.
  const [t1, t2] = Object.entries(map).sort((a, b) => b[1].rating - a[1].rating);
  assert.equal(dtWinner(data, t1[0], t2[0]), t1[0], 'higher-rated wins');
  assert.equal(dtWinner(data, t2[0], t1[0]), t1[0], 'order-independent');
  assert.equal(dtWinner(data, 'NoTeamA', 'NoTeamB'), 'NoTeamA', 'both unknown → tie → team_a');
});

test('R16 DT: teamAnalytics surfaces DT rating + title odds', () => {
  // Use a known top team from the model.
  const top = dtModel.team_rankings[0];
  const appName = dtAppTeamName(top.country);
  const a = teamAnalytics(appName, { ...data, teams: {} }, 'dt');
  assert.equal(a.primary.label, 'DT');
  assert.notEqual(a.primary.value, '—', 'has a rating value');
  assert.equal(a.dtRating > 0, true);
});

test('R16 DT: rankTeamsByModel("dt") orders by DT rating', () => {
  const rows = dtModel.team_rankings.slice(0, 5).map((r) => dtAppTeamName(r.country));
  const ranked = rankTeamsByModel(rows, data, 'dt');
  // dt_model.team_rankings is already sorted by rank/rating desc, so the top-5
  // app names should come back in the same order.
  assert.deepEqual(ranked, rows);
});

test('R16 DT: model JSON has the site-contract shape', () => {
  assert.equal(dtModel.model?.id, 'dt_model');
  assert.ok(Array.isArray(dtModel.team_rankings) && dtModel.team_rankings.length >= 40);
  assert.ok('title_prob' in dtModel.team_rankings[0]);
});
