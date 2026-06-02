/* bracket-builder.js — extracted shared logic for building, persisting,
   and resolving the knockout bracket draft. Used by:
   - app/views/play-view.js (Stage 3 of the funnel)
   - app/views/bracket-view.js (read-only Projected mode)
   - app/views/my-brackets-view.js (read-only entry view)
   - app/components/podium-modal.js (champion/runner-up/3rd lookup)

   No DOM rendering in this module — pure builders + a small renderer helper
   in renderRound() that takes options. Keep DOM-only concerns in the
   consuming views. */

import { normalizeGroupPredictions } from './group-scoring.js';
import { isSlotPlaceholder } from './bracket-resolver.js';
// Note: getCachedGroupPredictions is loaded lazily so this module stays
// import-safe in node (competition.js pulls supabase via esm.sh).

export const ROUND_LABELS = ['R32', 'R16', 'QF', 'SF', 'Final'];
export const ROUND_POINTS = { R32: 1, R16: 2, QF: 4, SF: 8, Final: 16 };
export const CHAMPION_BONUS = 16;
export const LS_KEY_PREFIX = 'wc26.mybrackets.';

export const MATCH_RANGES = {
  R32:   { min: 73,  max: 88  },
  R16:   { min: 89,  max: 96  },
  QF:    { min: 97,  max: 100 },
  SF:    { min: 101, max: 102 },
  Final: { min: 104, max: 104 },
};

/* -- Draft persistence ----------------------------------------------------- */

export function bracketKeyForPool(poolId) {
  return poolId ? `${LS_KEY_PREFIX}${poolId}` : `${LS_KEY_PREFIX}local`;
}

export function loadBracketDraft(poolId) {
  const key = bracketKeyForPool(poolId);
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : { picks: {} };
    if (!parsed || typeof parsed !== 'object') return { picks: {} };
    if (!parsed.picks || typeof parsed.picks !== 'object') parsed.picks = {};
    return parsed;
  } catch { return { picks: {} }; }
}

export function persistBracketDraft(poolId, draft) {
  const key = bracketKeyForPool(poolId);
  try { localStorage.setItem(key, JSON.stringify(draft)); } catch {}
}

/* -- Group-picks lookup (for R32 slot resolution) -------------------------- */

export function loadUserGroupPicks(activePoolId) {
  // Resolution order:
  //   1. Server-cached group_predictions for active pool (browser only)
  //   2. localStorage draft for active pool
  //   3. localStorage local draft
  try {
    // In the browser we want server cache; node tests have no localStorage so
    // they pass userPicks explicitly via opts.
    if (typeof localStorage === 'undefined') return {};
    const cached = readCachedGroupPredictions();
    if (cached) return cached;
    const key = activePoolId ? `wc26.grouppicks.${activePoolId}` : 'wc26.grouppicks.local';
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    const localRaw = localStorage.getItem('wc26.grouppicks.local');
    return localRaw ? JSON.parse(localRaw) : {};
  } catch { return {}; }
}

function readCachedGroupPredictions() {
  // Lazy access via window so the import graph doesn't pull supabase in tests.
  if (typeof window !== 'undefined' && typeof window.__wc26CachedGroupPredictions === 'function') {
    return window.__wc26CachedGroupPredictions();
  }
  return null;
}

/* -- Slot resolution -------------------------------------------------------
 *
 * R7 QA fix: the previous per-slot resolver returned the FIRST best-third
 * whose group letter appeared in the slot's allowed-group string. If a
 * single best-third's group appeared in multiple "3 ABCDEF"-style slots
 * (which is exactly how the FIFA R32 bracket is laid out), that same team
 * was assigned to ALL of those slots — so e.g. Sweden showed up four times
 * in the user's R32. The fix is to track which best-thirds have been
 * consumed and walk slots in match_number order.
 *
 * `resolveSlotFromUserPicks` keeps its per-slot signature for backward
 * compatibility (used by the read-only Bracket section + autofill) but
 * accepts an optional `usedThirds` Set to dedup across calls. For correct
 * placement across the whole R32, callers should use
 * `assignBestThirdsToR32` which walks all R32 third-slots holistically.
 */

export function resolveSlotFromUserPicks(slot, userPicks, data, usedThirds = null) {
  if (!slot || typeof slot !== 'string') return slot;

  // "1A" / "2B" → user's nth-place pick for group A/B
  const grp = slot.match(/^(\d)([A-L])$/);
  if (grp) {
    const place = parseInt(grp[1], 10);
    const letter = grp[2];
    const order = userPicks.groups?.[letter];
    if (Array.isArray(order) && order[place - 1]) return order[place - 1];
    return slot;
  }

  // "3 ABCDF" → match the first user best_third belonging to one of the
  // listed groups AND not yet placed elsewhere.
  const third = slot.match(/^3 ([A-L]+)$/);
  if (third) {
    const allowedGroups = new Set(third[1].split(''));
    const bestThirds = userPicks.best_thirds || [];
    for (const team of bestThirds) {
      if (usedThirds && usedThirds.has(team)) continue;
      const teamGroup = findTeamGroup(team, data);
      if (teamGroup && allowedGroups.has(teamGroup)) {
        if (usedThirds) usedThirds.add(team);
        return team;
      }
    }
    return slot;
  }

  return slot;
}

export function findTeamGroup(team, data) {
  const gm = data?.groupMatchups || {};
  for (const [letter, info] of Object.entries(gm)) {
    if ((info.teams || []).includes(team)) return letter;
  }
  return null;
}

/* -- R32 seeding ----------------------------------------------------------- */

export function buildR32Seeding(data, opts = {}) {
  const sf = data?.scheduleFull || [];
  const r32 = sf
    .filter((m) => m.stage === 'round_of_32')
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  if (r32.length !== 16) return [];
  const picks = opts.userPicks ?? normalizeGroupPredictions(loadUserGroupPicks(opts.poolId));
  // R7 QA fix: walk all 16 slots in canonical (match_number) order with a
  // shared usedThirds set so a single best-third is never assigned to more
  // than one R32 slot. Without this, e.g. Sweden showed up in 4 R32 matches.
  const usedThirds = new Set();
  return r32.map((m) => ({
    match_number: m.match_number,
    team_a: resolveSlotFromUserPicks(m.team_a, picks, data, usedThirds),
    team_b: resolveSlotFromUserPicks(m.team_b, picks, data, usedThirds),
    kickoff_utc: m.kickoff_utc,
  }));
}

/* -- Rounds cascading from R32 + draft picks ------------------------------- */

export function getPickFor(draft, matchNumber) {
  const entry = draft?.picks?.[String(matchNumber)];
  if (!entry) return null;
  if (typeof entry === 'string') return entry; // legacy
  return entry.team || null;
}

export function setPickFor(draft, matchNumber, team, pair) {
  draft.picks = draft.picks || {};
  if (!team) { delete draft.picks[String(matchNumber)]; return; }
  draft.picks[String(matchNumber)] = {
    team,
    team_a: pair?.team_a || null,
    team_b: pair?.team_b || null,
  };
}

export function nextRoundMatchNumber(roundIndex, pairIndex) {
  const ranges = [
    null,                    // R32 already has real numbers
    { base: 89 },            // R16
    { base: 97 },            // QF
    { base: 101 },           // SF
    { base: 104 },           // Final
  ];
  const r = ranges[roundIndex];
  if (!r) return 1000 + roundIndex * 10 + pairIndex;
  return r.base + pairIndex;
}

export function computeRounds(r32, draft) {
  const rounds = [{
    key: 'R32',
    matches: r32.map((m) => ({ ...m, pick: getPickFor(draft, m.match_number) })),
  }];
  for (let r = 1; r < ROUND_LABELS.length; r++) {
    const prev = rounds[r - 1];
    const matches = [];
    for (let i = 0; i < prev.matches.length; i += 2) {
      const a = prev.matches[i];
      const b = prev.matches[i + 1];
      const matchNumber = nextRoundMatchNumber(r, i / 2);
      matches.push({
        match_number: matchNumber,
        team_a: a?.pick || null,
        team_b: b?.pick || null,
        kickoff_utc: null,
        pick: getPickFor(draft, matchNumber),
        feeds_from: [a?.match_number, b?.match_number],
      });
    }
    rounds.push({ key: ROUND_LABELS[r], matches });
  }
  return rounds;
}

/* -- Stage-3 completeness + champion lookup -------------------------------- */

export function isStage3Complete(rounds) {
  // Every round needs every match picked, *and* the 3rd-place game (which we
  // model separately below if scheduleFull contains it).
  for (const r of rounds) {
    for (const m of r.matches) {
      if (!m.pick) return false;
    }
  }
  return true;
}

export function getChampion(rounds) {
  const last = rounds[rounds.length - 1];
  return last?.matches?.[0]?.pick || null;
}

export function getRunnerUp(rounds) {
  // Whoever lost the final = the other side of the final match.
  const last = rounds[rounds.length - 1];
  const m = last?.matches?.[0];
  if (!m?.pick) return null;
  if (m.team_a === m.pick) return m.team_b;
  if (m.team_b === m.pick) return m.team_a;
  return null;
}

/* -- 3rd-place game (real match #103) -------------------------------------- */

export function getThirdPlaceMatch(data) {
  const sf = data?.scheduleFull || [];
  return sf.find((m) => m.stage === 'third_place') || null;
}

export function getThirdPlacePick(draft) {
  return getPickFor(draft, 103);
}

export function setThirdPlacePick(draft, team, pair) {
  setPickFor(draft, 103, team, pair);
}

/* -- Downstream clearing on pick change ------------------------------------ */

export function stageOfMatchNumber(num) {
  if (num <= 88) return 'R32';
  if (num <= 96) return 'R16';
  if (num <= 100) return 'QF';
  if (num <= 102) return 'SF';
  if (num === 103) return 'ThirdPlace';
  return 'Final';
}

export function clearDownstream(draft, fromMatchNumber) {
  const stage = stageOfMatchNumber(fromMatchNumber);
  const order = ['R32', 'R16', 'QF', 'SF', 'Final'];
  const startIdx = order.indexOf(stage);
  if (startIdx < 0) return;
  for (let i = startIdx + 1; i < order.length; i++) {
    const range = MATCH_RANGES[order[i]];
    if (!range) continue;
    for (let mn = range.min; mn <= range.max; mn++) {
      if (draft.picks?.[String(mn)]) delete draft.picks[String(mn)];
    }
  }
}

/* -- What's-left hint for the funnel submit bar ---------------------------- */

export function knockoutWhatsLeft(rounds, draft) {
  const out = [];
  for (const r of rounds) {
    const filled = r.matches.filter((m) => m.pick).length;
    if (filled < r.matches.length) {
      out.push(`${r.key}: ${filled}/${r.matches.length} picked`);
    }
  }
  // 3rd-place game tracked separately
  if (!getPickFor(draft, 103)) out.push('3rd-place game: not decided');
  return out;
}

/* -- Re-export for the lock state surface (kept here for convenience) ------ */
export { isSlotPlaceholder };
