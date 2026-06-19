/* projected-bracket-tree.js — Phase 1 enhanced Projected bracket (BR-1…BR-4).
 *
 * Video-inspired: a top stage nav (GS · R32 · R16 · QF · SF · F) that scrolls /
 * zooms the bracket, +/−/fit zoom buttons, the existing left-right swipe
 * (canvas scroll), connector-line tree (R32→Final + 3rd place), and per-pick
 * confidence (the active model's matchup win %, shaded). GS shows group
 * standings feeding the projected R32. Read-only; what-if + pinch-zoom are
 * Phase 2 (docs/PROJECTED_BRACKET_ENHANCEMENT.md). Vanilla JS, CSS transforms.
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { setRoute } from '../state.js';
import { renderModelPicker } from './model-picker.js';
import { buildAutofill } from '../bracket-autofill.js';
import { MODELS, modelToAutofillSource, getActiveModel } from '../lib/active-model.js';
import { computeGroupStandings, computeProjectedGroupOrder } from '../bracket-resolver.js';

const ROUNDS = [
  { key: 'r32', label: 'R32', full: 'Round of 32', lo: 73, hi: 88 },
  { key: 'r16', label: 'R16', full: 'Round of 16', lo: 89, hi: 96 },
  { key: 'qf', label: 'QF', full: 'Quarterfinals', lo: 97, hi: 100 },
  { key: 'sf', label: 'SF', full: 'Semifinals', lo: 101, hi: 102 },
  { key: 'final', label: 'F', full: 'Final', lo: 104, hi: 104 },
];
const STAGES = [{ key: 'gs', label: 'GS' }, ...ROUNDS.map((r) => ({ key: r.key, label: r.label }))];
const ZOOMS = [0.55, 0.7, 0.85, 1, 1.2];
const isPlaceholder = (n) => !n || /^\d[A-L]$|^[A-L]\d|^3[A-L/ ]|^W\d|^L\d|^1[A-L]|^2[A-L]|^RU/i.test(String(n));

// --- per-source team strength → matchup win % (confidence shading) -----------
function strengthMap(data, source) {
  const teams = data?.teams || {};
  const m = {};
  if (source === 'dt') {
    for (const r of data?.dtModel?.team_rankings || []) if (r.country) m[r.country] = r.rating;
    if (Object.keys(m).length) return m;
  } else if (source === 'kalshi') {
    for (const r of data?.markets?.tournament_winner || []) if (r.team) m[r.team] = r.prob_pct;
    if (Object.keys(m).length) return m;
  } else if (source === 'hybrid') {
    for (const r of data?.forecast?.teams || []) if (r.team) m[r.team] = r.hybrid_strength;
    if (Object.keys(m).length) return m;
  }
  for (const [n, t] of Object.entries(teams)) m[n] = t.composite || 0;
  return m;
}
function confidence(map, winner, other) {
  if (isPlaceholder(winner) || isPlaceholder(other)) return null;
  const vals = Object.values(map).filter((v) => typeof v === 'number');
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  const p = 1 / (1 + Math.exp(-((map[winner] || mean) - (map[other] || mean)) / sd));
  return Math.round(Math.max(p, 1 - p) * 100);
}

export function renderProjectedBracket(root, data, params = {}) {
  root.innerHTML = '';
  let model = params.model && MODELS.includes(params.model) ? params.model : getActiveModel();
  if (!MODELS.includes(model)) model = 'hybrid';
  const source = modelToAutofillSource(model);
  const stage = STAGES.some((s) => s.key === params.stage) ? params.stage : 'r32';
  const zoom = Number(params.zoom) || 1;

  // model picker (reroutes within /projected, preserving stage)
  root.appendChild(renderModelPicker({
    active: model,
    onChange: (m) => setRoute(params.routeName || 'projected', { model: m, stage, zoom }),
  }));

  // stage nav + zoom controls
  root.appendChild(renderStageNav(stage, zoom, params.routeName || 'projected', model));

  if (stage === 'gs') {
    root.appendChild(renderGroupSeeding(data, source));
    return;
  }

  let rows;
  try { rows = buildAutofill(data, source) || []; } catch { rows = []; }
  if (!rows.length) {
    const e = document.createElement('div');
    e.className = 'home-card';
    e.innerHTML = '<p class="muted" style="margin:0;">Projection unavailable — model data is still loading.</p>';
    root.appendChild(e);
    return;
  }
  root.appendChild(renderTree(rows, strengthMap(data, source), zoom, stage));
}

function renderStageNav(stage, zoom, routeName, model) {
  const wrap = document.createElement('section');
  wrap.className = 'eb-nav';
  wrap.dataset.testid = 'eb-stage-nav';
  const tabs = STAGES.map((s) => `<button class="eb-stage${s.key === stage ? ' is-active' : ''}" data-stage="${s.key}" data-testid="eb-stage-${s.key}">${s.label}</button>`).join('');
  const zi = Math.max(0, ZOOMS.indexOf(zoom) === -1 ? 3 : ZOOMS.indexOf(zoom));
  wrap.innerHTML = `
    <div class="eb-stages" role="tablist" aria-label="Round">${tabs}</div>
    <div class="eb-zoom" role="group" aria-label="Zoom">
      <button class="eb-zoom-btn" data-zoom="out" aria-label="Zoom out">−</button>
      <button class="eb-zoom-btn" data-zoom="fit" aria-label="Fit whole bracket">Fit</button>
      <button class="eb-zoom-btn" data-zoom="in" aria-label="Zoom in">＋</button>
    </div>`;
  wrap.querySelectorAll('[data-stage]').forEach((b) => {
    b.addEventListener('click', () => setRoute(routeName, { model, stage: b.dataset.stage, zoom }));
  });
  wrap.querySelector('[data-zoom="fit"]').addEventListener('click', () => setRoute(routeName, { model, stage, zoom: ZOOMS[0] }));
  wrap.querySelector('[data-zoom="in"]').addEventListener('click', () => setRoute(routeName, { model, stage, zoom: ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)] }));
  wrap.querySelector('[data-zoom="out"]').addEventListener('click', () => setRoute(routeName, { model, stage, zoom: ZOOMS[Math.max(0, zi - 1)] }));
  return wrap;
}

function teamRow(name, isWinner, conf) {
  if (isPlaceholder(name)) return `<div class="eb-team eb-tbd">${escapeHtml(String(name || 'TBD'))}</div>`;
  const pct = isWinner && conf != null ? `<span class="eb-conf" style="--c:${conf}">${conf}%</span>` : '';
  return `<div class="eb-team${isWinner ? ' eb-win' : ''}"${isWinner && conf != null ? ` data-conf="${conf}"` : ''}>
    <span class="eb-team-name">${flagFor(name)} ${escapeHtml(name)}</span>${pct}</div>`;
}

function renderTree(rows, smap, zoom, stage) {
  const byNum = new Map(rows.map((r) => [r.matchNumber, r]));
  const wrap = document.createElement('section');
  wrap.className = 'home-card eb-canvas-wrap';
  wrap.dataset.testid = 'eb-bracket';
  const cols = ROUNDS.map((rd) => {
    const cells = [];
    for (let n = rd.lo; n <= rd.hi; n++) {
      const r = byNum.get(n);
      if (!r) continue;
      const conf = confidence(smap, r.team, r.team_a === r.team ? r.team_b : r.team_a);
      cells.push(`<div class="eb-match">
        ${teamRow(r.team_a, r.team_a === r.team, conf)}
        ${teamRow(r.team_b, r.team_b === r.team, conf)}
      </div>`);
    }
    return `<div class="eb-col" data-round="${rd.key}"><div class="eb-col-head">${rd.full}</div><div class="eb-col-body">${cells.join('')}</div></div>`;
  }).join('');
  const tp = byNum.get(103);
  const third = tp ? `<div class="eb-col eb-col-third"><div class="eb-col-head">3rd place</div><div class="eb-col-body"><div class="eb-match">
      ${teamRow(tp.team_a, tp.team_a === tp.team, confidence(smap, tp.team, tp.team_a === tp.team ? tp.team_b : tp.team_a))}
      ${teamRow(tp.team_b, tp.team_b === tp.team, null)}
    </div></div></div>` : '';
  wrap.innerHTML = `<div class="eb-canvas" data-testid="eb-canvas"><div class="eb-tree" style="transform:scale(${zoom})">${cols}${third}</div></div>`;
  // scroll to the requested round after layout
  requestAnimationFrame(() => {
    const target = wrap.querySelector(`.eb-col[data-round="${stage}"]`);
    if (target && stage !== 'r32') target.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
  return wrap;
}

function renderGroupSeeding(data, source) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.dataset.testid = 'eb-group-seeding';
  const groups = Object.keys(data?.groupMatchups || {}).sort();
  let rowsHtml = '';
  for (const g of groups) {
    // Real standings once a group is complete; projected order before then.
    let standings = [];
    try { standings = computeGroupStandings(data, g) || computeProjectedGroupOrder(data, g) || []; } catch { standings = []; }
    const lines = standings.slice(0, 4).map((s, i) => {
      const nm = s.team || s.name || s;
      const raw = s.points ?? s.pts;
      const pts = typeof raw === 'number' ? (Number.isInteger(raw) ? raw : raw.toFixed(1)) : (raw ?? '');
      return `<li class="eb-gs-row"><span class="eb-gs-pos">${i + 1}</span><span class="eb-gs-team">${flagFor(nm)} ${escapeHtml(String(nm))}</span><span class="eb-gs-pts muted">${pts}</span></li>`;
    }).join('');
    rowsHtml += `<div class="eb-gs-group"><h4 class="eb-gs-head">Group ${escapeHtml(g)}</h4><ol class="eb-gs-list">${lines}</ol></div>`;
  }
  wrap.innerHTML = `
    <p class="muted" style="margin:0 0 10px;font-size:12px;">Projected group standings — top two (and best thirds) seed the Round of 32. Tap R32 to see the matchups.</p>
    <div class="eb-gs-grid">${rowsHtml}</div>`;
  return wrap;
}
