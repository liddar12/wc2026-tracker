import { escapeHtml } from '../lib/escape.js';
/* backtest-view.js — E4: backtest panel.
   Shows per-model accuracy on prior tournaments. IMPORTANT: only the Euro 2024
   Market row is MEASURED (Polymarket per-match history). The J5L/DT/Hybrid rows
   are estimates — the models can't be re-run on past tournaments (ratings aren't
   archived), so they're flagged as such rather than shown as real results.
   The live2026 panel (scripts/snapshot_backtest.py) holds the real, measured
   4-model backtest as WC 2026 matches resolve. */

const PANEL_TITLES = {
  wc2022: 'FIFA World Cup 2022',
  euro2024: 'UEFA Euro 2024',
};

const LIVE_LABELS = {
  stack: 'J5L AI Enhanced', model: 'J5L', dt: 'DT', market: 'Market (Kalshi)', polymarket: 'Polymarket', hybrid: 'Hybrid (⅓·⅓·⅓)',
};

export async function renderBacktestView(root) {
  root.innerHTML = '<p class="loading">Loading backtest…</p>';
  let backtest = null;
  let conformal = null;
  try {
    const r = await fetch('data/backtest.json', { cache: 'no-store' });
    if (r.ok) backtest = await r.json();
  } catch {}
  // R20: conformal safe-set calibration (optional — line renders only if present).
  try {
    const rc = await fetch('data/conformal.json', { cache: 'no-store' });
    if (rc.ok) conformal = await rc.json();
  } catch {}
  root.innerHTML = '';
  if (!backtest) {
    root.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Backtest data not yet available</h2>
        <p class="muted">No backtest data found.</p>
      </div>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Backtest</h2>
    <p class="muted" style="font-size:13px; margin: 0 0 8px;">How the models would have done on prior tournaments.</p>
    <p style="margin:0 0 8px;"><a href="#/model-accuracy" class="backtest-accuracy-link" data-testid="model-accuracy-link" style="font-size:13px; font-weight:600;">See per-match accuracy →</a></p>
    <p class="backtest-disclaimer">
      <strong>Only the Euro 2024 Market figure is measured</strong> (from Polymarket per-match odds).
      The J5L / DT / Hybrid rows are <em>estimates</em> — the app's models can't be re-run on past
      tournaments because point-in-time ratings aren't archived. A fully-measured 4-model backtest
      begins live with <strong>WC 2026</strong>.
    </p>
  `;
  root.appendChild(head);

  // Live WC 2026 panel (real, measured) — rendered first once it has data.
  const live = backtest.live2026;
  if (live && (live.matches_scored || live.scored)) {
    root.appendChild(renderLivePanel(live, conformal));
  } else {
    const placeholder = document.createElement('section');
    placeholder.className = 'home-card';
    placeholder.style.marginBottom = '12px';
    placeholder.innerHTML = `
      <h3 style="margin:0 0 6px;">WC 2026 — live measured backtest</h3>
      <p class="muted" style="font-size:12px; margin:0;">Pre-kickoff predictions from all four models plus the
      markets are captured for every match and scored as results land. Real numbers will appear here once
      matches resolve (kickoff 11 June).</p>`;
    root.appendChild(placeholder);
  }

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
        ${renderRow('DT Model', r.dt)}
        ${renderRow('Market only', r.market)}
        ${renderRow('Hybrid (⅓·⅓·⅓)', r.hybrid)}
      </div>
      <p class="muted" style="font-size:11px; margin: 8px 0 0;">${escapeHtml(r.note || `${r.total_matches || 0} matches scored.`)}</p>
    `;
    root.appendChild(section);
  }
}

function renderRow(label, scores) {
  if (!scores) return '';
  const pct = scores.total ? Math.round((scores.correct / scores.total) * 100) : 0;
  const measured = !!scores.measured;
  const badge = measured
    ? '<span class="backtest-badge measured">measured</span>'
    : '<span class="backtest-badge est">est.</span>';
  const row = `
    <div class="backtest-row${measured ? '' : ' is-est'}">
      <span class="backtest-label">${escapeHtml(label)} ${badge}</span>
      <span class="backtest-bar"><span class="backtest-fill" style="width: ${pct}%;"></span></span>
      <span class="backtest-pct"><strong>${pct}%</strong> <span class="muted">(${scores.correct}/${scores.total})</span></span>
    </div>`;
  if (!measured) return row;
  // measured market row: surface the richer, honest detail
  const bits = [];
  if (scores.decisive_total) bits.push(`decisive ${Math.round((scores.decisive_correct / scores.decisive_total) * 100)}% (${scores.decisive_correct}/${scores.decisive_total})`);
  if (scores.brier != null) bits.push(`Brier ${scores.brier}`);
  if (scores.logloss != null) bits.push(`log-loss ${scores.logloss}`);
  const sub = bits.length ? `<div class="backtest-sub">${escapeHtml(bits.join(' · '))}</div>` : '';
  return row + sub;
}

function renderLivePanel(live, conformal) {
  const section = document.createElement('section');
  section.className = 'home-card';
  section.style.marginBottom = '12px';
  const rows = ['stack', 'model', 'dt', 'market', 'polymarket', 'hybrid']
    .map((k) => (live[k] ? renderRow(LIVE_LABELS[k] || k, { ...live[k], measured: true }) : ''))
    .join('');
  section.innerHTML = `
    <h3 style="margin: 0 0 8px;">WC 2026 — live <span class="backtest-badge measured">measured</span></h3>
    <div class="backtest-grid">${rows}</div>
    <p class="muted" style="font-size:11px; margin: 8px 0 0;">${escapeHtml(live.note || `${live.matches_scored || 0} matches scored so far.`)}</p>
    ${conformalLine(conformal)}
  `;
  return section;
}

// R20: safe-set coverage line — how often the calibrated conformal set (shown
// on matchup pages) actually contained the real result. Empty when the
// calibration file is absent.
function conformalLine(conformal) {
  const lv = conformal && conformal.display_level;
  const d = lv && conformal.levels && conformal.levels[lv];
  if (!d || typeof d.empirical_coverage !== 'number') return '';
  const target = Math.round(parseFloat(lv) * 100);
  const cov = (d.empirical_coverage * 100).toFixed(1);
  const size = typeof d.avg_set_size === 'number' ? d.avg_set_size.toFixed(2) : '?';
  return `<p class="muted backtest-conformal" data-testid="conformal-coverage" style="font-size:11px; margin: 4px 0 0;">
    Safe sets (${target}% target): contained the actual result <strong>${escapeHtml(cov)}%</strong> of the time
    over ${conformal.n_calibration || 0} matches · avg ${escapeHtml(size)} outcomes per set.</p>`;
}
