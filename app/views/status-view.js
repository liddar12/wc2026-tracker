/* status-view.js — RJ30-12: pipeline observability surface.
   Route: #/status (utility route, off the tab bar — reached from Settings).

   Reads data/pipeline_status.json (committed each daily cron by
   build_pipeline_status.py) and renders an overall health pill, a per-feed list
   (name · age · rows · status chip), and a collapsed warnings list. Degrades
   gracefully ("status not yet generated") when the JSON is missing/old, with no
   console-fatal. iOS-first: rows stack vertically at 390px (no horizontal
   scroll); reuses .home-card + .upset-badge sev-* chips (no new color tokens). */
import { escapeHtml } from '../lib/escape.js';
import { emptyState } from '../lib/empty-state.js';

const STATUS_SEV = {
  ok: 'low',       // green
  stale: 'medium', // amber
  empty: 'high',   // red
  missing: 'high', // red
};

function ageLabel(h) {
  if (h == null) return '—';
  if (h < 1) return '<1h';
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export async function renderStatusView(root) {
  root.innerHTML = '<p class="loading">Loading pipeline status…</p>';
  let status = null;
  try {
    const r = await fetch('data/pipeline_status.json', { cache: 'no-store' });
    if (r.ok) status = await r.json();
  } catch {}
  root.innerHTML = '';

  if (!status || !Array.isArray(status.feeds)) {
    const card = document.createElement('div');
    card.className = 'home-card';
    card.appendChild(emptyState('Status not yet generated', {
      detail: 'The pipeline health snapshot is written by the daily data refresh. Check back after the next run.',
      icon: '🩺',
    }));
    root.appendChild(card);
    return;
  }

  const health = status.health === 'ok' ? 'ok' : 'degraded';
  const pillSev = health === 'ok' ? 'low' : 'medium';

  const head = document.createElement('section');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  const gen = status.generated_at
    ? `<p class="muted" style="font-size:12px; margin:6px 0 0;">Generated ${escapeHtml(String(status.generated_at))}</p>`
    : '';
  head.innerHTML = `
    <h2 class="home-card-title">Pipeline status
      <span class="upset-badge sev-${pillSev}" data-testid="status-health" style="margin-left:6px;">${escapeHtml(health)}</span>
    </h2>
    <p class="muted" style="font-size:13px; margin:0;">Freshness of each data feed and any validation warnings. Issues are reserved for failures; this is the steady-state health surface.</p>
    ${gen}
  `;
  root.appendChild(head);

  // Per-feed list — one stacked row per feed at 390px.
  const list = document.createElement('section');
  list.className = 'home-card';
  list.style.marginBottom = '12px';
  const h3 = document.createElement('h3');
  h3.style.margin = '0 0 4px';
  h3.textContent = 'Feeds';
  list.appendChild(h3);
  for (const f of status.feeds) {
    const sev = STATUS_SEV[f.status] || 'low';
    const row = document.createElement('div');
    row.className = 'status-feed-row';
    row.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:9px 0; border-top:1px solid var(--border);';
    const flagged = f.status !== 'ok' ? ' style="font-weight:600;"' : '';
    row.innerHTML = `
      <span${flagged}>${escapeHtml(String(f.name || '?'))}</span>
      <span class="muted" style="font-size:12px;">${escapeHtml(ageLabel(f.age_hours))} · ${Number(f.rows) || 0} rows</span>
      <span class="upset-badge sev-${sev}" style="margin-left:auto;">${escapeHtml(String(f.status || '?'))}</span>
    `;
    list.appendChild(row);
  }
  root.appendChild(list);

  // Warnings — collapsed behind a <details> so the page stays terse.
  const warnings = Array.isArray(status.warnings) ? status.warnings : [];
  const warnCard = document.createElement('section');
  warnCard.className = 'home-card';
  if (warnings.length) {
    const items = warnings.map((w) => `<li style="margin:4px 0;">${escapeHtml(String(w))}</li>`).join('');
    warnCard.innerHTML = `
      <details>
        <summary class="muted" style="font-size:13px; cursor:pointer;">Validation warnings (${warnings.length})</summary>
        <ul style="margin:10px 0 0; padding-left:18px; font-size:12px;">${items}</ul>
      </details>`;
  } else {
    warnCard.innerHTML = `<p class="muted" style="font-size:13px; margin:0;">No validation warnings.</p>`;
  }
  root.appendChild(warnCard);
}
