/* h2h.js — head-to-head pill strip + last meeting one-liner. */

export function h2hSection(match, h2h) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Head-to-head</h2>';

  const key1 = `${match.team_a}__vs__${match.team_b}`;
  const key2 = `${match.team_b}__vs__${match.team_a}`;
  const rows = ((h2h || {})[key1] || (h2h || {})[key2] || []).slice(0, 5);

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No recent meetings on record.';
    sec.appendChild(p);
    return sec;
  }

  const strip = document.createElement('div');
  strip.className = 'h2h-strip';

  // We compute the pill from team_a's perspective using rec.winner.
  for (const rec of rows) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    const wTeamA = rec.winner === match.team_a;
    const wTeamB = rec.winner === match.team_b;
    if (rec.winner === 'draw') { pill.classList.add('pill-d'); pill.textContent = 'D'; }
    else if (wTeamA) { pill.classList.add('pill-w'); pill.textContent = 'W'; }
    else if (wTeamB) { pill.classList.add('pill-l'); pill.textContent = 'L'; }
    else { pill.classList.add('pill-d'); pill.textContent = '?'; }
    pill.title = `${rec.date || '?'} · ${match.team_a} ${rec.score_a}-${rec.score_b} ${match.team_b}`;
    strip.appendChild(pill);
  }
  sec.appendChild(strip);

  const last = rows[0];
  const line = document.createElement('p');
  line.className = 'muted';
  line.style.fontSize = '12px';
  line.textContent = `Last meeting: ${last.date || '?'} · ${match.team_a} ${last.score_a}–${last.score_b} ${match.team_b}`;
  sec.appendChild(line);
  return sec;
}
