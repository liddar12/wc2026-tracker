/* group-picks-builder.js — extracted shared logic for Stage 1 (group orders
   1–4) and Stage 2 (rank 8 best thirds). Public API used by:
   - app/views/play-view.js (the funnel)
   - app/components/podium-modal.js (lookup helpers)

   Pure logic — no DOM. Persistence uses the same `wc26.grouppicks.<key>` slot
   as the legacy view so nothing forks state. */

import { normalizeGroupPredictions } from './group-scoring.js';

export const STAGE_1_LABEL = 'Group standings';
export const STAGE_2_LABEL = 'Rank 8 best thirds';
export const STAGE_3_LABEL = 'Full knockout';
export const REQUIRED_THIRDS = 8;
export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
export const LS_KEY_PREFIX = 'wc26.grouppicks.';

export function groupPicksKey(poolId) {
  return poolId ? `${LS_KEY_PREFIX}${poolId}` : `${LS_KEY_PREFIX}local`;
}

export function loadGroupPicks(poolId) {
  try {
    let raw = localStorage.getItem(groupPicksKey(poolId));
    // R14: when a signed-in user operates inside a pool whose key is empty,
    // fall back to the guest "local" draft. This carries pre-sign-in / pre-join
    // picks into the pool instead of silently dropping them (the old
    // user-<uid> migration wrote keys no reader ever checked).
    if (!raw && poolId) raw = localStorage.getItem(`${LS_KEY_PREFIX}local`);
    if (!raw) return emptyPicks();
    return mergeEmpty(JSON.parse(raw));
  } catch { return emptyPicks(); }
}

export function persistGroupPicks(poolId, picks) {
  try {
    localStorage.setItem(groupPicksKey(poolId), JSON.stringify(picks));
  } catch {}
}

export function emptyPicks() {
  const groups = {};
  for (const l of GROUP_LETTERS) groups[l] = [null, null, null, null];
  return { groups, best_thirds: [] };
}

function mergeEmpty(p) {
  const base = emptyPicks();
  if (!p || typeof p !== 'object') return base;
  // Some legacy shapes may store directly under top-level letter keys
  // (without a `groups` wrapper). Tolerate both.
  if (p.groups && typeof p.groups === 'object') {
    for (const l of GROUP_LETTERS) base.groups[l] = sanitizeOrder(p.groups[l]);
  } else {
    for (const l of GROUP_LETTERS) base.groups[l] = sanitizeOrder(p[l]);
  }
  if (Array.isArray(p.best_thirds)) base.best_thirds = p.best_thirds.slice(0, REQUIRED_THIRDS).filter(Boolean);
  return base;
}

function sanitizeOrder(arr) {
  if (!Array.isArray(arr)) return [null, null, null, null];
  const out = [null, null, null, null];
  for (let i = 0; i < 4; i++) out[i] = arr[i] || null;
  return out;
}

/* -- Stage 1 mutations ----------------------------------------------------- */

export function setRankForGroup(picks, letter, place, team) {
  if (!GROUP_LETTERS.includes(letter)) return picks;
  if (place < 1 || place > 4) return picks;
  if (!picks.groups[letter]) picks.groups[letter] = [null, null, null, null];
  // Remove the team from any other slot in this group first (a team can only
  // hold one rank in its group).
  for (let i = 0; i < 4; i++) {
    if (picks.groups[letter][i] === team) picks.groups[letter][i] = null;
  }
  picks.groups[letter][place - 1] = team;
  // 3rd-place team changed in this group → remove any orphan from best_thirds
  picks.best_thirds = picks.best_thirds.filter((t) => isThirdsCandidate(t, picks));
  return picks;
}

export function clearRankForGroup(picks, letter, place) {
  if (!picks.groups[letter]) return picks;
  picks.groups[letter][place - 1] = null;
  picks.best_thirds = picks.best_thirds.filter((t) => isThirdsCandidate(t, picks));
  return picks;
}

export function suggestGroupOrderFromProjected(data, letter) {
  const info = data?.groupMatchups?.[letter];
  const ps = info?.projected_standings;
  if (Array.isArray(ps) && ps.length >= 4) return ps.slice(0, 4).map((r) => r.team || r);
  // Fallback: order by composite from teams.json
  const teams = info?.teams || [];
  const sortable = teams.map((t) => ({ name: t, c: data?.teams?.[t]?.composite || 0 }));
  sortable.sort((a, b) => b.c - a.c);
  return sortable.map((r) => r.name);
}

/* -- Stage 2 mutations ----------------------------------------------------- */

export function isThirdsCandidate(team, picks) {
  // A team is a candidate for best_thirds iff some group lists it at index 2.
  for (const l of GROUP_LETTERS) {
    if (picks.groups[l]?.[2] === team) return true;
  }
  return false;
}

export function listThirdsCandidates(picks) {
  const out = [];
  for (const l of GROUP_LETTERS) {
    const t = picks.groups[l]?.[2];
    if (t) out.push({ team: t, group: l });
  }
  return out;
}

export function toggleBestThird(picks, team) {
  const idx = picks.best_thirds.indexOf(team);
  if (idx >= 0) {
    picks.best_thirds.splice(idx, 1);
  } else if (picks.best_thirds.length < REQUIRED_THIRDS && isThirdsCandidate(team, picks)) {
    picks.best_thirds.push(team);
  }
  return picks;
}

export function reorderBestThirds(picks, fromIdx, toIdx) {
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= picks.best_thirds.length) return picks;
  const [moved] = picks.best_thirds.splice(fromIdx, 1);
  picks.best_thirds.splice(toIdx, 0, moved);
  return picks;
}

/* -- Completeness predicates ---------------------------------------------- */

export function isStage1Complete(picks) {
  for (const l of GROUP_LETTERS) {
    const order = picks?.groups?.[l];
    if (!Array.isArray(order)) return false;
    if (order.length < 4) return false;
    if (order.some((t) => !t)) return false;
    // No duplicates within a group
    const set = new Set(order);
    if (set.size !== 4) return false;
  }
  return true;
}

export function isStage2Complete(picks) {
  if (!Array.isArray(picks?.best_thirds)) return false;
  if (picks.best_thirds.length !== REQUIRED_THIRDS) return false;
  // All entries must still be valid candidates after any Stage-1 edits
  for (const t of picks.best_thirds) {
    if (!isThirdsCandidate(t, picks)) return false;
  }
  return true;
}

export function groupsComplete(picks) {
  return GROUP_LETTERS.filter((l) => Array.isArray(picks?.groups?.[l]) && picks.groups[l].every((t) => t));
}

export function stage1WhatsLeft(picks) {
  const done = groupsComplete(picks);
  const missing = GROUP_LETTERS.filter((l) => !done.includes(l));
  if (!missing.length) return null;
  return `Stage 1: ${missing.length} group${missing.length === 1 ? '' : 's'} unordered (${missing.join(', ')})`;
}

export function stage2WhatsLeft(picks) {
  const have = (picks?.best_thirds || []).length;
  if (have === REQUIRED_THIRDS) return null;
  return `Stage 2: ${have}/${REQUIRED_THIRDS} thirds ranked`;
}

/* -- Resolution helpers for the read-only views ---------------------------- */

export function groupOrderFor(picks, letter) {
  return picks?.groups?.[letter] || [null, null, null, null];
}

export function bestThirdsFor(picks) {
  return picks?.best_thirds || [];
}

/* -- Compatibility shim with legacy normalizeGroupPredictions -------------- */

export function toNormalized(picks) {
  return normalizeGroupPredictions(picks);
}
