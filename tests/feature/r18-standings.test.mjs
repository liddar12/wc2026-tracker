import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { combineLeaderboardEntries } from '../../app/leaderboard-core.js';

const deps = {
  scoreBracketWeighted: (p) => ({ score: p?.k || 0, breakdown: {}, lastRoundCorrect: false, championCorrect: false }),
  scoreGroupPredictions: (p) => ({ score: p?.g || 0 }),
};

test('R18: standings carry a 1-based place (rank) in score order', () => {
  const out = combineLeaderboardEntries(
    [{ user_id: 'u1', picks: { k: 30 } }, { user_id: 'u2', picks: { k: 90 } }, { user_id: 'u3', picks: { k: 60 } }],
    [],
    { u1: 'A', u2: 'B', u3: 'C' }, null, deps,
  );
  assert.equal(out[0].username, 'B'); assert.equal(out[0].rank, 1);
  assert.equal(out[1].username, 'C'); assert.equal(out[1].rank, 2);
  assert.equal(out[2].username, 'A'); assert.equal(out[2].rank, 3);
});

test('R18: tapping a pool routes to the standings view (not my-brackets)', () => {
  const pools = readFileSync('app/views/pools-view.js', 'utf8');
  assert.match(pools, /setRoute\('standings',\s*\{\s*id:[^}]*code:[^}]*\}\)/, 'Discover tap → standings (with code)');
  assert.match(pools, /setRoute\('standings',\s*\{\s*id:[^}]*\}\)/, 'My Pools tap → standings');
  // the old destination is gone from the pool-tap handlers
  assert.doesNotMatch(pools, /myIds\.has\(id\)[\s\S]{0,80}my-brackets/, 'no member→my-brackets dead-end on tap');
});

test('R18: standings route is registered + nav-highlights Pools', () => {
  const main = readFileSync('app/main.js', 'utf8');
  assert.match(main, /case 'standings':\s*renderPoolStandingsView/, 'standings route registered');
  assert.match(main, /standings:\s*'pools'/, 'standings highlights the Pools tab');
});

test('R18: standings view handles signed-out, member, and non-member states', () => {
  const v = readFileSync('app/views/pool-standings-view.js', 'utf8');
  assert.match(v, /Sign in to view/i, 'signed-out state');
  assert.match(v, /Join .* to see its standings|Join \$\{|to see its standings/i, 'non-member join CTA');
  assert.match(v, /fetchLeaderboard\(data,\s*\{\s*groupId/, 'member state fetches by groupId');
});
