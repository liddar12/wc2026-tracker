/* team-detail.js — team header, position bars, roster, upcoming. */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from '../components/team-flag.js';
import { matchupCard } from '../components/matchup-card.js';
import { downloadIcsForTeam } from '../calendar-export.js';

export function renderTeamDetail(root, data, params) {
  const teamName = params.name;
  const team = data.teams[teamName];
  if (!team) {
    root.innerHTML = '<p class="loading">Team not found.</p>';
    return;
  }

  const head = document.createElement('div');
  head.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="flag" aria-hidden="true" style="font-size:40px;">${flagFor(team.name)}</span>
      <div>
        <h2 style="margin:0;font-size:20px;">${escapeHtml(team.name)}</h2>
        <div class="muted" style="font-size:13px;">
          Group ${escapeHtml(team.group || '?')} · Composite ${team.composite?.toFixed?.(1) ?? '—'}
          · FIFA #${team.fifa_rank ?? '—'} · ESPN #${team.espn_rank ?? '—'}
          ${team.is_host ? ' · 🏠 Host' : ''}${team.continental_champion ? ' · 🏆 Cont. champ' : ''}
        </div>
        ${team.coach ? `<div class="muted" style="font-size:12px;margin-top:4px;">Coach: ${escapeHtml(team.coach.name)} (${escapeHtml(team.coach.nationality)})</div>` : ''}
      </div>
    </div>
    <div style="margin-top:10px;">
      <button class="pick-btn pick-btn-secondary" id="team-ics-btn" type="button" aria-label="Download ${escapeHtml(team.name)} fixtures to calendar">
        📅 Add fixtures to calendar
      </button>
    </div>
  `;
  root.appendChild(head);
  head.querySelector('#team-ics-btn')?.addEventListener('click', () => {
    const ok = downloadIcsForTeam(data, team.name);
    if (!ok) {
      const t = document.createElement('div');
      t.className = 'wc-toast-summary';
      t.textContent = 'No upcoming fixtures yet — try after the schedule is finalized.';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    }
  });

  // Position bars
  const pr = team.position_ratings || {};
  const posSection = document.createElement('div');
  posSection.className = 'section';
  posSection.innerHTML = `<h2>Position ratings</h2>`;
  const bars = document.createElement('div');
  bars.className = 'pos-bars';
  for (const [pos, label] of [['gk','GK'],['def','DEF'],['mid','MID'],['fwd','FWD']]) {
    const v = pr[pos];
    if (typeof v !== 'number') continue;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <span>${label}</span>
      <span class="track"><span class="fill" style="width:${Math.min(100, Math.max(0, v))}%"></span></span>
      <span style="text-align:right;">${v.toFixed(1)}</span>
    `;
    bars.appendChild(row);
  }
  posSection.appendChild(bars);
  root.appendChild(posSection);

  // Upcoming matches in tournament (from group matchups)
  const groupInfo = data.groupMatchups[team.group];
  if (groupInfo) {
    const matches = groupInfo.matches.filter(m => m.team_a === team.name || m.team_b === team.name)
      .map(m => ({ ...m, group: team.group }));
    if (matches.length) {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.innerHTML = '<h2>Group matches</h2>';
      for (const m of matches) sec.appendChild(matchupCard(m, data));
      root.appendChild(sec);
    }
  }

  // Roster
  const roster = (data.players || []).filter(p => p.team === team.name);
  if (roster.length) {
    const sec = document.createElement('div');
    sec.className = 'section';
    sec.innerHTML = `<h2>Roster (${roster.length})</h2>`;
    const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    roster.sort((a, b) => (order[a.position] ?? 9) - (order[b.position] ?? 9) || b.overall - a.overall);
    const table = document.createElement('table');
    table.className = 'roster-table';
    table.innerHTML = `
      <thead><tr><th>Pos</th><th>Player</th><th>Club</th><th class="num">Age</th><th class="num">Caps</th><th class="num">OVR</th></tr></thead>
      <tbody>
        ${roster.map(p => `
          <tr>
            <td>${escapeHtml(p.position || '')}</td>
            <td>${escapeHtml(p.name)}${p.injury_status ? ` <span class="upset-badge sev-medium" style="margin-left:4px;">${escapeHtml(p.injury_status)}</span>` : ''}</td>
            <td class="muted">${escapeHtml(p.club || '')}</td>
            <td class="num">${p.age ?? '—'}</td>
            <td class="num">${p.caps ?? '—'}</td>
            <td class="num">${typeof p.overall === 'number' ? p.overall.toFixed(0) : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    sec.appendChild(table);
    root.appendChild(sec);
  }
}

