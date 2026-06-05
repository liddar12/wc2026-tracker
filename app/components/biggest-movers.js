import { escapeHtml } from '../lib/escape.js';
/* biggest-movers.js — horizontal scroll strip for top market movers. */

export function biggestMoversStrip(markets) {
  const movers = markets?.biggest_movers;
  if (!Array.isArray(movers) || !movers.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'movers-strip-wrap';

  const title = document.createElement('div');
  title.className = 'movers-title';
  title.innerHTML = 'Biggest movers <a class="movers-link" href="#/winner">Winner odds →</a>';
  wrap.appendChild(title);

  const strip = document.createElement('div');
  strip.className = 'movers-strip';
  for (const m of movers) {
    const chip = document.createElement('a');
    chip.className = 'mover-chip';
    chip.href = `#/team/name/${encodeURIComponent(m.team)}`;
    const up = m.delta_24h_pp >= 0;
    const arrow = up ? '▲' : '▼';
    const cls = up ? 'delta-up' : 'delta-down';
    chip.innerHTML = `
      <span class="mover-team">${escapeHtml(m.team)}</span>
      <span class="mover-delta ${cls}">${arrow} ${Math.abs(m.delta_24h_pp).toFixed(1)}pp</span>
      <span class="mover-prob">${m.prob_pct.toFixed(1)}%</span>
    `;
    strip.appendChild(chip);
  }
  wrap.appendChild(strip);
  return wrap;
}

