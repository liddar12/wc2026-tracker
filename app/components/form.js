/* form.js — last-5 W/D/L pills for both teams. */

export function formSection(match, form) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Recent form (last 5)</h2>';

  const wrap = document.createElement('div');
  wrap.className = 'form-grid';
  wrap.appendChild(side(match.team_a, (form || {})[match.team_a]));
  wrap.appendChild(side(match.team_b, (form || {})[match.team_b]));
  sec.appendChild(wrap);
  return sec;
}

function side(team, entries) {
  const col = document.createElement('div');
  col.className = 'form-col';
  if (!Array.isArray(entries) || entries.length === 0) {
    col.innerHTML = `<div class="form-team">${escapeHtml(team)}</div><div class="muted">No recent results on record.</div>`;
    return col;
  }
  const pills = entries.slice(0, 5).map((e) => {
    const r = e.result;
    const cls = r === 'W' ? 'pill-w' : r === 'L' ? 'pill-l' : 'pill-d';
    const label = r || '?';
    const tip = `${e.date || '?'} vs ${e.opponent || '?'} (${e.score_a ?? '?'}–${e.score_b ?? '?'})`;
    return `<span class="pill ${cls}" title="${escapeAttr(tip)}">${escapeHtml(label)}</span>`;
  }).join('');
  col.innerHTML = `<div class="form-team">${escapeHtml(team)}</div><div class="pill-strip">${pills}</div>`;
  return col;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
