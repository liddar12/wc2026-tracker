/* lineups.js — collapsible Lineups section. Open if data present, TBA otherwise. */

export function lineupsSection(match, lineups) {
  const sec = document.createElement('details');
  sec.className = 'section lineups-section';
  const key = `${match.team_a}__vs__${match.team_b}`;
  const altKey = `${match.team_b}__vs__${match.team_a}`;
  const data = (lineups || {})[key] || (lineups || {})[altKey] || null;

  sec.open = !!data;
  const summary = document.createElement('summary');
  summary.innerHTML = `<h2>Lineups${data ? '' : ' <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:normal;">— TBA</span>'}</h2>`;
  sec.appendChild(summary);

  if (!data) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Starting elevens are typically posted ~75 minutes before kickoff.';
    sec.appendChild(p);
    return sec;
  }

  const wrap = document.createElement('div');
  wrap.className = 'lineups-grid';
  wrap.appendChild(sideBlock(match.team_a, data.team_a));
  wrap.appendChild(sideBlock(match.team_b, data.team_b));
  sec.appendChild(wrap);
  if (data.updated_at) {
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.style.fontSize = '11px';
    meta.textContent = `Lineups updated ${data.updated_at}`;
    sec.appendChild(meta);
  }
  return sec;
}

function sideBlock(teamName, side) {
  const col = document.createElement('div');
  col.className = 'lineup-col';
  if (!side) {
    col.innerHTML = `<h3>${escapeHtml(teamName)}</h3><p class="muted">TBA</p>`;
    return col;
  }
  col.innerHTML = `
    <h3>${escapeHtml(teamName)}</h3>
    ${side.manager ? `<div class="muted" style="font-size:12px;margin-bottom:6px;">Manager: ${escapeHtml(side.manager)}</div>` : ''}
    <ol class="xi-list">
      ${(side.xi || []).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
    </ol>
  `;
  return col;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
