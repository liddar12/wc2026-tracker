import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidJoinCode, deriveLockState, computeBasePath, extractJoinCodeFromPath, buildPostJoinPath } from '../app/competition-rules.js';
import { normalizeSignInIdentifier } from '../app/competition-auth.js';
import {
  normalizeBracketPicks,
  normalizeKnockoutPicks,
  scoreBracket,
  scoreBracketWeighted,
  compareLeaderboardEntries,
  WEIGHTED_ROUND_POINTS,
  CHAMPION_BONUS,
  MAX_WEIGHTED_SCORE
} from '../app/competition-scoring.js';

assert.equal(isValidJoinCode('silver-otter-4821'), true, 'valid join code should pass');
assert.equal(isValidJoinCode('Silver-Otter-4821'), true, 'mixed case should normalize');
assert.equal(isValidJoinCode('silverotter4821'), false, 'missing separators should fail');
assert.equal(isValidJoinCode('silver-otter-821'), false, 'suffix must be 4 digits');

const schedule = [
  { stage: 'group', kickoff_utc: '2026-06-11T16:00:00Z' },
  { stage: 'group', kickoff_utc: '2026-06-20T16:00:00Z' },
  { stage: 'r32', kickoff_utc: '2026-06-28T16:00:00Z' }
];

const pre = deriveLockState(schedule, Date.parse('2026-06-10T16:00:00Z'));
assert.equal(pre.phase, 'pre-tournament');
assert.equal(pre.bracketLocked, false);

const duringGroup = deriveLockState(schedule, Date.parse('2026-06-11T17:00:00Z'));
assert.equal(duringGroup.phase, 'group-stage-live');
assert.equal(duringGroup.bracketLocked, true);

const between = deriveLockState(schedule, Date.parse('2026-06-21T17:00:00Z'));
assert.equal(between.phase, 'between-group-and-r32');
assert.equal(between.bracketLocked, false);

const duringR32 = deriveLockState(schedule, Date.parse('2026-06-28T17:00:00Z'));
assert.equal(duringR32.phase, 'r32-live');
assert.equal(duringR32.bracketLocked, true);

const boundaryUnlock = deriveLockState(schedule, Date.parse('2026-06-20T18:00:00Z'));
assert.equal(boundaryUnlock.phase, 'group-stage-live');
assert.equal(boundaryUnlock.bracketLocked, true);

const oneMsAfterUnlock = deriveLockState(schedule, Date.parse('2026-06-20T18:00:00.001Z'));
assert.equal(oneMsAfterUnlock.phase, 'between-group-and-r32');
assert.equal(oneMsAfterUnlock.bracketLocked, false);

const atR32Kickoff = deriveLockState(schedule, Date.parse('2026-06-28T16:00:00Z'));
assert.equal(atR32Kickoff.phase, 'r32-live');
assert.equal(atR32Kickoff.bracketLocked, true);

const signInByUsername = normalizeSignInIdentifier('Tracker_User');
assert.equal(signInByUsername.email, 'tracker_user@wc26.app');
assert.equal(signInByUsername.inferredUsername, 'tracker_user');

const signInByEmail = normalizeSignInIdentifier('liddar@gmail.com');
assert.equal(signInByEmail.email, 'liddar@gmail.com');
assert.equal(signInByEmail.inferredUsername, 'liddar');

const signInByTrimmedUsername = normalizeSignInIdentifier('  Tracker_User  ');
assert.equal(signInByTrimmedUsername.email, 'tracker_user@wc26.app');
assert.equal(signInByTrimmedUsername.inferredUsername, 'tracker_user');

assert.throws(() => normalizeSignInIdentifier('ab'), /3-20 chars/i);
assert.throws(() => normalizeSignInIdentifier('bad email@foo'), /valid email address/i);
assert.throws(() => normalizeSignInIdentifier(''), /username or email/i);

assert.equal(computeBasePath('/join/silver-otter-4821'), '/');
assert.equal(computeBasePath('/wc2026-tracker/join/silver-otter-4821'), '/wc2026-tracker/');
assert.equal(computeBasePath('/wc2026-tracker'), '/wc2026-tracker/');
assert.equal(computeBasePath('/index.html'), '/');
assert.equal(computeBasePath('/wc2026-tracker/index.html'), '/wc2026-tracker/');
assert.equal(extractJoinCodeFromPath('/join/silver-otter-4821'), 'silver-otter-4821');
assert.equal(extractJoinCodeFromPath('/join/Silver-Otter-4821'), 'silver-otter-4821');
assert.equal(extractJoinCodeFromPath('/wc2026-tracker/join/silver-otter-4821'), 'silver-otter-4821');
assert.equal(extractJoinCodeFromPath('/join/not-a-valid-code'), null);
assert.equal(extractJoinCodeFromPath('/join/silver-otter-821'), null);
assert.equal(extractJoinCodeFromPath('/join/'), null);
assert.equal(extractJoinCodeFromPath('/wc2026-tracker/picks'), null);
assert.equal(buildPostJoinPath('/join/silver-otter-4821', ''), '/#/picks');
assert.equal(buildPostJoinPath('/wc2026-tracker/join/silver-otter-4821', '#/bracket'), '/wc2026-tracker/#/bracket');

const normalizedPicks = normalizeBracketPicks([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' },
  { team_a: 'Beta', team_b: 'Alpha', choice: 'team_b' },
  { team_a: 'Gamma', team_b: 'Delta', choice: 'draw' },
  { team_a: 'Gamma', team_b: 'Gamma', choice: 'team_a' },
  { team_a: '  ', team_b: 'Omega', choice: 'team_a' },
  { team_a: 'Eta', team_b: 'Theta', choice: 'invalid' }
]);
assert.deepEqual(normalizedPicks, [
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' },
  { team_a: 'Gamma', team_b: 'Delta', choice: 'draw' }
]);

const score = scoreBracket([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' },
  { team_a: 'Beta', team_b: 'Alpha', choice: 'team_b' },
  { team_a: 'Gamma', team_b: 'Delta', choice: 'draw' }
], {
  actualResults: {
    group_stage: {
      Alpha__vs__Beta: { score_a: 2, score_b: 1 },
      Delta__vs__Gamma: { score_a: 1, score_b: 1 }
    }
  }
});
assert.equal(score, 2, 'duplicate picks must not inflate bracket score');

// BKT-021: knockout submissions must reject choice='draw' (draws are not valid
// outcomes in a knockout bracket) while still stripping invalid/duplicate picks.
const knockoutPicks = normalizeKnockoutPicks([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' },
  { team_a: 'Gamma', team_b: 'Delta', choice: 'draw' },
  { team_a: 'Beta', team_b: 'Alpha', choice: 'team_b' },
  { team_a: 'Eta', team_b: 'Theta', choice: 'team_b' }
]);
assert.deepEqual(knockoutPicks, [
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' },
  { team_a: 'Eta', team_b: 'Theta', choice: 'team_b' }
], 'knockout picks must drop draws and de-duplicated pairs');
assert.equal(
  normalizeKnockoutPicks([{ team_a: 'Gamma', team_b: 'Delta', choice: 'draw' }]).length,
  0,
  'a draw-only bracket has no submittable knockout picks'
);
// normalizeBracketPicks (used for scoring) must still keep draws unchanged.
assert.equal(
  normalizeBracketPicks([{ team_a: 'Gamma', team_b: 'Delta', choice: 'draw' }]).length,
  1,
  'scoring normalizer must preserve draws'
);

// BKT-004: bracket submit must upsert on (group_id,user_id), not insert-only,
// so a player can edit and re-submit their bracket while it is unlocked.
const competitionSrc = readFileSync(new URL('../app/competition.js', import.meta.url), 'utf8');
assert.match(
  competitionSrc,
  /from\('group_brackets'\)\s*\.upsert\(/,
  'saveBracketForActiveGroup must upsert into group_brackets (not insert-only)'
);
assert.match(
  competitionSrc,
  /onConflict:\s*'group_id,user_id'/,
  'group_brackets upsert must target the (group_id,user_id) primary key'
);
assert.match(
  competitionSrc,
  /normalizeKnockoutPicks\(resolveSelectedDraftPicks\(\)\)/,
  'submit path must normalize via the knockout normalizer that rejects draws'
);

const migrationSql = readFileSync(new URL('../supabase/migrations/20260527_auth_groups_brackets.sql', import.meta.url), 'utf8');
assert.match(
  migrationSql,
  /create policy "group_brackets_insert_self"[\s\S]+exists\s*\([\s\S]+public\.group_members gm[\s\S]+gm\.group_id = group_brackets\.group_id and gm\.user_id = auth\.uid\(\)/i
);
assert.match(
  migrationSql,
  /create policy "group_brackets_update_self"[\s\S]+exists\s*\([\s\S]+public\.group_members gm[\s\S]+gm\.group_id = group_brackets\.group_id and gm\.user_id = auth\.uid\(\)/i
);

const passphraseMigrationSql = readFileSync(new URL('../supabase/migrations/20260528_group_passphrase_secure_flow.sql', import.meta.url), 'utf8');
assert.match(
  passphraseMigrationSql,
  /create or replace function public\.create_private_group\(p_name text, p_code text, p_passphrase text\)/i
);
assert.match(
  passphraseMigrationSql,
  /crypt\(trim\(p_passphrase\), gen_salt\('bf'\)\)/i
);
assert.match(
  passphraseMigrationSql,
  /create or replace function public\.join_group_by_code\(p_code text, p_passphrase text default null\)/i
);
assert.match(
  passphraseMigrationSql,
  /if crypt\(trim\(p_passphrase\), v_group\.passphrase_hash\) <> v_group\.passphrase_hash then/i
);

// BKT-008 / BKT-009 / BKT-022: weighted scoring + tie-breakers.
assert.equal(WEIGHTED_ROUND_POINTS.R32, 1);
assert.equal(WEIGHTED_ROUND_POINTS.R16, 2);
assert.equal(WEIGHTED_ROUND_POINTS.QF, 4);
assert.equal(WEIGHTED_ROUND_POINTS.SF, 8);
assert.equal(WEIGHTED_ROUND_POINTS.Final, 16);
assert.equal(CHAMPION_BONUS, 16);
assert.equal(MAX_WEIGHTED_SCORE, 96, 'max weighted score should sum to 96');

const weightedFixture = {
  actualResults: {
    round_of_32: {
      Alpha__vs__Beta:    { score_a: 2, score_b: 1 }, // Alpha advances
      Gamma__vs__Delta:   { score_a: 0, score_b: 3 }  // Delta advances
    },
    round_of_16: {
      Alpha__vs__Delta: { score_a: 3, score_b: 1 } // Alpha advances
    },
    quarterfinals: {
      Alpha__vs__Echo: { score_a: 2, score_b: 0 } // Alpha advances
    },
    semifinals: {
      Alpha__vs__Foxtrot: { score_a: 1, score_b: 0 } // Alpha advances
    },
    final: {
      Alpha__vs__Golf: { score_a: 1, score_b: 0 } // Alpha wins (champion)
    }
  }
};

const allCorrect = scoreBracketWeighted([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' },
  { team_a: 'Gamma', team_b: 'Delta', choice: 'team_b' },
  { team_a: 'Alpha', team_b: 'Delta', choice: 'team_a' },
  { team_a: 'Alpha', team_b: 'Echo', choice: 'team_a' },
  { team_a: 'Alpha', team_b: 'Foxtrot', choice: 'team_a' },
  { team_a: 'Alpha', team_b: 'Golf', choice: 'team_a' }
], weightedFixture);
// R32 right twice = 2pts; R16 right = 2pts; QF right = 4pts; SF right = 8pts;
// Final right = 16pts + champion bonus 16pts = 32pts. Total = 2+2+4+8+32 = 48pts.
assert.equal(allCorrect.score, 48);
assert.equal(allCorrect.lastRoundCorrect, 'Final');
assert.equal(allCorrect.championCorrect, true);
assert.equal(allCorrect.breakdown.R32, 2);
assert.equal(allCorrect.breakdown.Final, 16);
assert.equal(allCorrect.breakdown.championBonus, 16);

// scoreBracket (flat legacy scorer) returns +1 per correct pick — unchanged.
assert.equal(scoreBracket([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' }
], weightedFixture), 1, 'flat scoreBracket returns +1 per correct pick');

// BKT-bug-fix: a knockout-stage pen-shootout winner (regulation tie) must
// still score points when the user picked the team that won on penalties.
const penFixture = {
  actualResults: {
    round_of_16: {
      Alpha__vs__Beta: { score_a: 1, score_b: 1, winner: 'Alpha' } // pens to Alpha
    }
  }
};
const penPick = scoreBracketWeighted([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' }
], penFixture);
assert.equal(penPick.score, 2, 'pen-shootout winner should score R16=2pts via rec.winner');
const penWrong = scoreBracketWeighted([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_b' }
], penFixture);
assert.equal(penWrong.score, 0, 'picking the pen-shootout loser should not score');

// Score with stringified numeric scores (some scrapers ship strings) should still resolve.
const stringScoreFixture = {
  actualResults: {
    round_of_32: { Alpha__vs__Beta: { score_a: '2', score_b: '1' } }
  }
};
const stringScored = scoreBracketWeighted([
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' }
], stringScoreFixture);
assert.equal(stringScored.score, 1, 'stringified scores should coerce to numbers');

// lastRoundCorrect should be the deepest stage with a correct pick, regardless of pick order.
const deepFixture = {
  actualResults: {
    round_of_32: { Alpha__vs__Beta: { score_a: 1, score_b: 0 } },
    final: { Alpha__vs__Zulu: { score_a: 2, score_b: 0 } }
  }
};
const deepResult = scoreBracketWeighted([
  { team_a: 'Alpha', team_b: 'Zulu', choice: 'team_a' }, // Final pick first
  { team_a: 'Alpha', team_b: 'Beta', choice: 'team_a' }  // R32 pick second
], deepFixture);
assert.equal(deepResult.lastRoundCorrect, 'Final', 'deepest correct round wins regardless of pick order');

// Tie-breakers
const sorted = [
  { username: 'a', score: 30, lastRoundCorrect: 'SF', championCorrect: false, updatedAt: '2026-07-01T10:00:00Z' },
  { username: 'b', score: 30, lastRoundCorrect: 'Final', championCorrect: true,  updatedAt: '2026-07-01T11:00:00Z' },
  { username: 'c', score: 30, lastRoundCorrect: 'Final', championCorrect: true,  updatedAt: '2026-07-01T09:00:00Z' }
].sort(compareLeaderboardEntries);
assert.equal(sorted[0].username, 'c', 'champion-correct + earliest submit wins ties');
assert.equal(sorted[1].username, 'b');
assert.equal(sorted[2].username, 'a');

console.log('competition tests: OK');
