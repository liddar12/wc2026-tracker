/* group-view.js — standings + 6 cards for a single group, with group switcher. */
import { matchupCard } from '../components/matchup-card.js';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';

export function renderGroupView(root, data, params) {
  const groups = Object.keys(data.groupMatchups).sort();
  const group = params.group || 'D';
  const info = data.groupMatchups[group];
  if (!info) {
    root.innerHTML = '<p class="loading">Group not found.</p>';
    return;
  }

  // Group switcher
  const filter = document.createElement('div');
  filter.className = 'filter-bar';
  filter.innerHTML = `
    <label>Group
      <select id="filter-group">
        ${groups.map(g => `<option value="${g}" ${g === group ? 'selected' : ''}>Group ${g}</option>`).join('')}
      </select>
    </label>
  `;
  filter.querySelector('select').addEventListener('change', (e) => {
    setRoute('group', { group: e.target.value });
  });
  root.appendChild(filter);

  // Standings — projected from expected_points across the 3 matches each team plays
  const standings = computeStandings(info);
  const table = document.createElement('table');
  table.className = 'standings';
  table.innerHTML = `
    <thead><tr>
      <th>#</th><th>Team</th><th class="num">xPts</th><th class="num">xGF</th><th class="num">Adv%</th>
    </tr></thead>
    <tbody>
      ${standings.map((s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td class="team-cell"><a class="team-link" href="#/team/name/${encodeURIComponent(s.team)}"><span class="flag" aria-hidden="true">${flagFor(s.team)}</span> ${escapeHtml(s.team)}</a></td>
          <td class="num">${s.xpts.toFixed(2)}</td>
          <td class="num">${s.xgd > 0 ? '+' : ''}${s.xgd.toFixed(1)}</td>
          <td class="num">${(s.advProb * 100).toFixed(0)}%</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const standingsWrap = document.createElement('div');
  standingsWrap.className = 'section';
  standingsWrap.innerHTML = `<h2>Projected standings</h2>`;
  standingsWrap.appendChild(table);
  root.appendChild(standingsWrap);

  // Matches
  const matchesSection = document.createElement('div');
  matchesSection.className = 'section';
  matchesSection.innerHTML = '<h2>Matches</h2>';
  for (const m of info.matches) {
    matchesSection.appendChild(matchupCard({ ...m, group }, data));
  }
  root.appendChild(matchesSection);
}

function computeStandings(info) {
  const acc = Object.fromEntries(info.teams.map(t => [t, { team: t, xpts: 0, xgd: 0 }]));
  for (const m of info.matches) {
    // expected points
    acc[m.team_a].xpts += m.expected_points.team_a;
    acc[m.team_b].xpts += m.expected_points.team_b;
    // expected GD proxy: probability skew * 1.5 goals
    const skew = (m.probabilities.team_a_wins - m.probabilities.team_b_wins) / 100;
    acc[m.team_a].xgd += skew * 1.2;
    acc[m.team_b].xgd -= skew * 1.2;
  }
  const ranked = Object.values(acc).sort((a, b) => b.xpts - a.xpts || b.xgd - a.xgd);
  // Top-2 advance automatically; 3rd has roughly 50% (8 of 12 best 3rd places advance to Round of 32);
  // 4th has roughly 10%. Tweak by xpts gap to keep it informative.
  const ranks = ranked.map((s, i) => {
    let adv;
    if (i === 0) adv = 0.95;
    else if (i === 1) adv = 0.85;
    else if (i === 2) adv = 0.55;
    else adv = 0.15;
    // Adjust by points gap to runner-up
    const gap = ranked[1].xpts - s.xpts;
    adv = clamp(adv - gap * 0.05, 0.02, 0.99);
    return { ...s, advProb: adv };
  });
  return ranks;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
