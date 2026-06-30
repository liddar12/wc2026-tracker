/* win-prob.js — RJ30-5: the pure, node-testable live win-probability model.
   No DOM, no network, no external model: a transparent blend of the pre-match
   PRIOR with the CURRENT-SCORE-implied result, weighted by a clock factor that
   grows toward full time. The component (app/components/win-probability.js)
   renders this; the standings/scoring paths never touch it (display only).

   Design properties locked by tests/feature/rj30-winprob.test.mjs:
   - outputs are a normalized distribution in [0,1] (clamped off the endpoints);
   - at minute ~1 with 0-0 the result is ~the prior (clock weight ~0);
   - leading later ⇒ higher leader win%, trailing team crushed (monotone minute);
   - bigger lead ⇒ higher leader win% (monotone margin);
   - drawing late inflates the draw segment vs kickoff;
   - knockout (pd===0) collapses to a two-way {a,b} split (d===0), and a late
     tie favors the higher-prior side (the model's advance pick);
   - never exactly 0 or 1 so the sparkline never flatlines;
   - a missing/NaN minute is treated as a stage default, never NaN.
*/

const EPS = 0.001; // floor/ceiling so probabilities never hit 0 or 1

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Clock weight: how much the live SCORE overrides the pre-match PRIOR. 0 at
// kickoff, ~1 at full time. Group games cap at 0.98; knockout extra time/pens
// cap a touch higher (0.98/0.99) so the bar doesn't pin to 100/0 and erase the
// sparkline. A missing minute falls back to a stage default (early game).
function clockWeight(minute, stage) {
  const m = Number(minute);
  const ko = isKnockoutStage(stage);
  // Stage default when the clock is missing (ESPN omits displayClock at HT):
  // treat as an early-second-half snapshot rather than NaN.
  const mins = Number.isFinite(m) ? m : 50;
  const cap = ko ? 0.99 : 0.98;
  return clamp(mins / 95, 0, cap);
}

function isKnockoutStage(stage) {
  return !!stage && stage !== 'group' && stage !== 'group_stage';
}

/**
 * Live win probability — blend prior with current-score-implied result.
 * @param {object} p
 * @param {number} p.pa  pre-match P(team_a wins), a fraction in [0,1].
 * @param {number} p.pd  pre-match P(draw), fraction (0 for knockout — no draw).
 * @param {number} p.pb  pre-match P(team_b wins), fraction.
 * @param {number} p.scoreA current goals for team_a.
 * @param {number} p.scoreB current goals for team_b.
 * @param {number} p.minute current match minute (may be NaN/missing).
 * @param {string} p.stage 'group' | 'round_of_16' | ... (knockout ⇒ no draw).
 * @returns {{a:number,d:number,b:number}} normalized, each in (0,1), summing 1.
 *   For knockout (pd===0) d is exactly 0 and {a,b} sum to 1.
 */
export function liveWinProb({ pa, pd, pb, scoreA, scoreB, minute, stage } = {}) {
  const ko = isKnockoutStage(stage) || !(Number(pd) > 0);

  // Sanitize the prior into a proper distribution.
  let priorA = Math.max(0, Number(pa) || 0);
  let priorD = ko ? 0 : Math.max(0, Number(pd) || 0);
  let priorB = Math.max(0, Number(pb) || 0);
  let psum = priorA + priorD + priorB;
  if (!(psum > 0)) { priorA = ko ? 0.5 : 1 / 3; priorD = ko ? 0 : 1 / 3; priorB = ko ? 0.5 : 1 / 3; psum = 1; }
  priorA /= psum; priorD /= psum; priorB /= psum;

  const sa = Number(scoreA) || 0;
  const sb = Number(scoreB) || 0;
  const lead = sa - sb;
  const m = Number.isFinite(Number(minute)) ? Number(minute) : 50;
  const w = clockWeight(minute, stage);

  // Score-implied result vector. A lead is NOT certainty: soften by margin +
  // minute so a 1-0 at 20' is far less sure than a 2-0 at 88'.
  let impA, impD, impB;
  if (lead === 0) {
    // Currently level. As the clock runs the standing result (a draw) grows;
    // for knockout there is no draw outcome, so split the "still level" mass
    // toward the higher-prior side (the model's advance pick at a late tie).
    if (ko) {
      // late tie favors the model pick; near kickoff stays ~prior
      const tilt = priorA >= priorB ? 1 : -1;
      const edge = 0.5 + tilt * 0.5 * clamp(m / 120, 0, 0.6);
      impA = priorA >= priorB ? edge : 1 - edge;
      impB = 1 - impA;
      impD = 0;
    } else {
      impD = clamp(0.5 + 0.004 * m, 0.5, 0.92); // draw mass grows with the clock
      const rem = 1 - impD;
      const denom = priorA + priorB || 1;
      impA = rem * (priorA / denom);
      impB = rem * (priorB / denom);
    }
  } else {
    const sign = lead > 0 ? 1 : -1;
    const mag = Math.abs(lead);
    // Leader probability: grows with margin AND minute, capped below 1. The
    // margin term must keep biting up to a 3-goal lead (so 2-0 > 1-0 at the same
    // minute), and the minute term is gentle so a 1-goal lead at 70' isn't
    // already pinned to the cap (which would erase the margin gradient).
    const pLead = clamp(
      0.55 + 0.13 * Math.min(mag, 3) + 0.0026 * m + 0.0006 * Math.min(mag, 3) * m,
      0.5,
      0.992,
    );
    const rem = 1 - pLead;
    if (ko) {
      // No draw: the trailer gets all the remainder.
      if (sign > 0) { impA = pLead; impB = rem; }
      else { impB = pLead; impA = rem; }
      impD = 0;
    } else {
      // Remainder split between draw and the trailer, shaped by prior + clock:
      // late in the game a comeback-to-win is rarer than a late equalizer, so
      // most remainder goes to the draw as time runs out.
      const drawShare = clamp(0.30 + 0.004 * m, 0.30, 0.85);
      impD = rem * drawShare;
      const other = rem - impD;
      if (sign > 0) { impA = pLead; impB = other; }
      else { impB = pLead; impA = other; }
    }
  }

  // Blend prior with score-implied by the clock weight, then normalize.
  let a = (1 - w) * priorA + w * impA;
  let d = (1 - w) * priorD + w * impD;
  let b = (1 - w) * priorB + w * impB;
  if (ko) d = 0;

  // Clamp off the endpoints so the sparkline never flatlines, then renormalize.
  const ceil = 1 - EPS;
  a = clamp(a, EPS, ceil);
  b = clamp(b, EPS, ceil);
  d = ko ? 0 : clamp(d, EPS, ceil);
  const sum = a + d + b;
  return { a: a / sum, d: ko ? 0 : d / sum, b: b / sum };
}

// --- series for the sparkline -------------------------------------------------

const STAGE_FOR_SERIES = (found) => found?.stage || found?.actual?.stage || 'group';

/** Extract the (pa,pd,pb) prior fractions from a matchup row. Group rows carry
 *  `probabilities {team_a_wins,draw,team_b_wins}` (percent); knockout rows carry
 *  `advance_pct_a/_b` (percent, no draw). Returns null when no prior exists. */
export function priorFromMatch(match) {
  if (!match) return null;
  const pr = match.probabilities;
  if (pr && (Number.isFinite(pr.team_a_wins) || Number.isFinite(pr.team_b_wins))) {
    const pa = (pr.team_a_wins || 0) / 100;
    const pd = (pr.draw || 0) / 100;
    const pb = (pr.team_b_wins || 0) / 100;
    if (pa + pd + pb > 0) return { pa, pd, pb, knockout: false };
  }
  if (Number.isFinite(match.advance_pct_a) || Number.isFinite(match.advance_pct_b)) {
    const pa = (match.advance_pct_a || 0) / 100;
    const pb = (match.advance_pct_b || 0) / 100;
    if (pa + pb > 0) return { pa, pd: 0, pb, knockout: true };
  }
  return null;
}

/**
 * Leader-win% trajectory (percent 0..100) from kickoff → current minute, for the
 * sparkline. Recomputes liveWinProb at 0,15,30,...,currentMinute against the
 * CURRENT score (a smooth "since-kickoff trajectory toward the current state" —
 * we don't persist per-minute history here; the component appends real observed
 * points across polls). Returns [] when the record is not live or has no prior.
 * @param {object} match - the matchup row (prior source).
 * @param {object|null} found - actualForCard() result ({mode, actual:{score_a,score_b,minute}}).
 * @returns {number[]} leader-win% samples in [0,100].
 */
export function winProbSeries(match, found, sampleMinutes) {
  if (!found || found.mode !== 'live') return [];
  const prior = priorFromMatch(match);
  if (!prior) return [];
  const actual = found.actual || {};
  const scoreA = Number(actual.score_a) || 0;
  const scoreB = Number(actual.score_b) || 0;
  const curMin = Number.isFinite(Number(actual.minute)) ? Number(actual.minute) : 50;
  const stage = STAGE_FOR_SERIES(found) === 'group' && prior.knockout ? 'round_of_16' : STAGE_FOR_SERIES(found);

  const minutes = Array.isArray(sampleMinutes) && sampleMinutes.length
    ? sampleMinutes
    : buildMinutes(curMin);

  // Which side is currently the "leader" for the trajectory line? Use the live
  // leader (or the higher prior at a tie) so the line trends toward the team the
  // sparkline is about.
  const leadSide = scoreA > scoreB ? 'a'
    : scoreB > scoreA ? 'b'
    : (prior.pa >= prior.pb ? 'a' : 'b');

  return minutes.map((min) => {
    const r = liveWinProb({ pa: prior.pa, pd: prior.pd, pb: prior.pb, scoreA, scoreB, minute: min, stage });
    return clamp((leadSide === 'a' ? r.a : r.b) * 100, 0, 100);
  });
}

function buildMinutes(curMin) {
  const out = [0];
  for (let t = 15; t < curMin; t += 15) out.push(t);
  out.push(Math.max(curMin, 1));
  // Always at least two points so the sparkline draws a line.
  if (out.length < 2) out.push(curMin);
  return out;
}
