/* xg.js — model xG section for the matchup-detail view. */
import { sectionHeading } from './tooltip.js';

export function xgSection(match, xg) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.appendChild(sectionHeading('Expected goals (model)', 'xg'));

  const key1 = `${match.team_a}__vs__${match.team_b}`;
  const key2 = `${match.team_b}__vs__${match.team_a}`;
  const row = (xg || {})[key1] || (xg || {})[key2];
  if (!row || typeof row.team_a_xg !== 'number' || typeof row.team_b_xg !== 'number') {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'xG not yet computed for this match.';
    sec.appendChild(p);
    return sec;
  }
  const total = row.team_a_xg + row.team_b_xg;
  const aPct = total > 0 ? (row.team_a_xg / total) * 100 : 50;
  const bPct = 100 - aPct;
  const wrap = document.createElement('div');
  wrap.className = 'xg-block';
  wrap.innerHTML = `
    <div class="xg-numbers">
      <span><strong>${row.team_a_xg.toFixed(2)}</strong> ${escapeHtml(match.team_a)}</span>
      <span>${escapeHtml(match.team_b)} <strong>${row.team_b_xg.toFixed(2)}</strong></span>
    </div>
    <div class="xg-bar">
      <div class="xg-seg seg-a" style="width:${aPct}%"></div>
      <div class="xg-seg seg-b" style="width:${bPct}%"></div>
    </div>
    <p class="muted" style="font-size:11px;">Composite gap + recent form. ${row.formula_version ? `Formula ${escapeHtml(row.formula_version)}.` : ''}</p>
  `;
  sec.appendChild(wrap);
  return sec;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
