/* winner-highlight.test.mjs — Epic E (RCA 2026-06-30, bugs 3-cards / 11-render /
 * 15 / 23 + de-dup hardening).
 *
 * Locks the card winner-highlight + method-tag + status-first mode behavior, and
 * guards the de-dup: large-match-card / live-scores / bracket-resolver /
 * competition-scoring must share the ONE canonical status contract from
 * app/lib/match-status.js, and the scoring/bracket gates must still act only on
 * FINAL. large-match-card builds DOM via innerHTML, so the node-runnable
 * assertions here exercise the pure helpers (actualForCard, deriveMode through
 * card data, method/winner selection) and the produced markup where document is
 * available; full DOM-render visual assertions are flagged for the Playwright
 * suite (see crossEpicNotes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actualForCard } from '../../app/components/large-match-card.js';
import {
  deriveMode, methodOfVictory, winnerFromRecord, FINAL_STATUSES, LIVE_STATUSES,
} from '../../app/lib/match-status.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const HOUR = 60 * 60 * 1000;

// ---- actualForCard: status-first mode + winner/method passthrough -----------

test('actualForCard returns mode=final + winner + method for a regulation final', () => {
  const data = {
    round_of_16: {
      'Spain__vs__Italy': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' },
    },
  };
  const got = actualForCard(data, { stage: 'round_of_16', team_a: 'Spain', team_b: 'Italy' });
  assert.ok(got, 'record found');
  assert.equal(got.mode, 'final');
  assert.equal(got.actual.score_a, 2);
  assert.equal(got.actual.score_b, 0);
  // actual stays the minimal score payload; winner/status/method are siblings.
  assert.deepEqual(Object.keys(got.actual).sort(), ['score_a', 'score_b']);
  assert.equal(got.winner, 'Spain', 'winner derived from the higher score');
  assert.equal(got.status, 'STATUS_FULL_TIME');
  assert.equal(got.method.label, 'FT');
});

test('actualForCard carries the shootout winner + pens method for a STATUS_FINAL_PEN row', () => {
  const data = {
    round_of_32: {
      'Netherlands__vs__Morocco': {
        score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN',
        winner: 'Morocco', shootout_a: 2, shootout_b: 3,
      },
    },
  };
  const got = actualForCard(data, { stage: 'round_of_32', team_a: 'Netherlands', team_b: 'Morocco' });
  assert.ok(got);
  assert.equal(got.mode, 'final');
  assert.equal(got.winner, 'Morocco', 'pen winner is explicit, not score-derived (1-1)');
  assert.equal(got.method.method, 'pens');
  assert.equal(got.method.label, 'pens');
  assert.equal(got.method.suffix, ' (3–2)', 'shootout tally en-dash hi–lo');
});

test('actualForCard orients winner correctly when the stored record is FLIPPED', () => {
  // Stored as Italy__vs__Spain (Italy 0, Spain 2); query asks Spain vs Italy.
  const data = {
    round_of_16: {
      'Italy__vs__Spain': { score_a: 0, score_b: 2, status: 'STATUS_FULL_TIME' },
    },
  };
  const got = actualForCard(data, { stage: 'round_of_16', team_a: 'Spain', team_b: 'Italy' });
  assert.ok(got);
  assert.equal(got.actual.score_a, 2, 'score re-oriented to the queried team_a');
  assert.equal(got.actual.score_b, 0);
  assert.equal(got.winner, 'Spain', 'winner is the canonical name, orientation-safe');
});

test('actualForCard returns mode=live (no winner) for an in-progress record', () => {
  const data = {
    group_stage: {
      'A__vs__B': { score_a: 1, score_b: 0, status: 'STATUS_FIRST_HALF' },
    },
  };
  const got = actualForCard(data, { stage: 'group', team_a: 'A', team_b: 'B' });
  assert.ok(got);
  assert.equal(got.mode, 'live');
  assert.ok(!got.winner, 'a live leader is NOT a winner');
  assert.ok(!got.method, 'a live record has no settled method tag');
});

test('actualForCard rejects a STATUS_SCHEDULED 0-0 stub (no phantom 0–0 card)', () => {
  const data = {
    group_stage: {
      'A__vs__B': { score_a: 0, score_b: 0, status: 'STATUS_SCHEDULED' },
    },
  };
  assert.equal(
    actualForCard(data, { stage: 'group', team_a: 'A', team_b: 'B' }), null,
    'scheduled stub must not render as a result',
  );
});

// ---- deriveMode replaces the old 2h-clock inferMode (status-first) ----------

test('deriveMode: past-kickoff knockout with NO record is pending (not phantom final)', () => {
  // 4h past kickoff, no record at all: the old 2h-clock inferMode called this
  // 'final' with no score — now it is 'pending'.
  const kickoff = '2026-06-30T16:00:00Z';
  const now = Date.parse(kickoff) + 4 * HOUR;
  assert.equal(deriveMode(null, kickoff, { stage: 'round_of_16', now }), 'pending');
});

test('deriveMode: knockout live window is ~3h (extra time + pens), group is ~2h', () => {
  const kickoff = '2026-06-30T16:00:00Z';
  const at150 = Date.parse(kickoff) + 2.5 * HOUR;
  // Group game 2.5h in with no record is overdue → pending.
  assert.equal(deriveMode(null, kickoff, { stage: 'group', now: at150 }), 'pending');
  // Knockout 2.5h in (could still be in ET/pens) is still live.
  assert.equal(deriveMode(null, kickoff, { stage: 'round_of_16', now: at150 }), 'live');
});

test('deriveMode: a real FINAL status wins regardless of the clock', () => {
  const kickoff = '2026-06-30T16:00:00Z';
  const now = Date.parse(kickoff) + 30 * 60 * 1000; // only 30 min in
  assert.equal(deriveMode({ status: 'STATUS_FINAL_PEN' }, kickoff, { stage: 'round_of_16', now }), 'final');
});

// ---- method tag + winner selection helpers ---------------------------------

test('methodOfVictory tag selection: FT / AET / pens', () => {
  assert.equal(methodOfVictory({ status: 'STATUS_FULL_TIME' }).label, 'FT');
  assert.equal(methodOfVictory({ status: 'STATUS_FINAL_AET' }).label, 'AET');
  assert.equal(methodOfVictory({ status: 'STATUS_FINAL_PEN' }).label, 'pens');
  // a live record has no settled method
  assert.equal(methodOfVictory({ status: 'STATUS_FIRST_HALF' }).method, null);
});

test('winnerFromRecord: explicit winner beats score; live → null', () => {
  assert.equal(winnerFromRecord({ score_a: 1, score_b: 1, status: 'STATUS_FINAL_PEN', winner: 'Morocco' }, 'NED', 'MAR'), 'Morocco');
  assert.equal(winnerFromRecord({ score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' }, 'X', 'Y'), 'X');
  assert.equal(winnerFromRecord({ score_a: 1, score_b: 0, status: 'STATUS_FIRST_HALF' }, 'X', 'Y'), null);
});

// ---- de-dup: every owned file shares the ONE status contract ----------------

test('owned files import the canonical status sets from match-status (no local copies)', () => {
  for (const f of [
    'app/components/large-match-card.js',
    'app/live-scores.js',
    'app/bracket-resolver.js',
    'app/competition-scoring.js',
  ]) {
    const s = read(f);
    assert.match(s, /from ['"][^'"]*lib\/match-status\.js['"]/, `${f} imports match-status lib`);
    // The local `const FINAL_STATUSES = new Set([` / `= [` declarations are gone.
    assert.ok(
      !/const\s+FINAL_STATUSES\s*=\s*(new Set\(\[|\[)/.test(s),
      `${f} must not re-declare a local FINAL_STATUSES set`,
    );
  }
});

test('scoring + bracket gates still recognise penalty/extra-time finals (regression guard)', () => {
  // Sourced from the shared lib now, but the gate semantics must hold.
  assert.ok(FINAL_STATUSES.has('STATUS_FINAL_PEN'));
  assert.ok(FINAL_STATUSES.has('STATUS_FINAL_AET'));
  assert.ok(!LIVE_STATUSES.has('STATUS_FINAL_PEN'));
});

// ---- card DOM markup (only where document is available) ---------------------
// Node has no `document`; these run only under jsdom/Playwright. Guarded so the
// node --test run stays green and QA's browser suite picks up the visual cues.
test('rendered card markup carries .is-winner + method tag (browser-only)', { skip: typeof document === 'undefined' }, async () => {
  const { largeMatchCard } = await import('../../app/components/large-match-card.js');
  const card = largeMatchCard(
    { team_a: 'Spain', team_b: 'Italy', stage: 'round_of_16', kickoff_utc: '2026-06-30T16:00:00Z' },
    { mode: 'final', actual: { score_a: 2, score_b: 0 }, winner: 'Spain', method: methodOfVictory({ status: 'STATUS_FULL_TIME' }) },
  );
  const html = card.outerHTML;
  assert.match(html, /is-winner/, 'winning team carries .is-winner');
  assert.match(html, /lcard-method/, 'method tag present');
});

test('ET/pen card: only the advancing side is .is-winner + eyebrow reads pens (3–2) (browser-only)', { skip: typeof document === 'undefined' }, async () => {
  const { largeMatchCard } = await import('../../app/components/large-match-card.js');
  // Netherlands 1–1 Morocco, Morocco through on penalties (2–3 → en-dash 3–2).
  const card = largeMatchCard(
    { team_a: 'Netherlands', team_b: 'Morocco', stage: 'round_of_32', kickoff_utc: '2026-06-30T01:00:00Z' },
    {
      mode: 'final', actual: { score_a: 1, score_b: 1 }, winner: 'Morocco',
      method: methodOfVictory({ status: 'STATUS_FINAL_PEN', shootout_a: 2, shootout_b: 3 }),
    },
  );
  const html = card.outerHTML;
  // Morocco is side b → only lcard-team-b is highlighted.
  assert.match(html, /lcard-team-b[^"]*is-winner/, 'Morocco (side b) carries .is-winner');
  assert.ok(!/lcard-team-a[^"]*is-winner/.test(html), 'Netherlands (side a) is NOT highlighted');
  // Eyebrow tag includes the en-dash shootout suffix.
  assert.match(html, /pens \(3–2\)/, 'eyebrow reads "pens (3–2)" with the en-dash suffix');
});
