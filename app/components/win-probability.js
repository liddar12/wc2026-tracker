/* win-probability.js — RJ30-5: the DOM-emitting live win-probability widget.
   Pure display: it reads the static pre-match prior off the matchup row and the
   live score/minute off actualForCard()'s `found`, runs the pure model in
   app/lib/win-prob.js, and renders:
     - GROUP: a 3-way win/draw/win bar.
     - KNOCKOUT: a 2-segment "to advance" bar (team-colored, NO draw segment)
       plus a deterministic "extra time / penalties" likelihood line.
     - BOTH: two thin stacked bars — "Now (live)" (the live-blended probs) and
       "Pre-match (model)" (the static prior) — so the shift from kickoff is
       visible at a glance.
     - a LARGER labeled sparkline of the leader's win% trajectory since kickoff,
       with a 50% baseline reference + goal markers.
   Never writes to actualResults, never advances a bracket, never awards points.

   Returns an EMPTY fragment unless found.mode === 'live' AND a prior exists, so
   upcoming/pending/final/no-prior rows render nothing (Story B).
*/
import { escapeHtml } from '../lib/escape.js';
import { sparklineSvg } from './sparkline.js';
import { liveWinProb, winProbSeries, priorFromMatch, estimateExtraTime } from '../lib/win-prob.js';

const SERIES_CAP = 40;
const SVGNS = 'http://www.w3.org/2000/svg';

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

// Largest-remainder rounding so the displayed integer percents always sum to 100
// (no "33/33/33 = 99"). Keeps the bar and the labels consistent.
function roundTo100(parts) {
  const scaled = parts.map((p) => p * 100);
  const floors = scaled.map(Math.floor);
  let rem = 100 - floors.reduce((s, v) => s + v, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((x, y) => y.frac - x.frac);
  const out = floors.slice();
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i] += 1; rem--; }
  return out;
}

// Append the real observed leader-win% point to the persisted per-match series,
// deduped by minute and capped at SERIES_CAP. Falls back to the synthetic
// since-kickoff trajectory on first paint so the sparkline always has ≥2 points.
function observedSeries(match, found) {
  const id = match?.match_id || `${match?.team_a}__${match?.team_b}`;
  const store = (typeof window !== 'undefined')
    ? (window.__wc26WinProbSeries || (window.__wc26WinProbSeries = {}))
    : {};
  const synthetic = winProbSeries(match, found);
  if (!synthetic.length) return [];

  const minute = Number(found?.actual?.minute);
  const latest = synthetic[synthetic.length - 1];
  const prev = Array.isArray(store[id]) ? store[id] : null;

  if (!prev) {
    // First paint: seed with the synthetic trajectory toward the current state.
    store[id] = synthetic.slice(-SERIES_CAP);
    return store[id].slice();
  }
  // Subsequent polls: append the actual observed point (deduped by minute).
  const lastMinute = store[`${id}__m`];
  if (Number.isFinite(minute) && minute === lastMinute) {
    // Same minute — replace the tail rather than double-appending.
    prev[prev.length - 1] = latest;
  } else {
    prev.push(latest);
    if (Number.isFinite(minute)) store[`${id}__m`] = minute;
  }
  while (prev.length > SERIES_CAP) prev.shift();
  store[id] = prev;
  return prev.slice();
}

// A thin two/three-segment probability bar. `probs` is [{cls,width,pct?}...].
function thinBar(probs, ariaLabel, reduced) {
  const bars = document.createElement('div');
  bars.className = 'bars';
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', ariaLabel);
  for (const p of probs) {
    const seg = document.createElement('div');
    seg.className = p.cls;
    seg.style.width = `${p.width}%`;
    if (reduced) seg.style.transition = 'none';
    bars.appendChild(seg);
  }
  return bars;
}

// One labeled stacked mini-bar row: a caption ("Now (live)" / "Pre-match (model)")
// above a thin segment bar. Keeps the shift from kickoff visible.
function stackedBarRow(caption, probs, ariaLabel, reduced) {
  const wrap = document.createElement('div');
  wrap.className = 'wp-stack-row';
  const cap = document.createElement('span');
  cap.className = 'wp-stack-cap muted';
  cap.textContent = caption;
  wrap.appendChild(cap);
  wrap.appendChild(thinBar(probs, ariaLabel, reduced));
  return wrap;
}

/**
 * Build the live win-probability widget for a matchup.
 * @param {object} match - the matchup row (carries the static prior).
 * @param {object|null} found - actualForCard() result ({mode, actual{...}}).
 * @param {object} [opts]
 * @returns {DocumentFragment|HTMLElement} an empty fragment unless live + prior.
 */
export function liveWinProbability(match, found, opts = {}) {
  if (!found || found.mode !== 'live') return document.createDocumentFragment();
  const prior = priorFromMatch(match);
  if (!prior) return document.createDocumentFragment();

  const actual = found.actual || {};
  const scoreA = Number(actual.score_a) || 0;
  const scoreB = Number(actual.score_b) || 0;
  const minuteRaw = actual.minute;
  const ko = prior.knockout;
  const stage = ko ? (match.stage && match.stage !== 'group' ? match.stage : 'round_of_16') : 'group';
  const reduced = prefersReducedMotion();

  // LIVE (blended) probabilities.
  const live = liveWinProb({
    pa: prior.pa, pd: prior.pd, pb: prior.pb,
    scoreA, scoreB, minute: Number(minuteRaw), stage,
  });
  // PRE-MATCH (static prior) probabilities — the same model at kickoff (minute 0,
  // 0-0), so the two bars share a scale and the shift reads cleanly.
  const pre = liveWinProb({
    pa: prior.pa, pd: prior.pd, pb: prior.pb,
    scoreA: 0, scoreB: 0, minute: 0, stage,
  });

  const liveParts = ko ? [live.a, live.b] : [live.a, live.d, live.b];
  const preParts = ko ? [pre.a, pre.b] : [pre.a, pre.d, pre.b];
  const livePct = roundTo100(liveParts);
  const prePct = roundTo100(preParts);
  const [pa, pmid, pb] = ko ? [livePct[0], null, livePct[1]] : livePct;
  const [prea, , preb] = ko ? [prePct[0], null, prePct[1]] : prePct;

  const minuteLabel = (minuteRaw != null && String(minuteRaw).trim() !== '')
    ? ` ${escapeHtml(String(minuteRaw))}'` : '';

  const sec = document.createElement('div');
  sec.className = 'section live-win-prob confidence-bar';
  sec.setAttribute('data-testid', 'live-win-prob');
  if (reduced) sec.setAttribute('data-reduced-motion', 'true');

  const heading = document.createElement('div');
  heading.className = 'bar-title';
  heading.innerHTML = `Win probability <small class="live-indicator">LIVE${minuteLabel}</small>`;
  sec.appendChild(heading);

  // ---- Primary (live) bar — 3-way for group, 2-way "to advance" for knockout.
  const primaryAria = ko
    ? `${match.team_a} ${pa} percent to advance, ${match.team_b} ${pb} percent`
    : `${match.team_a} ${pa} percent, draw ${pmid} percent, ${match.team_b} ${pb} percent`;
  const primaryProbs = ko
    ? [{ cls: 'seg-a', width: live.a * 100 }, { cls: 'seg-b', width: live.b * 100 }]
    : [{ cls: 'seg-a', width: live.a * 100 }, { cls: 'seg-d', width: live.d * 100 }, { cls: 'seg-b', width: live.b * 100 }];
  sec.appendChild(thinBar(primaryProbs, primaryAria, reduced));

  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = ko
    ? `<span data-side="a"><strong>${pa}%</strong> ${escapeHtml(match.team_a)}</span>
       <span data-side="b">${escapeHtml(match.team_b)} <strong>${pb}%</strong></span>`
    : `<span data-side="a"><strong>${pa}%</strong> ${escapeHtml(match.team_a)}</span>
       <span data-side="d"><strong>${pmid}%</strong> draw</span>
       <span data-side="b">${escapeHtml(match.team_b)} <strong>${pb}%</strong></span>`;
  sec.appendChild(labels);

  // For knockout, an explicit "to advance" caption under the labels.
  if (ko) {
    const advNote = document.createElement('div');
    advNote.className = 'muted wp-advance-note';
    advNote.textContent = `${match.team_a} ${pa}% to advance · ${match.team_b} ${pb}%`;
    sec.appendChild(advNote);
  }

  // ---- Two stacked thin bars: Now (live) vs Pre-match (model) — the shift.
  const stack = document.createElement('div');
  stack.className = 'wp-stacks';
  const liveStackAria = ko
    ? `Now, ${match.team_a} ${pa} percent to advance, ${match.team_b} ${pb} percent`
    : `Now, ${match.team_a} ${pa} percent, draw ${pmid} percent, ${match.team_b} ${pb} percent`;
  const preStackAria = ko
    ? `Pre-match, ${match.team_a} ${prea} percent to advance, ${match.team_b} ${preb} percent`
    : `Pre-match, ${match.team_a} ${prePct[0]} percent, draw ${prePct[1]} percent, ${match.team_b} ${prePct[2]} percent`;
  stack.appendChild(stackedBarRow('Now (live)', primaryProbs, liveStackAria, reduced));
  const preProbs = ko
    ? [{ cls: 'seg-a', width: pre.a * 100 }, { cls: 'seg-b', width: pre.b * 100 }]
    : [{ cls: 'seg-a', width: pre.a * 100 }, { cls: 'seg-d', width: pre.d * 100 }, { cls: 'seg-b', width: pre.b * 100 }];
  stack.appendChild(stackedBarRow('Pre-match (model)', preProbs, preStackAria, reduced));
  sec.appendChild(stack);

  // ---- Knockout extra-time / penalties likelihood line.
  if (ko) {
    const { etPct, pkPct } = estimateExtraTime({
      pa: prior.pa, pb: prior.pb, scoreA, scoreB, minute: Number(minuteRaw), stage,
    });
    if (etPct > 0 || pkPct > 0) {
      const etpk = document.createElement('div');
      etpk.className = 'et-pk muted';
      etpk.setAttribute('data-testid', 'et-pk');
      etpk.textContent = `≈ ${etPct}% extra time · ${pkPct}% penalties`;
      sec.appendChild(etpk);
    }
  }

  // ---- Larger labeled trend sparkline with a 50% baseline + goal markers.
  const series = observedSeries(match, found);
  if (series.length >= 2) {
    const lead = scoreA > scoreB ? match.team_a
      : scoreB > scoreA ? match.team_b
      : (prior.pa >= prior.pb ? match.team_a : match.team_b);
    sec.appendChild(trendPanel(series, lead, reduced));
  }

  return sec;
}

// Larger labeled trend: title + a wrapped sparkline with a 50% baseline reference
// line and goal markers at the minutes where the leader-win% jumped (a proxy for a
// score change), reusing sparklineSvg for the trajectory line itself.
function trendPanel(series, leadName, reduced) {
  const W = 120;
  const H = 28;
  const trend = document.createElement('div');
  trend.className = 'win-prob-trend';

  const title = document.createElement('span');
  title.className = 'muted win-prob-trend-note';
  title.textContent = `Win probability since kickoff — ${leadName} leading`;
  trend.appendChild(title);

  const wrap = document.createElement('div');
  wrap.className = 'win-prob-spark-wrap';

  // Baseline (50%) + markers overlay. Drawn as its own tiny SVG behind the line so
  // we don't have to modify the shared sparklineSvg. If SVG isn't available (test
  // shim without createElementNS), skip the overlay gracefully.
  if (typeof document.createElementNS === 'function') {
    const overlay = document.createElementNS(SVGNS, 'svg');
    overlay.setAttribute('width', String(W));
    overlay.setAttribute('height', String(H));
    overlay.setAttribute('viewBox', `0 0 ${W} ${H}`);
    overlay.setAttribute('class', 'win-prob-spark-overlay');
    overlay.setAttribute('aria-hidden', 'true');

    // 50% baseline reference.
    const base = document.createElementNS(SVGNS, 'line');
    const yMid = (H / 2).toFixed(1);
    base.setAttribute('x1', '0');
    base.setAttribute('y1', yMid);
    base.setAttribute('x2', String(W));
    base.setAttribute('y2', yMid);
    base.setAttribute('class', 'win-prob-baseline');
    overlay.appendChild(base);

    // Goal markers: minutes where the leader-win% moved sharply (a score change).
    const markerIdx = goalMarkerIndices(series);
    const stepX = series.length > 1 ? W / (series.length - 1) : W;
    for (const i of markerIdx) {
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', (i * stepX).toFixed(1));
      dot.setAttribute('cy', yMid);
      dot.setAttribute('r', '2.2');
      dot.setAttribute('class', 'win-prob-goal-mark');
      overlay.appendChild(dot);
    }
    wrap.appendChild(overlay);
  }

  const spark = sparklineSvg(series, { width: W, height: H, className: 'sparkline win-prob-spark' });
  if (reduced && spark && spark.setAttribute) spark.setAttribute('data-reduced-motion', 'true');
  wrap.appendChild(spark);

  trend.appendChild(wrap);
  return trend;
}

// Indices where the series jumps by ≥8 points between consecutive samples — a
// proxy for the minute a goal changed the picture. Empty when the line is flat.
function goalMarkerIndices(series, threshold = 8) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    if (Math.abs(Number(series[i]) - Number(series[i - 1])) >= threshold) out.push(i);
  }
  return out;
}
