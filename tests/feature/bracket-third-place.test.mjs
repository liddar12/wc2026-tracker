import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSlots, projectWinner, STAGE_ORDER } from '../../app/bracket-resolver.js';
import { flagFor } from '../../app/components/team-flag.js';
import { englishName } from '../../app/lib/team-names.js';

const root = new URL('../../', import.meta.url);
const J = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

function projectedBracket() {
  const data = {
    scheduleFull: J('data/schedule_full.json'),
    groupMatchups: J('data/group_matchups.json'),
    teams: J('data/teams.json'),
    actualResults: J('data/actual_results.json'),
  };
  const knockouts = data.scheduleFull
    .filter((m) => STAGE_ORDER.includes(m.stage))
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  resolveSlots(knockouts, data, { winnerResolver: ({ team_a, team_b }) => projectWinner(data, team_a, team_b) });
  return knockouts;
}

const isPlaceholder = (t) => !t || /^\d[A-L]$|^3 |^W\d|^L\d/.test(t);

test('R32 third-place dedup: no team fills more than one slot', () => {
  const ko = projectedBracket();
  const r32 = ko.filter((m) => m.stage === 'round_of_32');
  const teams = r32.flatMap((m) => [m.resolved_team_a, m.resolved_team_b]).filter((t) => !isPlaceholder(t));
  const counts = {};
  for (const t of teams) counts[t] = (counts[t] || 0) + 1;
  const dups = Object.entries(counts).filter(([, c]) => c > 1);
  assert.deepEqual(dups, [], `no team should appear in >1 R32 slot, got ${JSON.stringify(dups)}`);
  // and specifically the reported team
  const civ = r32.filter((m) => m.resolved_team_a === "Cote d'Ivoire" || m.resolved_team_b === "Cote d'Ivoire");
  assert.ok(civ.length <= 1, `Cote d'Ivoire should be in at most one R32 match, got ${civ.length}`);
});

test('flags resolve for the previously-blank teams (+ accent variant)', () => {
  for (const [team, code] of [["Cote d'Ivoire", 'ci'], ['Curacao', 'cw'], ['Cabo Verde', 'cv'], ['DR Congo', 'cd']]) {
    assert.match(flagFor(team), new RegExp(`fi fi-${code}`), `${team} → fi-${code}`);
  }
  // normalized fallback handles the accented spelling
  assert.match(flagFor("Côte d'Ivoire"), /fi fi-ci/, 'accented Côte d’Ivoire resolves');
});

test('englishName maps common English spellings (display only)', () => {
  assert.equal(englishName("Cote d'Ivoire"), 'Ivory Coast');
  assert.equal(englishName('Korea Republic'), 'South Korea');
  assert.equal(englishName('Cabo Verde'), 'Cape Verde');
  assert.equal(englishName('Turkiye'), 'Turkey');
  assert.equal(englishName('Spain'), 'Spain'); // unmapped passes through
});
