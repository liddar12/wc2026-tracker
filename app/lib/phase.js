/* phase.js — tournament-phase source of truth. Views ask "where are we in the
   tournament?" in several places (home ordering, bracket gating, copy) and each
   re-derived it from raw kickoffs differently. currentPhase() answers it once,
   reusing competition-rules' deriveLockState() for the pre/group/knockout
   boundary so the phase and the per-stage lock can never disagree. Pure
   function; the only app import is competition-rules (itself dependency-free).

   Input is the loaded data object (see app/data-loader.js):
     data.scheduleFull   - array of fixtures: { stage, kickoff_utc, ... }
     data.actualResults  - { group_stage:{}, round_of_32:{}, ..., final:{} }
*/
import { deriveLockState } from '../competition-rules.js';
import { isFinalStatus } from './match-status.js';

// Knockout stages in play order; round_of_32 is the entry round. 'r32' is the
// legacy stage token, kept alongside the current 'round_of_32' schema.
const KO_STAGES = ['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'final'];
const ROUND_FOR_STAGE = {
  r32: 'round_of_32', round_of_32: 'round_of_32',
  round_of_16: 'round_of_16',
  quarterfinals: 'quarterfinals',
  semifinals: 'semifinals',
  final: 'final',
};

/**
 * Where the tournament currently is.
 * @param {object} data
 * @param {Array}  [data.scheduleFull]
 * @param {object} [data.actualResults]
 * @param {number} [nowMs] - injected clock for testability (default Date.now()).
 * @returns {{ phase:'pre'|'group'|'knockout'|'complete',
 *             isGroupStage:boolean, isKnockout:boolean,
 *             round?: 'round_of_32'|'round_of_16'|'quarterfinals'|'semifinals'|'final' }}
 *   - phase 'pre'      : no group match has kicked off yet.
 *   - phase 'group'    : the group stage is underway (and the bracket hasn't started).
 *   - phase 'knockout' : a knockout match has kicked off (and the final isn't decided).
 *   - phase 'complete' : the final has a FINAL result.
 *   - round            : present only in the knockout phase — the deepest round
 *                        that has kicked off (the round currently in play).
 */
export function currentPhase(data, nowMs = Date.now()) {
  const schedule = Array.isArray(data?.scheduleFull) ? data.scheduleFull : [];
  const results = data?.actualResults || {};

  // The final being settled ends the tournament regardless of clocks.
  if (isFinalDecided(results)) {
    return { phase: 'complete', isGroupStage: false, isKnockout: false };
  }

  // Reuse the lock state for the pre/group/knockout boundary. Its `phase`:
  //   'pre-tournament' | 'group-stage-live' | 'between-group-and-r32' | 'r32-live'
  const lock = deriveLockState(schedule, nowMs);

  if (lock.phase === 'pre-tournament') {
    return { phase: 'pre', isGroupStage: false, isKnockout: false };
  }

  if (lock.phase === 'r32-live') {
    return {
      phase: 'knockout', isGroupStage: false, isKnockout: true,
      round: deepestKnockoutRound(schedule, nowMs),
    };
  }

  // 'group-stage-live' and the gap window 'between-group-and-r32' are both still
  // the group phase from a tournament standpoint (no knockout has kicked off).
  return { phase: 'group', isGroupStage: true, isKnockout: false };
}

/** The final has a FINAL result → champion crowned, tournament over. */
function isFinalDecided(results) {
  const finalTier = results?.final || {};
  for (const key of Object.keys(finalTier)) {
    if (isFinalStatus(finalTier[key])) return true;
  }
  return false;
}

/** The deepest knockout round that has already kicked off (the round in play). */
function deepestKnockoutRound(schedule, nowMs) {
  let deepest = 'round_of_32';
  let deepestIdx = 0;
  for (const m of schedule) {
    const round = ROUND_FOR_STAGE[m?.stage];
    if (!round) continue;
    const k = Date.parse(m?.kickoff_utc);
    if (!Number.isFinite(k) || nowMs < k) continue;
    const idx = KO_STAGES.indexOf(round);
    if (idx > deepestIdx) { deepestIdx = idx; deepest = round; }
  }
  return deepest;
}
