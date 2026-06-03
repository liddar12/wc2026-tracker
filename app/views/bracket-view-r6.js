/* bracket-view-r6.js — R6 T3: read-only consolidated Bracket section.
   Two sub-modes:
   - Live: resolve the bracket from actualResults + show group info
   - Projected: same tree but resolve via a chosen FILL_SOURCE (model,
     hybrid, market, consensus); diff against Live where data overlaps.

   No picking happens here — Play is the only write surface. */

import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { helpCard, HELP_COPY } from '../components/help-card.js';
import { computeGroupStandings, resolveSlots, STAGE_ORDER, isSlotPlaceholder } from '../bracket-resolver.js';
import { FILL_SOURCES, buildAutofill } from '../bracket-autofill.js';
import { renderModelPicker } from '../components/model-picker.js';
import { getActiveModel, modelToAutofillSource } from '../lib/active-model.js';

const MODE_LABELS = { live: 'Live', projected: 'Projected' };
const SOURCE_LABELS = {
  model: 'Model composite',
  kalshi: 'Kalshi market',
  hybrid: 'Hybrid 50/50',
  consensus: 'Public consensus',
};

export function renderBracketView(root, data, params = {}) {
  root.innerHTML = '';
  const mode = params.mode === 'projected' ? 'projected' : 'live';
  // R12b: prefer the URL param (so deep links keep working) but fall back to
  // the user's active model from settings. The Bracket Projected source IS
  // the model in this view.
  const source = params.source && SOURCE_LABELS[params.source]
    ? params.source
    : modelToAutofillSource(getActiveModel());

  root.appendChild(helpCard({ ...HELP_COPY.bracket, persistKey: 'bracket' }));
  root.appendChild(renderModelPicker({
    onChange: (m) => {
      // Reroute to projected mode with the new source so the URL is shareable.
      setRoute('bracket', { mode: 'projected', source: modelToAutofillSource(m) });
    },
  }));
  root.appendChild(renderModeToggle(mode, source));

  if (mode === 'live') {
    root.appendChild(renderLive(data));
    root.appendChild(renderGroupInfo(data));
  } else {
    root.appendChild(renderProjected(data, source));
  }
}

function renderModeToggle(mode, source) {
  const wrap = document.createElement('section');
  wrap.className = 'pw-bracket-modes';
  wrap.setAttribute('data-testid', 'bracket-mode-toggle');
  const modeBtns = ['live', 'projected'].map((m) => `
    <button class="pw-bracket-mode-btn ${m === mode ? 'is-active' : ''}" data-mode="${m}" data-testid="bracket-mode-${m}">
      ${MODE_LABELS[m]}
    </button>
  `).join('');
  const sourcePicker = mode === 'projected' ? `
    <label class="pw-bracket-source-row">
      <span class="muted">Source:</span>
      <select id="pw-bracket-source" data-testid="bracket-source-select">
        ${Object.entries(SOURCE_LABELS).map(([k, v]) => `<option value="${k}" ${k === source ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>` : '';
  wrap.innerHTML = `
    <div class="pw-bracket-mode-row">${modeBtns}</div>
    ${sourcePicker}
  `;
  wrap.querySelectorAll('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setRoute('bracket', { mode: b.dataset.mode }));
  });
  wrap.querySelector('#pw-bracket-source')?.addEventListener('change', (e) => {
    setRoute('bracket', { mode: 'projected', source: e.target.value });
  });
  return wrap;
}

function renderLive(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.setAttribute('data-testid', 'bracket-live');
  const sf = data?.scheduleFull || [];
  const ko = sf
    .filter((m) => STAGE_ORDER.includes(m.stage))
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  const actuals = data?.actualResults || {};
  const winnerFor = (match) => {
    const stageKey = match.stage;
    const rec = actuals?.[stageKey]?.[`${match.team_a}__vs__${match.team_b}`] || actuals?.[stageKey]?.[`${match.team_b}__vs__${match.team_a}`];
    if (!rec) return null;
    const a = rec.score_a ?? rec.team_a_score;
    const b = rec.score_b ?? rec.team_b_score;
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (a > b) return match.team_a;
    if (b > a) return match.team_b;
    return rec.penalty_winner || null;
  };
  resolveSlots(ko, data, { winnerResolver: winnerFor });

  wrap.innerHTML = `
    <h2 class="home-card-title">Live bracket</h2>
    <p class="muted" style="font-size: 12px; margin: 0 0 8px;">Resolves automatically as match results land. Pre-tournament shows the schedule slots.</p>
  `;
  const tree = document.createElement('div');
  tree.className = 'pw-bracket-tree pw-bracket-tree-ro';
  tree.tabIndex = 0;
  tree.setAttribute('role', 'region');
  tree.setAttribute('aria-label', 'Bracket — use left/right arrow keys to scroll between rounds');
  tree.addEventListener('keydown', (e) => {
    const step = 220;
    if (e.key === 'ArrowRight') { tree.scrollLeft += step; e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { tree.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === 'Home') { tree.scrollLeft = 0; e.preventDefault(); }
    else if (e.key === 'End') { tree.scrollLeft = tree.scrollWidth; e.preventDefault(); }
  });
  // Group by stage
  const byStage = new Map();
  for (const m of ko) {
    const key = m.stage;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push(m);
  }
  for (const [stage, matches] of byStage) {
    const col = document.createElement('div');
    col.className = 'pw-bracket-col';
    col.innerHTML = `<h3 class="pw-bracket-col-head">${stageLabel(stage)}</h3>`;
    for (const m of matches) {
      const a = m.resolved_team_a || m.team_a;
      const b = m.resolved_team_b || m.team_b;
      const w = m.projected_winner;
      const aWon = w && w === a;
      const bWon = w && w === b;
      const card = document.createElement('div');
      card.className = 'pw-bracket-card';
      card.innerHTML = `
        <div class="pw-bracket-side ${aWon ? 'is-picked' : ''}" data-testid="live-slot-${m.match_number}-a">
          <span class="pw-bracket-flag" aria-hidden="true">${isSlotPlaceholder(a) ? '·' : flagFor(a)}</span>
          <span class="pw-bracket-name">${escapeHtml(a || 'Waiting…')}</span>
        </div>
        <div class="pw-bracket-side ${bWon ? 'is-picked' : ''}" data-testid="live-slot-${m.match_number}-b">
          <span class="pw-bracket-flag" aria-hidden="true">${isSlotPlaceholder(b) ? '·' : flagFor(b)}</span>
          <span class="pw-bracket-name">${escapeHtml(b || 'Waiting…')}</span>
        </div>
      `;
      col.appendChild(card);
    }
    tree.appendChild(col);
  }
  wrap.appendChild(tree);
  return wrap;
}

function renderGroupInfo(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.setAttribute('data-testid', 'bracket-group-info');
  wrap.innerHTML = `<h2 class="home-card-title">Group standings</h2>`;
  const groups = data?.groupMatchups || {};
  const grid = document.createElement('div');
  grid.className = 'pw-bracket-groups-grid';
  for (const [letter, info] of Object.entries(groups)) {
    const card = document.createElement('div');
    card.className = 'pw-bracket-group-card';
    card.setAttribute('data-testid', `bracket-group-${letter}`);
    // computeGroupStandings returns null pre-tournament; fall back to teams list
    const standings = computeGroupStandings(data, letter) || (info.teams || []).map((t) => ({ team: t }));
    card.innerHTML = `
      <h3>Group ${letter}</h3>
      <ol class="pw-bracket-standings">
        ${standings.map((row, i) => `
          <li>
            <span class="pw-bracket-rank">${i + 1}</span>
            <span class="pw-bracket-flag" aria-hidden="true">${flagFor(row.team)}</span>
            <span class="pw-bracket-team">${escapeHtml(row.team)}</span>
            <span class="muted pw-bracket-pts">${row.points ?? 0}p · ${row.gd ?? 0}gd</span>
          </li>
        `).join('')}
      </ol>
    `;
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderProjected(data, source) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.setAttribute('data-testid', 'bracket-projected');
  wrap.innerHTML = `
    <h2 class="home-card-title">Projected bracket <span class="muted home-card-meta">${escapeHtml(SOURCE_LABELS[source])}</span></h2>
    <p class="muted" style="font-size: 12px; margin: 0 0 8px;">Same slot structure as Live, but every winner is auto-picked by the chosen source. Switch sources to compare.</p>
  `;
  const autofill = buildAutofill(data, source);
  if (!autofill.length) {
    wrap.appendChild(emptyState(`No projected picks available for source: ${SOURCE_LABELS[source]}.`));
    return wrap;
  }
  // Group autofill by stage for column rendering
  const sf = data?.scheduleFull || [];
  const ko = sf.filter((m) => STAGE_ORDER.includes(m.stage)).sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  const byNum = new Map(autofill.map((row) => [row.matchNumber, row]));
  const byStage = new Map();
  for (const m of ko) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage).push(m);
  }
  const tree = document.createElement('div');
  tree.className = 'pw-bracket-tree pw-bracket-tree-ro';
  tree.tabIndex = 0;
  tree.setAttribute('role', 'region');
  tree.setAttribute('aria-label', 'Bracket — use left/right arrow keys to scroll between rounds');
  tree.addEventListener('keydown', (e) => {
    const step = 220;
    if (e.key === 'ArrowRight') { tree.scrollLeft += step; e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { tree.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === 'Home') { tree.scrollLeft = 0; e.preventDefault(); }
    else if (e.key === 'End') { tree.scrollLeft = tree.scrollWidth; e.preventDefault(); }
  });
  for (const [stage, matches] of byStage) {
    const col = document.createElement('div');
    col.className = 'pw-bracket-col';
    col.innerHTML = `<h3 class="pw-bracket-col-head">${stageLabel(stage)}</h3>`;
    for (const m of matches) {
      const row = byNum.get(m.match_number);
      const a = row?.team_a || m.team_a;
      const b = row?.team_b || m.team_b;
      const w = row?.team;
      const aWon = w && w === a;
      const bWon = w && w === b;
      const card = document.createElement('div');
      card.className = 'pw-bracket-card';
      card.innerHTML = `
        <div class="pw-bracket-side ${aWon ? 'is-picked' : ''}" data-testid="projected-slot-${m.match_number}-a">
          <span class="pw-bracket-flag" aria-hidden="true">${isSlotPlaceholder(a) ? '·' : flagFor(a)}</span>
          <span class="pw-bracket-name">${escapeHtml(a || 'Waiting…')}</span>
        </div>
        <div class="pw-bracket-side ${bWon ? 'is-picked' : ''}" data-testid="projected-slot-${m.match_number}-b">
          <span class="pw-bracket-flag" aria-hidden="true">${isSlotPlaceholder(b) ? '·' : flagFor(b)}</span>
          <span class="pw-bracket-name">${escapeHtml(b || 'Waiting…')}</span>
        </div>
      `;
      col.appendChild(card);
    }
    tree.appendChild(col);
  }
  wrap.appendChild(tree);
  return wrap;
}

function emptyState(msg) {
  const el = document.createElement('p');
  el.className = 'muted';
  el.style.fontSize = '12px';
  el.textContent = msg;
  return el;
}

function stageLabel(stage) {
  return {
    round_of_32: 'R32',
    round_of_16: 'R16',
    quarterfinals: 'QF',
    semifinals: 'SF',
    third_place: '3rd',
    final: 'Final',
  }[stage] || stage;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
