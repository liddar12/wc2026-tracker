/* winner-view.js — tournament winner ladder from Kalshi odds. */
import { flagFor } from '../components/team-flag.js';
import { sparklineSvg } from '../components/sparkline.js';
import { kalshiAttribution } from '../markets.js';

export function renderWinnerView(root, data) {
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
  rows.forEach((row, idx) => {
    list.appendChild(winnerRow(row, idx + 1));
  });
  root.appendChild(list);
  root.appendChild(kalshiAttribution());
}

function winnerRow(row, rank) {
  const a = document.createElement('a');
  a.className = 'winner-row';
  a.href = `#/team/name/${encodeURIComponent(row.team)}`;

  const delta = row.delta_24h_pp || 0;
  const up = delta >= 0;
  const deltaCls = up ? 'delta-up' : 'delta-down';
  const arrow = up ? '↑' : '↓';

  a.innerHTML = `
    <span class="winner-rank">${rank}</span>
    <span class="flag" aria-hidden="true">${flagFor(row.team)}</span>
    <span class="winner-team">${escapeHtml(row.team)}</span>
    <span class="winner-spark"></span>
    <span class="winner-prob">${row.prob_pct.toFixed(1)}%</span>
    <span class="winner-delta ${deltaCls}">${arrow} ${Math.abs(delta).toFixed(1)}</span>
  `;
  a.querySelector('.winner-spark').appendChild(
    sparklineSvg(row.sparkline, { width: 30, height: 8 })
  );
  return a;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
