/* winner-view.js — tournament winner ladder. Defaults to the Hybrid forecast
   (⅓ J5L + ⅓ DT + ⅓ Markets, Monte-Carlo champion odds from data/forecast.json);
   falls back to the raw Kalshi tournament-winner market when the forecast is
   unavailable. */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from '../components/team-flag.js';
import { sparklineSvg } from '../components/sparkline.js';
import { kalshiAttribution } from '../markets.js';

export function renderWinnerView(root, data) {
  const forecast = data.forecast?.teams || [];
  if (forecast.length) return renderHybrid(root, data, forecast);

  // Fallback: raw Kalshi market ladder.
  const rows = data.markets?.tournament_winner || [];
  if (!rows.length) {
    root.innerHTML = '<p class="empty-state">Winner market data not available yet.</p>';
    root.appendChild(kalshiAttribution());
    return;
  }
  const header = document.createElement('div');
  header.className = 'winner-header';
  header.innerHTML = '<h2 class="section-heading">Tournament winner odds</h2>';
  root.appendChild(header);
  const list = document.createElement('div');
  list.className = 'winner-ladder';
  rows.forEach((row, idx) => list.appendChild(kalshiRow(row, idx + 1)));
  root.appendChild(list);
  root.appendChild(kalshiAttribution());
}

function renderHybrid(root, data, rows) {
  const header = document.createElement('div');
  header.className = 'winner-header';
  const w = data.forecast?.model?.weights || { j5l: 0.33, dt: 0.33, kalshi: 0.33 };
  const sims = data.forecast?.bracket_simulation?.iterations;
  header.innerHTML = `
    <h2 class="section-heading">Tournament winner odds</h2>
    <p class="muted" style="font-size:12px;margin:2px 0 0;">Hybrid forecast · ⅓ J5L + ⅓ DT + ⅓ Markets${sims ? ` · ${(sims / 1000)}k sims` : ''}</p>`;
  root.appendChild(header);

  const list = document.createElement('div');
  list.className = 'winner-ladder';
  rows.forEach((row, idx) => list.appendChild(hybridRow(row, idx + 1)));
  root.appendChild(list);
  root.appendChild(kalshiAttribution());
}

function hybridRow(row, rank) {
  const a = document.createElement('a');
  a.className = 'winner-row';
  a.href = `#/team/name/${encodeURIComponent(row.team)}`;
  const champ = ((row.champion || 0) * 100);
  const final = ((row.final || 0) * 100);
  const sf = ((row.sf || 0) * 100);
  a.innerHTML = `
    <span class="winner-rank">${rank}</span>
    <span class="flag" aria-hidden="true">${flagFor(row.team)}</span>
    <span class="winner-team">${escapeHtml(row.team)}</span>
    <span class="winner-prob">${champ.toFixed(1)}%</span>
    <span class="winner-delta muted" style="font-variant-numeric:tabular-nums;">SF ${sf.toFixed(0)} · F ${final.toFixed(0)}</span>
  `;
  return a;
}

function kalshiRow(row, rank) {
  const a = document.createElement('a');
  a.className = 'winner-row';
  a.href = `#/team/name/${encodeURIComponent(row.team)}`;
  const delta = row.delta_24h_pp || 0;
  const up = delta >= 0;
  a.innerHTML = `
    <span class="winner-rank">${rank}</span>
    <span class="flag" aria-hidden="true">${flagFor(row.team)}</span>
    <span class="winner-team">${escapeHtml(row.team)}</span>
    <span class="winner-spark"></span>
    <span class="winner-prob">${row.prob_pct.toFixed(1)}%</span>
    <span class="winner-delta ${up ? 'delta-up' : 'delta-down'}">${up ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}</span>
  `;
  a.querySelector('.winner-spark').appendChild(sparklineSvg(row.sparkline, { width: 30, height: 8 }));
  return a;
}
