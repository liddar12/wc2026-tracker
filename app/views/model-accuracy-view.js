/* model-accuracy-view.js — RJ30-11: per-match model accuracy vs market.
   Reads data/live-backtest.json (captured + scored by snapshot_backtest.py) and
   surfaces, match by match, which model called each result and how sharp it was
   (per-match Brier) versus the Market baseline. The aggregate header reuses the
   SAME summary numbers as backtest-view.js's live2026 panel so the two views can
   never disagree (we never re-derive a mean over matches — see buildRows).

   Route: #/model-accuracy (linked from the Backtest view; off the tab bar). */
import { escapeHtml } from '../lib/escape.js';
import { emptyState } from '../lib/empty-state.js';

// Same label map as backtest-view.js LIVE_LABELS — keep in sync.
const MODELS = ['stack', 'model', 'dt', 'market', 'polymarket', 'hybrid'];
const LABELS = {
  stack: 'J5L AI Enhanced', model: 'J5L', dt: 'DT', market: 'Market', polymarket: 'Polymarket', hybrid: 'Hybrid',
};
const ACTUAL_LABEL = {
  team_a_wins: 'a', draw: 'draw', team_b_wins: 'b',
};

/**
 * Pure helper: turn the loaded live-backtest payload into render-ready rows +
 * the aggregate header descriptors. No DOM, no fetch — unit-testable.
 *
 * Aggregates are read straight off `live.summary[model]` (already rounded by
 * Python); we deliberately do NOT recompute a mean over `matches` so this view
 * can't drift from the Backtest view's live2026 panel.
 */
export function buildRows(live) {
  const matches = (live && live.matches) || {};
  const summary = (live && live.summary) || {};
  const rows = Object.values(matches)
    .filter((m) => m && m.scored === true)
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0))
    .map((m) => {
      const marketBrier = m.score?.market?.brier;
      const cells = MODELS.map((k) => {
        const sc = m.score?.[k];
        if (!sc || typeof sc.brier !== 'number') {
          return { model: k, present: false };
        }
        const delta = typeof marketBrier === 'number'
          ? +(sc.brier - marketBrier).toFixed(3)
          : null;
        return {
          model: k,
          present: true,
          correct: sc.correct === 1,
          brier: sc.brier,
          deltaVsMarket: delta,
        };
      });
      return {
        team_a: m.team_a,
        team_b: m.team_b,
        actual: m.actual,
        actual_score: m.actual_score || null,
        cells,
      };
    });

  const header = MODELS
    .filter((k) => summary[k])
    .map((k) => {
      const s = summary[k];
      const total = s.total || 0;
      return {
        model: k,
        correct: s.correct || 0,
        total,
        pct: total ? Math.round((s.correct / total) * 100) : 0,
        brier: typeof s.brier === 'number' ? s.brier : null,
        logloss: typeof s.logloss === 'number' ? s.logloss : null,
      };
    });

  return { rows, header, showEmpty: rows.length === 0 };
}

export async function renderModelAccuracyView(root) {
  root.innerHTML = '<p class="loading">Loading model accuracy…</p>';
  let live = null;
  try {
    const r = await fetch('data/live-backtest.json', { cache: 'no-store' });
    if (r.ok) live = await r.json();
  } catch {}
  root.innerHTML = '';

  if (!live) {
    // Offline / fetch failed — degrade to the empty card (no blank screen).
    const card = document.createElement('div');
    card.className = 'home-card';
    card.appendChild(emptyState('Live model accuracy starts once matches resolve', {
      detail: 'Pre-kickoff predictions from every model are captured and scored as results land.',
      icon: '📊',
    }));
    root.appendChild(card);
    return;
  }

  const { rows, header, showEmpty } = buildRows(live);

  // Header card — aggregate per model (reuses summary numbers; market anchored).
  const head = document.createElement('section');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Model Accuracy <span class="backtest-badge measured">measured</span></h2>
    <p class="muted" style="font-size:13px; margin:0 0 8px;">Per-match, which model called the result and how sharp it was vs the Market baseline. Same numbers as the Backtest live panel.</p>
    <div class="backtest-grid">${header.map(renderHeaderRow).join('') || '<p class="muted" style="font-size:12px;margin:0;">No scored models yet.</p>'}</div>
  `;
  root.appendChild(head);

  if (showEmpty) {
    const card = document.createElement('div');
    card.className = 'home-card';
    card.appendChild(emptyState('Live model accuracy starts once matches resolve', {
      detail: 'The per-match board fills in as each fixture goes final.',
      icon: '⚽',
    }));
    root.appendChild(card);
    return;
  }

  // Per-match list — one compact row per scored fixture (390px friendly).
  const list = document.createElement('section');
  list.className = 'home-card';
  const heading = document.createElement('h3');
  heading.style.margin = '0 0 8px';
  heading.textContent = `Per-match (${rows.length})`;
  list.appendChild(heading);
  for (const row of rows) {
    list.appendChild(renderMatchRow(row));
  }
  root.appendChild(list);
}

function renderHeaderRow(h) {
  const sub = [];
  if (h.brier != null) sub.push(`Brier ${h.brier}`);
  if (h.logloss != null) sub.push(`log-loss ${h.logloss}`);
  const subLine = sub.length
    ? `<div class="backtest-sub">${escapeHtml(sub.join(' · '))}</div>` : '';
  return `
    <div class="backtest-row">
      <span class="backtest-label">${escapeHtml(LABELS[h.model] || h.model)}</span>
      <span class="backtest-bar"><span class="backtest-fill" style="width:${h.pct}%;"></span></span>
      <span class="backtest-pct"><strong>${h.pct}%</strong> <span class="muted">(${h.correct}/${h.total})</span></span>
    </div>${subLine}`;
}

function renderMatchRow(row) {
  const el = document.createElement('div');
  el.className = 'model-acc-row';
  el.style.cssText = 'padding:10px 0; border-top:1px solid var(--border);';
  const fixture = `${escapeHtml(row.team_a || '?')} v ${escapeHtml(row.team_b || '?')}`;
  const score = row.actual_score ? ` <span class="muted">${escapeHtml(row.actual_score)}</span>` : '';
  const winner = ACTUAL_LABEL[row.actual] || '';
  const chips = row.cells.map((c) => {
    if (!c.present) {
      return `<span class="upset-badge sev-low" style="opacity:.6;">${escapeHtml(LABELS[c.model] || c.model)} —</span>`;
    }
    const sev = c.correct ? 'low' : 'high';
    const mark = c.correct ? '✓' : '✗';
    const isMarket = c.model === 'market';
    // Market is the anchor (no self-delta); others show Brier − Market.
    let delta = '';
    if (!isMarket && c.deltaVsMarket != null) {
      const sign = c.deltaVsMarket <= 0 ? '−' : '+';
      delta = ` <span class="muted" style="font-size:10px;">${sign}${Math.abs(c.deltaVsMarket).toFixed(2)}</span>`;
    }
    const anchor = isMarket ? ' style="font-weight:700;"' : '';
    return `<span class="upset-badge sev-${sev}"${anchor}>${escapeHtml(LABELS[c.model] || c.model)} ${mark} <span class="muted" style="font-size:10px;">B${c.brier}</span>${delta}</span>`;
  }).join('');
  el.innerHTML = `
    <div style="font-weight:600; font-size:13px; margin-bottom:6px;">${fixture}${score}${winner ? ` <span class="muted" style="font-size:11px;">→ ${escapeHtml(winner)}</span>` : ''}</div>
    <div class="upset-badges" style="margin:0;">${chips}</div>
  `;
  return el;
}
