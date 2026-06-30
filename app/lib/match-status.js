/* match-status.js — the single source of truth for match status.
   Before this lib the FINAL_STATUSES / LIVE_STATUSES sets were copy-pasted
   (with subtly different membership) into large-match-card.js, live-scores.js,
   bracket-resolver.js, competition-scoring.js, and others — so a status like
   STATUS_FINAL_PEN was "final" in one file and ignored in another, which is
   exactly how finished penalty knockouts slipped through the bracket/scoring
   gates. Import the canonical Sets + helpers from here so every display,
   scoring, standings, and advancement path agrees on what "final" and "live"
   mean. Pure functions, no DOM.

   Record shape (data/actual_results.json, written by scripts/scrape_live_results.py):
     { score_a, score_b, kickoff_utc, status, winner?, shootout_a?, shootout_b?, minute? }
   - status  : an ESPN status name (see the Sets below).
   - winner  : the advancing team's CANONICAL NAME (NOT penalty_winner) — present
               only for knockout ties broken by ET/pens, where the regulation
               score is a draw and the winner can't be derived from the score.
   - shootout_a / shootout_b : the shootout tally oriented to the row's team_a/team_b.
*/

// FINAL = the result is settled and must never be overwritten or re-derived.
// Includes the knockout-only resolutions: extra time (AET) and penalty shootout
// (PEN) — for those ESPN's score is the regulation score (often a tie) and how
// the tie was broken lives in the status + rec.winner. Kept identical to the
// sets previously inlined in live-scores.js / bracket-resolver.js /
// competition-scoring.js / large-match-card.js.
export const FINAL_STATUSES = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME',
  'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
]);

// LIVE = the match is in progress and only displayable (never scored/advanced).
// ESPN soccer reports HALF-specific statuses live (a 26'-minute game reports
// STATUS_FIRST_HALF, not STATUS_IN_PROGRESS), plus the extra-time / shootout
// phases of a knockout. Superset of the live sets inlined across the app +
// the in-progress set the Python scraper writes.
export const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF',
  'STATUS_HALFTIME', 'STATUS_END_PERIOD', 'STATUS_OVERTIME',
  'STATUS_FIRST_HALF_EXTRA_TIME', 'STATUS_SECOND_HALF_EXTRA_TIME',
  'STATUS_HALFTIME_ET', 'STATUS_SHOOTOUT',
]);

// STATUS_SCHEDULED is the only "not started" status the scraper writes (as a
// 0-0 stub for future fixtures). Records with no status are legacy/manual and
// are treated as FINAL by the historical gates.
export const SCHEDULED_STATUS = 'STATUS_SCHEDULED';

/** True when the record's status marks the match as settled (or it's a legacy
 *  record with no status). Mirrors the old isFinalResultRecord/isFinalRecord. */
export function isFinalStatus(rec) {
  return !rec?.status || FINAL_STATUSES.has(rec.status);
}

/** True when the record's status marks the match as currently in progress. */
export function isLiveStatus(rec) {
  return !!rec?.status && LIVE_STATUSES.has(rec.status);
}

/**
 * How a (final) match was decided, derived from rec.status.
 * @param {object} rec - an actual_results record.
 * @returns {{ method:'reg'|'aet'|'pens'|null, label:'FT'|'AET'|'pens',
 *             suffix:''|string, shootout:{a:number,b:number}|null }}
 *   - method  : 'reg' (regulation FT), 'aet' (extra time), 'pens' (shootout),
 *               or null when the record is not final.
 *   - label   : the short display label — 'FT' | 'AET' | 'pens'.
 *   - suffix  : '' normally; ' (4–3)' (en-dash, hi–lo) when a shootout tally is
 *               present. Safe to append after a winner/label.
 *   - shootout: { a, b } oriented to the row's team_a/team_b, or null.
 */
export function methodOfVictory(rec) {
  const status = rec?.status || '';
  // A legacy/manual record (no status) is a regulation final.
  const isFinal = !status || FINAL_STATUSES.has(status);
  if (!isFinal) {
    return { method: null, label: 'FT', suffix: '', shootout: null };
  }

  const sa = rec?.shootout_a, sb = rec?.shootout_b;
  const hasShootout = Number.isFinite(sa) && Number.isFinite(sb);
  const shootout = hasShootout ? { a: sa, b: sb } : null;
  // En-dash separator + high–low ordering, matching the matchup-detail copy
  // ("on penalties (max–min)").
  const suffix = hasShootout ? ` (${Math.max(sa, sb)}–${Math.min(sa, sb)})` : '';

  let method, label;
  if (status === 'STATUS_FINAL_PEN') { method = 'pens'; label = 'pens'; }
  else if (status === 'STATUS_FINAL_AET') { method = 'aet'; label = 'AET'; }
  else { method = 'reg'; label = 'FT'; }

  return { method, label, suffix, shootout };
}

/**
 * The winning TEAM NAME for a record, or null.
 * Prefers rec.winner (the canonical advancing team for ET/pen knockouts, where
 * the score is a tie). Otherwise, for a FINAL record with team names supplied,
 * derives the winner from the higher score. Returns null for live/scheduled
 * records and for draws that carry no explicit winner.
 *
 * @param {object} rec   - an actual_results record.
 * @param {string} [teamA] - the row's team_a (the orientation of score_a).
 * @param {string} [teamB] - the row's team_b (the orientation of score_b).
 * @returns {string|null}
 */
export function winnerFromRecord(rec, teamA, teamB) {
  if (!rec) return null;
  // Explicit winner always wins — it's the only correct answer for a tie broken
  // by ET/pens, and it's orientation-independent (a canonical team name).
  if (rec.winner) return rec.winner;
  if (!isFinalStatus(rec)) return null;

  const sa = Number(rec.score_a ?? rec.team_a_score);
  const sb = Number(rec.score_b ?? rec.team_b_score);
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  if (sa === sb) return null; // draw with no explicit winner
  if (!teamA || !teamB) return null; // can't name the winner without sides
  return sa > sb ? teamA : teamB;
}

const HOUR_MS = 60 * 60 * 1000;
// Stage-aware live window: how long after kickoff a started-but-unrecorded match
// is still plausibly "live". Group games run ~2h; knockouts can go to extra time
// + penalties, so allow ~3h before we call a missing record 'pending'.
const GROUP_LIVE_WINDOW_MS = 2 * HOUR_MS;
const KO_LIVE_WINDOW_MS = 3 * HOUR_MS;
const GROUP_STAGES = new Set(['group', 'group_stage']);

function liveWindowMs(stage) {
  return GROUP_STAGES.has(stage) ? GROUP_LIVE_WINDOW_MS : KO_LIVE_WINDOW_MS;
}

/**
 * Classify a fixture into a display mode, STATUS-FIRST.
 * The record's status is authoritative; the clock is only a fallback when there
 * is no usable record (or only a STATUS_SCHEDULED stub). This is what keeps a
 * past-kickoff match with no result from being mislabeled 'final' (it's
 * 'pending') or 'live' (the window has expired).
 *
 * @param {object|null} rec - the actual_results record (may be null/stub).
 * @param {string} [kickoffUtc] - the fixture kickoff (ISO) for the clock fallback.
 * @param {object} [opts]
 * @param {string} [opts.stage] - 'group' | 'round_of_32' | ... (sets the window).
 * @param {number} [opts.now]   - injected clock (ms) for testability.
 * @returns {'upcoming'|'live'|'final'|'pending'}
 *   - 'final'    : status is a FINAL_STATUS.
 *   - 'live'     : status is a LIVE_STATUS.
 *   - 'pending'  : no usable record (or STATUS_SCHEDULED) AND kickoff is past the
 *                  stage-aware live window — result is overdue, not yet recorded.
 *   - 'upcoming' : everything else (future kickoff, or within the live window
 *                  with no record yet).
 */
export function deriveMode(rec, kickoffUtc, opts = {}) {
  const { stage, now = Date.now() } = opts;

  // STATUS-FIRST: a real status decides outright.
  const status = rec?.status || '';
  if (status && FINAL_STATUSES.has(status)) return 'final';
  if (status && LIVE_STATUSES.has(status)) return 'live';

  // No usable status (no record, or a STATUS_SCHEDULED 0-0 stub) → use the clock.
  const k = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
  if (!Number.isFinite(k)) return 'upcoming';
  if (now < k) return 'upcoming';

  const ended = k + liveWindowMs(stage);
  if (now < ended) return 'live';     // started, within the window, no record yet
  return 'pending';                   // overdue with no result — NOT final, NOT live
}
