/* win-probability.js — RJ30-5: the DOM-emitting live win-probability widget.
   Pure display: it reads the static pre-match prior off the matchup row and the
   live score/minute off actualForCard()'s `found`, runs the pure model in
   app/lib/win-prob.js, and renders a tri-/two-segment probability bar (reusing
   the .confidence-bar tokens so it rhymes with the model bar above it) plus a
   reused SVG sparkline of the leader's win% trajectory. Never writes to
   actualResults, never advances a bracket, never awards points.

   Returns an EMPTY fragment unless found.mode === 'live' AND a prior exists, so
   upcoming/pending/final/no-prior rows render nothing (Story B).
*/
import { escapeHtml } from '../lib/escape.js';
import { sparklineSvg } from './sparkline.js';
import { liveWinProb, winProbSeries, priorFromMatch } from '../lib/win-prob.js';

const SERIES_CAP = 40;

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
  const stage = prior.knockout ? (match.stage && match.stage !== 'group' ? match.stage : 'round_of_16') : 'group';

  const r = liveWinProb({
    pa: prior.pa, pd: prior.pd, pb: prior.pb,
    scoreA, scoreB, minute: Number(minuteRaw), stage,
  });

  const ko = prior.knockout;
  const parts = ko ? [r.a, r.b] : [r.a, r.d, r.b];
  const pct = roundTo100(parts);
  const [pa, pmid, pb] = ko ? [pct[0], null, pct[1]] : pct;

  const minuteLabel = (minuteRaw != null && String(minuteRaw).trim() !== '')
    ? ` ${escapeHtml(String(minuteRaw))}'` : '';

  const sec = document.createElement('div');
  sec.className = 'section live-win-prob confidence-bar';
  sec.setAttribute('data-testid', 'live-win-prob');
  if (prefersReducedMotion()) sec.setAttribute('data-reduced-motion', 'true');

  const heading = document.createElement('div');
  heading.className = 'bar-title';
  heading.innerHTML = `Live win probability <small class="live-indicator">LIVE${minuteLabel}</small>`;
  sec.appendChild(heading);

  // Tri/two-segment bar reusing the .confidence-bar .bars tokens.
  const bars = document.createElement('div');
  bars.className = 'bars';
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', ko
    ? `${match.team_a} ${pa} percent to advance, ${match.team_b} ${pb} percent`
    : `${match.team_a} ${pa} percent, draw ${pmid} percent, ${match.team_b} ${pb} percent`);
  const segA = document.createElement('div');
  segA.className = 'seg-a';
  segA.style.width = `${r.a * 100}%`;
  bars.appendChild(segA);
  if (!ko) {
    const segD = document.createElement('div');
    segD.className = 'seg-d';
    segD.style.width = `${r.d * 100}%`;
    bars.appendChild(segD);
  }
  const segB = document.createElement('div');
  segB.className = 'seg-b';
  segB.style.width = `${r.b * 100}%`;
  bars.appendChild(segB);
  // Respect reduced motion: no width transition when the user opted out.
  if (prefersReducedMotion()) {
    for (const s of bars.children) s.style.transition = 'none';
  }
  sec.appendChild(bars);

  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = ko
    ? `<span data-side="a"><strong>${pa}%</strong> ${escapeHtml(match.team_a)}</span>
       <span data-side="b">${escapeHtml(match.team_b)} <strong>${pb}%</strong></span>`
    : `<span data-side="a"><strong>${pa}%</strong> ${escapeHtml(match.team_a)}</span>
       <span data-side="d"><strong>${pmid}%</strong> draw</span>
       <span data-side="b">${escapeHtml(match.team_b)} <strong>${pb}%</strong></span>`;
  sec.appendChild(labels);

  // Reused sparkline (60×16 for 390px legibility) of the leader's win% movement.
  const series = observedSeries(match, found);
  if (series.length >= 2) {
    const trend = document.createElement('div');
    trend.className = 'win-prob-trend';
    const lead = scoreA >= scoreB ? match.team_a : match.team_b;
    const note = document.createElement('span');
    note.className = 'muted win-prob-trend-note';
    note.textContent = `${lead} win% since kickoff`;
    trend.appendChild(note);
    trend.appendChild(sparklineSvg(series, { width: 60, height: 16, className: 'sparkline win-prob-spark' }));
    sec.appendChild(trend);
  }

  return sec;
}
