/* projected-bracket-view.js — read-only PROJECTED bracket.
 *
 * Shows how the knockouts (Round of 32 → Final + 3rd-place playoff) would play
 * out under a chosen model, using the same buildAutofill engine the Play funnel
 * uses (forecast strength → resolved winners). Users switch between all five
 * models (J5L / DT / Kalshi / Hybrid / Consensus) — default the tuned Hybrid —
 * to compare projections. Surfaces projected 1st / 2nd / 3rd.
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from '../components/team-flag.js';
import { buildAutofill } from '../bracket-autofill.js';
import { MODELS, MODEL_LABELS, MODEL_DESCRIPTIONS, getActiveModel, modelToAutofillSource } from '../lib/active-model.js';

const ROUNDS = [
  { key: 'r32', label: 'Round of 32', lo: 73, hi: 88 },
  { key: 'r16', label: 'Round of 16', lo: 89, hi: 96 },
  { key: 'qf', label: 'Quarterfinals', lo: 97, hi: 100 },
  { key: 'sf', label: 'Semifinals', lo: 101, hi: 102 },
  { key: 'final', label: 'Final', lo: 104, hi: 104 },
];
const isPlaceholder = (n) => !n || /^\d[A-L]$|^[A-L]\d|^3[A-L/ ]|^W\d|^L\d|^1[A-L]|^2[A-L]|^RU/i.test(String(n));

export function renderProjectedBracketView(root, data, params) {
  root.innerHTML = '';
  let model = (params && params.model && MODELS.includes(params.model)) ? params.model : getActiveModel();
  if (!MODELS.includes(model)) model = 'hybrid';

  const head = document.createElement('section');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Projected bracket</h2>
    <p class="muted" style="margin:0 0 10px;font-size:13px;">How the knockouts would play out on today's results + ratings. Pick a model to compare.</p>
    <div class="pb-models" role="tablist" aria-label="Model"></div>
    <p class="muted pb-model-desc" style="margin:8px 0 0;font-size:12px;"></p>
  `;
  const chips = head.querySelector('.pb-models');
  for (const m of MODELS) {
    const b = document.createElement('button');
    b.className = 'pw-model-chip' + (m === model ? ' is-active' : '');
    b.type = 'button';
    b.style.cursor = 'pointer';
    b.textContent = MODEL_LABELS[m] || m;
    b.setAttribute('data-model', m);
    b.addEventListener('click', () => renderProjectedBracketView(root, data, { ...params, model: m }));
    chips.appendChild(b);
  }
  head.querySelector('.pb-model-desc').textContent = MODEL_DESCRIPTIONS[model] || '';
  root.appendChild(head);

  let rows;
  try {
    rows = buildAutofill(data, modelToAutofillSource(model)) || [];
  } catch {
    rows = [];
  }
  const byNum = new Map(rows.map((r) => [r.matchNumber, r]));

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'home-card';
    empty.innerHTML = '<p class="muted" style="margin:0;">Projection unavailable — model data is still loading.</p>';
    root.appendChild(empty);
    return;
  }

  // Podium: 1st = Final winner, 2nd = Final loser, 3rd = 3rd-place game winner.
  const finalRow = byNum.get(104);
  const champ = finalRow?.team;
  const runner = finalRow ? (finalRow.team_a === champ ? finalRow.team_b : finalRow.team_a) : null;
  const third = byNum.get(103)?.team;
  const podium = document.createElement('section');
  podium.className = 'home-card pb-podium';
  podium.style.marginBottom = '12px';
  podium.dataset.testid = 'pb-podium';
  podium.innerHTML = `
    <h3 class="home-card-title" style="margin-bottom:8px;">Projected finish</h3>
    <div class="pb-podium-row">
      ${podiumCell('🥇', '1st', champ)}
      ${podiumCell('🥈', '2nd', runner)}
      ${podiumCell('🥉', '3rd', third)}
    </div>`;
  root.appendChild(podium);

  // Rounds R32 → Final.
  const wrap = document.createElement('section');
  wrap.className = 'home-card';
  wrap.dataset.testid = 'pb-bracket';
  const cols = ROUNDS.map((rd) => {
    const matches = [];
    for (let n = rd.lo; n <= rd.hi; n++) {
      const r = byNum.get(n);
      if (r) matches.push(matchCell(r));
    }
    return `<div class="pb-col"><h4 class="pb-col-head">${rd.label}</h4>${matches.join('')}</div>`;
  }).join('');
  // 3rd-place playoff as a small aside.
  const tp = byNum.get(103);
  const thirdCol = tp ? `<div class="pb-col"><h4 class="pb-col-head">3rd place</h4>${matchCell(tp)}</div>` : '';
  wrap.innerHTML = `<div class="pb-bracket">${cols}${thirdCol}</div>`;
  root.appendChild(wrap);
}

function podiumCell(medal, place, team) {
  const t = team && !isPlaceholder(team) ? `${flagFor(team)} ${escapeHtml(team)}` : '<span class="muted">TBD</span>';
  return `<div class="pb-podium-cell"><div class="pb-medal">${medal} ${place}</div><div class="pb-podium-team">${t}</div></div>`;
}

function teamSpan(name, winner) {
  if (isPlaceholder(name)) return `<span class="pb-team muted">${escapeHtml(String(name || 'TBD'))}</span>`;
  const win = name === winner;
  return `<span class="pb-team${win ? ' pb-win' : ''}">${flagFor(name)} ${escapeHtml(name)}</span>`;
}

function matchCell(r) {
  return `<div class="pb-match">${teamSpan(r.team_a, r.team)}${teamSpan(r.team_b, r.team)}</div>`;
}
