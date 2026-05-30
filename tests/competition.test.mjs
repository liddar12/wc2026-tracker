import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidJoinCode, deriveLockState, computeBasePath, extractJoinCodeFromPath, buildPostJoinPath } from '../app/competition-rules.js';
import { normalizeSignInIdentifier } from '../app/competition-auth.js';
import { normalizeBracketPicks, normalizeKnockoutPicks, scoreBracket } from '../app/competition-scoring.js';

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

console.log('competition tests: OK');
