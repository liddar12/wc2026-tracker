/* projected-bracket-tree.js — enhanced Projected bracket.
 *
 * Phase 1 (BR-1..4): connector-line tree (R32→Final + 3rd), stage nav
 * (GS·R32·R16·QF·SF·F), zoom (−/＋/fit), per-pick confidence (model win %).
 * Phase 2 (BR-6/BR-7): tap a winner to override → bracket re-cascades, with a
 * diff-vs-model marker + reset (what-if); tap a group team in GS → highlight
 * its projected path. Gesture pinch-zoom (BR-5) intentionally skipped.
 * Read-mostly; overrides are in-session only. Vanilla JS + CSS transforms.
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { setRoute } from '../state.js';
import { renderModelPicker } from './model-picker.js';
import { buildAutofill } from '../bracket-autofill.js';
import { MODELS, modelToAutofillSource, getActiveModel } from '../lib/active-model.js';
import { computeGroupStandings, computeProjectedGroupOrder } from '../bracket-resolver.js';
import { computeLuckIndex, remainingKnockoutTeams, luckChips } from '../lib/luck-index.js';

const ROUNDS = [
  { key: 'r32', full: 'Round of 32', lo: 73, hi: 88 },
  { key: 'r16', full: 'Round of 16', lo: 89, hi: 96 },
  { key: 'qf', full: 'Quarterfinals', lo: 97, hi: 100 },
  { key: 'sf', full: 'Semifinals', lo: 101, hi: 102 },
  { key: 'final', full: 'Final', lo: 104, hi: 104 },
];
const STAGES = [{ key: 'gs', label: 'GS' }, { key: 'r32', label: 'R32' }, { key: 'r16', label: 'R16' },
  { key: 'qf', label: 'QF' }, { key: 'sf', label: 'SF' }, { key: 'final', label: 'F' }];
const ZOOMS = [0.55, 0.7, 0.85, 1, 1.2];
const isPlaceholder = (n) => !n || /^\d[A-L]$|^[A-L]\d|^3[A-L/ ]|^W\d|^L\d|^1[A-L]|^2[A-L]|^RU/i.test(String(n));

// What-if overrides ({matchNumber: team}) — in-session, persist across model
// switches and re-renders. Reset clears them.
const OVERRIDES = {};
let _root = null, _data = null, _params = {};

function strengthMap(data, source) {
  const teams = data?.teams || {}; const m = {};
  if (source === 'dt') { for (const r of data?.dtModel?.team_rankings || []) if (r.country) m[r.country] = r.rating; if (Object.keys(m).length) return m; }
  else if (source === 'kalshi') { for (const r of data?.markets?.tournament_winner || []) if (r.team) m[r.team] = r.prob_pct; if (Object.keys(m).length) return m; }
  else if (source === 'hybrid') { for (const r of data?.forecast?.teams || []) if (r.team) m[r.team] = r.hybrid_strength; if (Object.keys(m).length) return m; }
  // 'stack' (J5L AI Enhanced — the default model): confidence must come from the
  // same learned strengths that make the picks, not the composite fallback.
  else if (source === 'stack') { for (const [t, v] of Object.entries(data?.stacker?.strengths || {})) if (typeof v === 'number') m[t] = v; if (Object.keys(m).length) return m; }
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
  _root = root; _data = data; _params = params || {};
  paint();
}

function paint() {
  const root = _root, data = _data, params = _params;
  root.innerHTML = '';
  let model = params.model && MODELS.includes(params.model) ? params.model : getActiveModel();
  if (!MODELS.includes(model)) model = 'stack';
  const source = modelToAutofillSource(model);
  const stage = STAGES.some((s) => s.key === params.stage) ? params.stage : 'r32';
  const zoom = Number(params.zoom) || 1;
  const routeName = params.routeName || 'projected';

  root.appendChild(renderModelPicker({ active: model, onChange: (m) => setRoute(routeName, { model: m, stage, zoom }) }));
  root.appendChild(renderStageNav(stage, zoom, routeName, model));
  const luckCard = renderLuckCard(data);
  if (luckCard) root.appendChild(luckCard);

  if (stage === 'gs') { root.appendChild(renderGroupSeeding(data, routeName, model)); return; }

  let modelRows, ovRows;
  try {
    modelRows = buildAutofill(data, source) || [];
    ovRows = Object.keys(OVERRIDES).length ? (buildAutofill(data, source, { overrides: OVERRIDES }) || []) : modelRows;
  } catch { modelRows = ovRows = []; }
  if (!ovRows.length) {
    const e = document.createElement('div'); e.className = 'home-card';
    e.innerHTML = '<p class="muted" style="margin:0;">Projection unavailable — model data is still loading.</p>';
    root.appendChild(e); return;
  }
  root.appendChild(renderTree(ovRows, modelRows, strengthMap(data, source), zoom, stage, params.team));
}

/* Luck check card — descriptive only (see app/lib/luck-index.js: backtested
 * from the R32, luck adds no predictive edge, so it never feeds the model).
 * Shown while ≥2 named teams have unplayed knockout matches. */
function renderLuckCard(data) {
  let alive, teams;
  try {
    alive = remainingKnockoutTeams(data);
    teams = computeLuckIndex(data).teams;
  } catch { return null; }
  const rows = alive.filter((t) => teams[t]).sort((x, y) => teams[y].index - teams[x].index);
  if (rows.length < 2) return null;
  const wrap = document.createElement('section');
  wrap.className = 'home-card eb-luck'; wrap.dataset.testid = 'eb-luck-card';
  wrap.innerHTML = `
    <h2 class="home-card-title">Luck check <span class="muted home-card-meta">how they got here</span></h2>
    <div class="eb-luck-rows">
      ${rows.map((t) => {
    const p = teams[t]; const chips = luckChips(p);
    const tone = p.index >= 0.35 ? ' is-lucky' : p.index <= -0.35 ? ' is-unlucky' : '';
    return `
        <div class="eb-luck-row" data-testid="eb-luck-${escapeHtml(t)}">
          <span class="eb-luck-team">${flagFor(t)} ${escapeHtml(t)}</span>
          <span class="eb-luck-score${tone}">${p.index >= 0 ? '+' : ''}${p.index.toFixed(2)}σ</span>
          <span class="eb-luck-chips">${chips.map((c) => `<span class="eb-luck-chip">${escapeHtml(c.label)} ${c.z >= 0 ? '+' : ''}${c.z.toFixed(1)}σ</span>`).join('')}</span>
        </div>`;
  }).join('')}
    </div>
    <p class="muted eb-luck-note">Group-stage pens, corners, whistle, cards &amp; xG luck vs the field. Descriptive only — backtested from the R32 it adds no predictive edge, so it never adjusts projections.</p>
  `;
  return wrap;
}

function renderStageNav(stage, zoom, routeName, model) {
  const wrap = document.createElement('section');
  wrap.className = 'eb-nav'; wrap.dataset.testid = 'eb-stage-nav';
  const tabs = STAGES.map((s) => `<button class="eb-stage${s.key === stage ? ' is-active' : ''}" data-stage="${s.key}" data-testid="eb-stage-${s.key}">${s.label}</button>`).join('');
  const zi = ZOOMS.indexOf(zoom) === -1 ? 3 : ZOOMS.indexOf(zoom);
  const nOv = Object.keys(OVERRIDES).length;
  const reset = nOv ? `<button class="eb-reset" data-testid="eb-reset">↺ Reset (${nOv})</button>` : '';
  wrap.innerHTML = `
    <div class="eb-stages" role="tablist" aria-label="Round">${tabs}</div>
    <div class="eb-zoom" role="group" aria-label="Zoom">${reset}
      <button class="eb-zoom-btn" data-zoom="out" aria-label="Zoom out">−</button>
      <button class="eb-zoom-btn" data-zoom="fit" aria-label="Fit whole bracket">Fit</button>
      <button class="eb-zoom-btn" data-zoom="in" aria-label="Zoom in">＋</button>
    </div>`;
  wrap.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => setRoute(routeName, { model, stage: b.dataset.stage, zoom })));
  wrap.querySelector('[data-zoom="fit"]').addEventListener('click', () => setRoute(routeName, { model, stage, zoom: ZOOMS[0] }));
  wrap.querySelector('[data-zoom="in"]').addEventListener('click', () => setRoute(routeName, { model, stage, zoom: ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)] }));
  wrap.querySelector('[data-zoom="out"]').addEventListener('click', () => setRoute(routeName, { model, stage, zoom: ZOOMS[Math.max(0, zi - 1)] }));
  wrap.querySelector('[data-testid="eb-reset"]')?.addEventListener('click', () => { for (const k of Object.keys(OVERRIDES)) delete OVERRIDES[k]; paint(); });
  return wrap;
}

function teamRow(name, isWinner, conf, opts = {}) {
  if (isPlaceholder(name)) return `<div class="eb-team eb-tbd">${escapeHtml(String(name || 'TBD'))}</div>`;
  const hl = opts.highlight && name === opts.highlight ? ' eb-hl' : '';
  const ov = isWinner && opts.overridden ? ' eb-override' : '';
  const tag = isWinner && opts.overridden ? '<span class="eb-yourpick">✎ your pick</span>'
    : (isWinner && conf != null ? `<span class="eb-conf" style="--c:${conf}">${conf}%</span>` : '');
  const tappable = opts.tappable ? ` data-match="${opts.matchNumber}" data-team="${escapeHtml(name)}" role="button" tabindex="0"` : '';
  return `<div class="eb-team${isWinner ? ' eb-win' : ''}${hl}${ov}${opts.tappable ? ' eb-tappable' : ''}"${tappable}>
    <span class="eb-team-name">${flagFor(name)} ${escapeHtml(name)}</span>${tag}</div>`;
}

function renderTree(rows, modelRows, smap, zoom, stage, highlight) {
  const byNum = new Map(rows.map((r) => [r.matchNumber, r]));
  const modelByNum = new Map(modelRows.map((r) => [r.matchNumber, r]));
  const wrap = document.createElement('section');
  wrap.className = 'home-card eb-canvas-wrap'; wrap.dataset.testid = 'eb-bracket';

  const matchCell = (r) => {
    const overridden = OVERRIDES[r.matchNumber] === r.team && modelByNum.get(r.matchNumber)?.team !== r.team;
    const conf = confidence(smap, r.team, r.team_a === r.team ? r.team_b : r.team_a);
    const tap = (n, win) => ({ tappable: !isPlaceholder(r.team_a) && !isPlaceholder(r.team_b), matchNumber: r.matchNumber, overridden: overridden && win, highlight });
    return `<div class="eb-match"${overridden ? ' data-overridden="1"' : ''}>
      ${teamRow(r.team_a, r.team_a === r.team, conf, tap(r.team_a, r.team_a === r.team))}
      ${teamRow(r.team_b, r.team_b === r.team, conf, tap(r.team_b, r.team_b === r.team))}
    </div>`;
  };

  const cols = ROUNDS.map((rd) => {
    const cells = [];
    for (let n = rd.lo; n <= rd.hi; n++) { const r = byNum.get(n); if (r) cells.push(matchCell(r)); }
    return `<div class="eb-col" data-round="${rd.key}"><div class="eb-col-head">${rd.full}</div><div class="eb-col-body">${cells.join('')}</div></div>`;
  }).join('');
  const tp = byNum.get(103);
  const third = tp ? `<div class="eb-col eb-col-third"><div class="eb-col-head">3rd place</div><div class="eb-col-body">${matchCell(tp)}</div></div>` : '';

  wrap.innerHTML = `
    <p class="muted" style="margin:0 0 6px;font-size:12px;">Tap a team to set a what-if winner — the bracket re-cascades. ${Object.keys(OVERRIDES).length ? 'Your picks override the model below.' : ''}</p>
    <div class="eb-canvas" data-testid="eb-canvas"><div class="eb-tree" style="transform:scale(${zoom})">${cols}${third}</div></div>`;

  // delegated tap → set/clear what-if override, then re-cascade
  wrap.querySelector('.eb-tree').addEventListener('click', (e) => {
    const cell = e.target.closest('.eb-tappable'); if (!cell) return;
    const mn = Number(cell.dataset.match); const team = cell.dataset.team;
    if (!mn || !team) return;
    if (OVERRIDES[mn] === team) delete OVERRIDES[mn]; else OVERRIDES[mn] = team;
    paint();
  });
  requestAnimationFrame(() => {
    const target = wrap.querySelector(`.eb-col[data-round="${stage}"]`);
    if (target && stage !== 'r32') target.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
  return wrap;
}

function renderGroupSeeding(data, routeName, model) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card'; wrap.dataset.testid = 'eb-group-seeding';
  const groups = Object.keys(data?.groupMatchups || {}).sort();
  let html = '';
  for (const g of groups) {
    let standings = [];
    try { standings = computeGroupStandings(data, g) || computeProjectedGroupOrder(data, g) || []; } catch { standings = []; }
    const lines = standings.slice(0, 4).map((s, i) => {
      const nm = s.team || s.name || s;
      const raw = s.points ?? s.pts;
      const pts = typeof raw === 'number' ? (Number.isInteger(raw) ? raw : raw.toFixed(1)) : (raw ?? '');
      return `<li class="eb-gs-row eb-tappable" data-team="${escapeHtml(String(nm))}" role="button" tabindex="0"><span class="eb-gs-pos">${i + 1}</span><span class="eb-gs-team">${flagFor(nm)} ${escapeHtml(String(nm))}</span><span class="eb-gs-pts muted">${pts}</span></li>`;
    }).join('');
    html += `<div class="eb-gs-group"><h4 class="eb-gs-head">Group ${escapeHtml(g)}</h4><ol class="eb-gs-list">${lines}</ol></div>`;
  }
  wrap.innerHTML = `<p class="muted" style="margin:0 0 10px;font-size:12px;">Projected standings — top two (and best thirds) seed the Round of 32. Tap a team to trace its projected bracket path.</p><div class="eb-gs-grid">${html}</div>`;
  wrap.querySelectorAll('.eb-tappable').forEach((el) => el.addEventListener('click', () => setRoute(routeName, { model, stage: 'r32', team: el.dataset.team })));
  return wrap;
}
