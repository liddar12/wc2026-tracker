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
import { isSlotPlaceholder, computeGroupStandings } from './bracket-resolver.js';
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
    let raw = localStorage.getItem(key);
    // R14: fall back to the guest "local" draft for an empty pool key so
    // pre-sign-in / pre-join knockout picks carry into the pool.
    if (!raw && poolId) raw = localStorage.getItem(`${LS_KEY_PREFIX}local`);
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

/* -- R32 seeding -----------------------------------------------------------
 *
 * R9 upgrade: replace the greedy first-fit best-third placement with a
 * proper bipartite matcher. The greedy algorithm could leave a slot
 * unplaceable even when a perfect matching existed (e.g., ranking 8 thirds
 * whose group letters cluster into a subset that doesn't cover one slot's
 * allowed-group set). The matcher finds a perfect placement when one
 * exists; falls back to maximum partial matching otherwise.
 *
 * Algorithm: backtracking search over the 8 third-slots, in match_number
 * order. For each slot, try each user-ranked best-third whose group is in
 * the slot's allowed set and which hasn't been placed yet. Maintain a
 * running best (max placements + best secondary key) so partial matchings
 * remain useful when no perfect exists.
 *
 * The match-number order is preserved across both perfect and partial
 * cases so the bracket layout stays deterministic. When two valid
 * matchings exist, the one that places the highest-ranked thirds in the
 * lowest-numbered slots is preferred (user's ranking → bracket layout).
 */

/**
 * R11: effective group order honors actual results when a group is fully
 * played; otherwise falls back to user predictions. Returns null if neither
 * source has data, so callers can decide whether to leave a placeholder.
 */
export function effectiveGroupOrder(data, picks, letter) {
  // 1. Actual results win when available (the group is complete).
  const actualStandings = computeGroupStandings(data, letter);
  if (Array.isArray(actualStandings) && actualStandings.length >= 4 && actualStandings.every((r) => r?.team)) {
    return actualStandings.slice(0, 4).map((r) => r.team);
  }
  // 2. Otherwise user prediction (fully-ranked group only).
  const userOrder = picks?.groups?.[letter];
  if (Array.isArray(userOrder) && userOrder.length === 4 && userOrder.every((t) => typeof t === 'string' && t.trim())) {
    return userOrder.slice(0, 4);
  }
  // 3. Neither — placeholder will stand.
  return null;
}

/**
 * R11: effective best-thirds list. If every group is complete in actuals,
 * compute the FIFA top-8 thirds (sort all twelve 3rd-place teams by group
 * standings rank — points / GD / GF / fair-play / FIFA ranking). Otherwise
 * fall back to user picks.
 */
export function effectiveBestThirds(data, picks) {
  const allGroups = Object.keys(data?.groupMatchups || {});
  const actualThirds = [];
  for (const letter of allGroups) {
    const standings = computeGroupStandings(data, letter);
    if (!Array.isArray(standings) || standings.length < 3) {
      // At least one group still in progress → fall back to user picks.
      return Array.isArray(picks?.best_thirds) ? picks.best_thirds.slice(0, 8) : [];
    }
    const third = standings[2];
    if (third?.team) {
      actualThirds.push({ team: third.team, group: letter, points: third.points || 0, gd: third.gd || 0, gf: third.gf || 0 });
    }
  }
  if (actualThirds.length < 8) {
    // Not enough completed groups for an actual-derived top-8.
    return Array.isArray(picks?.best_thirds) ? picks.best_thirds.slice(0, 8) : [];
  }
  // Pick the 8 best thirds by FIFA tiebreakers (points > gd > gf > name).
  actualThirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  return actualThirds.slice(0, 8).map((r) => r.team);
}

// R32 bracket SLOT labels ("2A","1E","3 ABCDF") live in match_id
// ("M073__2A__vs__2B") so they survive after team_a/team_b are filled with the
// actual qualified teams — which the schedule, live-score merge, and result
// recording all need. Returns {team_a, team_b} slot text, or null to fall back
// to the row's team_a/team_b (e.g. legacy team-based match_ids).
function slotLabelsFromMatchId(matchId) {
  const m = String(matchId || '').match(/^M\d+__(.+)$/);
  if (!m) return null;
  const parts = m[1].split('__vs__');
  if (parts.length !== 2) return null;
  return { team_a: parts[0].replace(/_/g, ' '), team_b: parts[1].replace(/_/g, ' ') };
}

export function buildR32Seeding(data, opts = {}) {
  const sf = data?.scheduleFull || [];
  const r32 = sf
    .filter((m) => m.stage === 'round_of_32')
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  if (r32.length !== 16) return [];
  const picks = opts.userPicks ?? normalizeGroupPredictions(loadUserGroupPicks(opts.poolId));

  // R11: derive effective group orders + best-thirds with the actual-results
  // fallback baked in. Caller of buildR32Seeding therefore gets a bracket
  // that's resolvable as soon as group stage results land, even if the user
  // never predicted Stage 1+2.
  const effectiveGroups = {};
  for (const letter of Object.keys(data?.groupMatchups || {})) {
    const order = effectiveGroupOrder(data, picks, letter);
    if (order) effectiveGroups[letter] = order;
  }
  const effectiveThirds = effectiveBestThirds(data, picks);
  const effectivePicks = { groups: effectiveGroups, best_thirds: effectiveThirds };

  // Collect the "3 …" slots and bipartite-match them in one pass.
  const thirdSlots = [];
  for (const m of r32) {
    const slots = slotLabelsFromMatchId(m.match_id) || { team_a: m.team_a, team_b: m.team_b };
    for (const side of ['team_a', 'team_b']) {
      const text = slots[side];
      const thirdMatch = typeof text === 'string' && text.match(/^3 ([A-L]+)$/);
      if (thirdMatch) {
        thirdSlots.push({
          slotText: text,
          matchNumber: m.match_number,
          side,
          allowed: new Set(thirdMatch[1].split('')),
        });
      }
    }
  }
  const thirdAssignments = matchBestThirdsToSlots(thirdSlots, effectivePicks.best_thirds || [], data);

  return r32.map((m) => {
    const out = { match_number: m.match_number, kickoff_utc: m.kickoff_utc };
    const slots = slotLabelsFromMatchId(m.match_id) || { team_a: m.team_a, team_b: m.team_b };
    for (const side of ['team_a', 'team_b']) {
      const text = slots[side];
      if (typeof text !== 'string') { out[side] = text; continue; }
      // 1A / 2B style: defer to per-group resolver against effective picks
      const groupRank = text.match(/^(\d)([A-L])$/);
      if (groupRank) {
        out[side] = resolveSlotFromUserPicks(text, effectivePicks, data, null);
        continue;
      }
      // 3 ABCD style: pull from matcher result
      if (/^3 [A-L]+$/.test(text)) {
        const assigned = thirdAssignments.get(`${m.match_number}:${side}`);
        out[side] = assigned || text;
        continue;
      }
      out[side] = text;
    }
    return out;
  });
}

// Returns Map of `${matchNumber}:${side}` → team name.
export function matchBestThirdsToSlots(thirdSlots, bestThirds, data) {
  const result = new Map();
  if (!thirdSlots.length || !bestThirds.length) return result;

  // Pre-compute each slot's eligible-thirds set (in user-rank order so
  // we naturally prefer higher-ranked picks first when multiple matchings
  // exist).
  const eligibility = thirdSlots.map((slot) => {
    const out = [];
    for (const team of bestThirds) {
      const g = findTeamGroup(team, data);
      if (g && slot.allowed.has(g)) out.push(team);
    }
    return out;
  });

  // Backtracking with branch-and-bound on placement count.
  let bestAssignment = null;
  let bestCount = -1;

  function recurse(slotIdx, assignment, usedThirds, placedCount) {
    // Early prune: even if every remaining slot gets a placement, we can't
    // beat the best — abort.
    const remainingSlots = thirdSlots.length - slotIdx;
    if (placedCount + remainingSlots <= bestCount) return;
    if (slotIdx === thirdSlots.length) {
      if (placedCount > bestCount) {
        bestCount = placedCount;
        bestAssignment = [...assignment];
        // Perfect matching — no need to keep searching.
      }
      return;
    }
    // Option 1: try every eligible third for this slot
    for (const team of eligibility[slotIdx]) {
      if (usedThirds.has(team)) continue;
      assignment[slotIdx] = team;
      usedThirds.add(team);
      recurse(slotIdx + 1, assignment, usedThirds, placedCount + 1);
      if (bestCount === thirdSlots.length) return; // found perfect
      usedThirds.delete(team);
      assignment[slotIdx] = null;
    }
    // Option 2: leave this slot unplaced (allowed for partial matchings)
    assignment[slotIdx] = null;
    recurse(slotIdx + 1, assignment, usedThirds, placedCount);
  }

  recurse(0, new Array(thirdSlots.length).fill(null), new Set(), 0);

  if (bestAssignment) {
    for (let i = 0; i < thirdSlots.length; i++) {
      const team = bestAssignment[i];
      if (team) result.set(`${thirdSlots[i].matchNumber}:${thirdSlots[i].side}`, team);
    }
  }
  return result;
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

/**
 * R14: parse the REAL knockout feed graph from data.scheduleFull. Each
 * downstream KO match references its feeders as "W<n>" team slots
 * (e.g. R16 M89 = W74 vs W77). The pre-R14 computeRounds paired winners by
 * array index (73+74, 75+76, …), which is structurally wrong — M89 actually
 * feeds from R32 matches 74 and 77. Because scoring keys on
 * `team_a__vs__team_b`, the wrong pairing meant R16+ picks could never match
 * real results. Returns null if the schedule can't be fully parsed (callers
 * then fall back to the legacy pairing).
 */
export function buildKnockoutFeeds(data) {
  const sf = data?.scheduleFull || [];
  const STAGE_LABEL = { round_of_16: 'R16', quarterfinals: 'QF', semifinals: 'SF', final: 'Final' };
  const byRound = { R16: [], QF: [], SF: [], Final: [] };
  const parseW = (slot) => {
    const m = typeof slot === 'string' && slot.match(/^W(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  };
  // The feed graph lives in the STABLE match_id ("M090__W73__vs__W75"), which
  // survives resolution. resolve_knockouts overwrites team_a/team_b with the
  // real advancing team once a fixture is decided, erasing its "W##" slots — so
  // reading feeds from team_a/team_b collapsed the whole graph to null the
  // moment any R16 game finished (the projected bracket then silently fell back
  // to the wrong index pairing). Prefer the id; fall back to the team slots for
  // any legacy/missing id.
  const feedsFromId = (id) => {
    const parts = typeof id === 'string' ? id.split('__') : [];
    if (parts.length >= 4 && parts[2] === 'vs') return [parseW(parts[1]), parseW(parts[3])];
    return [null, null];
  };
  for (const m of sf) {
    const label = STAGE_LABEL[m.stage];
    if (!label) continue;
    const [idA, idB] = feedsFromId(m.match_id);
    byRound[label].push({
      match_number: m.match_number,
      feedA: idA ?? parseW(m.team_a),
      feedB: idB ?? parseW(m.team_b),
    });
  }
  for (const k of Object.keys(byRound)) byRound[k].sort((x, y) => (x.match_number || 0) - (y.match_number || 0));
  const all = [...byRound.R16, ...byRound.QF, ...byRound.SF, ...byRound.Final];
  const complete = byRound.R16.length === 8 && byRound.QF.length === 4 && byRound.SF.length === 2 && byRound.Final.length === 1
    && all.every((e) => e.feedA != null && e.feedB != null);
  return complete ? byRound : null;
}

export function computeRounds(r32, draft, data) {
  const r32Round = {
    key: 'R32',
    matches: r32.map((m) => ({ ...m, pick: getPickFor(draft, m.match_number) })),
  };
  const rounds = [r32Round];

  // R14: prefer the real feed graph when the schedule is available.
  const feeds = data ? buildKnockoutFeeds(data) : null;
  if (feeds) {
    const pickByMatch = {};
    for (const m of r32Round.matches) pickByMatch[m.match_number] = m.pick;
    for (const label of ['R16', 'QF', 'SF', 'Final']) {
      const matches = feeds[label].map((f) => {
        const pick = getPickFor(draft, f.match_number);
        const m = {
          match_number: f.match_number,
          team_a: pickByMatch[f.feedA] || null,
          team_b: pickByMatch[f.feedB] || null,
          kickoff_utc: null,
          pick,
          feeds_from: [f.feedA, f.feedB],
        };
        return m;
      });
      for (const m of matches) pickByMatch[m.match_number] = m.pick;
      rounds.push({ key: label, matches });
    }
    return rounds;
  }

  // Legacy fallback (no schedule passed): index-pairing. Structurally wrong
  // for real scoring but preserved so data-less callers/tests don't break.
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
  // R14: the 3rd-place game (match #103) is fed by the two SEMIFINAL LOSERS.
  // Any change at SF or earlier can invalidate who those losers are, so the
  // 3rd-place pick must be cleared too. The range loop above never touched
  // 103 (it's not in MATCH_RANGES), leaving a stale/invalid 3rd-place pick.
  const sfIdx = order.indexOf('SF');
  if (startIdx <= sfIdx && draft.picks?.['103']) {
    delete draft.picks['103'];
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

/* -- Submit conversion (R14) -----------------------------------------------
 * Convert the funnel draft shape
 *   { picks: { "<matchNumber>": { team, team_a, team_b } } }
 * into the array shape competition-scoring + group_brackets expect:
 *   [{ team_a, team_b, choice }]  where choice is 'team_a' | 'team_b'.
 *
 * This is the converter the submit hot path needs. Before R14, the Play
 * funnel called saveBracketForActiveGroup() which read the UNRELATED
 * wc26.picks store (the per-match Matches layer) via allPicks(), so funnel
 * brackets were never actually submitted. Extracting the converter here
 * (pure, node-testable) lets the submit path read the real funnel draft.
 */
export function bracketToPickArray(draft) {
  const out = [];
  if (!draft || !draft.picks) return out;
  for (const entry of Object.values(draft.picks)) {
    if (!entry || typeof entry !== 'object') continue; // skip legacy string entries
    const { team, team_a, team_b } = entry;
    if (!team || !team_a || !team_b) continue;
    const choice = team === team_a ? 'team_a' : team === team_b ? 'team_b' : null;
    if (!choice) continue;
    out.push({ team_a, team_b, choice });
  }
  return out;
}

/* -- Re-export for the lock state surface (kept here for convenience) ------ */
export { isSlotPlaceholder };
