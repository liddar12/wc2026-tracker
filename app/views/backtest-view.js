/* backtest-view.js — E4: backtest panel.
   Loads data/backtest.json (built by scripts/build_backtest.py from 2022 WC +
   Euro 2024 results) and shows accuracy of model vs market vs hybrid. */

const PANEL_TITLES = {
  wc2022: 'FIFA World Cup 2022',
  euro2024: 'UEFA Euro 2024',
};

export async function renderBacktestView(root) {
  root.innerHTML = '<p class="loading">Loading backtest…</p>';
  let backtest = null;
  try {
    const r = await fetch('data/backtest.json', { cache: 'no-store' });
    if (r.ok) backtest = await r.json();
  } catch {}
  root.innerHTML = '';
  if (!backtest) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Backtest data not yet available</h2>
        <p class="muted">Run <code>scripts/build_backtest.py</code> to generate
          data/backtest.json from historic tournament results.</p>
      </div>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Backtest</h2>
    <p class="muted" style="font-size:13px; margin: 0;">How the model, market, and hybrid would have done on prior tournaments.</p>
  `;
  root.appendChild(head);

  for (const [key, label] of Object.entries(PANEL_TITLES)) {
    const r = backtest[key];
    if (!r) continue;
    const section = document.createElement('section');
    section.className = 'home-card';
    section.style.marginBottom = '12px';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px;">${label}</h3>
      <div class="backtest-grid">
        ${renderRow('Model only', r.model)}
        ${renderRow('Market only', r.market)}
        ${renderRow('Hybrid 50/50', r.hybrid)}
      </div>
      <p class="muted" style="font-size:11px; margin: 8px 0 0;">${escapeHtml(r.note || `${r.total_matches || 0} matches scored.`)}</p>
    `;
    root.appendChild(section);
  }
}

function renderRow(label, scores) {
  if (!scores) return '';
  const pct = scores.total ? Math.round((scores.correct / scores.total) * 100) : 0;
  return `
    <div class="backtest-row">
      <span class="backtest-label">${escapeHtml(label)}</span>
      <span class="backtest-bar"><span class="backtest-fill" style="width: ${pct}%;"></span></span>
      <span class="backtest-pct"><strong>${pct}%</strong> <span class="muted">(${scores.correct}/${scores.total})</span></span>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
