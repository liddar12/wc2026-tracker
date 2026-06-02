/* matchup-list.js — default landing, scoped to Group D unless filtered. */
import { matchupCard } from '../components/matchup-card.js';
import { biggestMoversStrip } from '../components/biggest-movers.js';
import { whatChangedToday } from '../components/what-changed.js';
import { setRoute, watchlistKeys } from '../state.js';
import { helpCard, HELP_COPY } from '../components/help-card.js';

export function renderMatchupList(root, data, params) {
  // R6: optional Matches help card at the top, explaining the layer is non-gating
  root.appendChild(helpCard({ ...HELP_COPY.matches, persistKey: 'matches' }));
  const groups = Object.keys(data.groupMatchups).sort();
  const allTeams = Object.keys(data.teams).sort();
  const venues = Array.isArray(data.venues) ? data.venues : [];
  const venueById = new Map(venues.map(v => [v.id, v]));
  const scheduleFull = Array.isArray(data.scheduleFull) ? data.scheduleFull : [];
  const matchToVenue = new Map();
  for (const row of scheduleFull) {
    if (row.match_id && row.venue_id) matchToVenue.set(row.match_id, row.venue_id);
  }

  const watchOnly = params.watchlist === '1';
  const selectedTeam = watchOnly ? '' : (params.team || '');
  const selectedVenue = watchOnly ? '' : (params.venue || '');
  const selectedGroup = (selectedTeam || selectedVenue || watchOnly) ? '' : (params.group || 'D');

  const movers = biggestMoversStrip(data.markets);
  if (movers) root.appendChild(movers);
  root.appendChild(whatChangedToday(data));

  const filter = document.createElement('div');
  filter.className = 'filter-bar';
  filter.innerHTML = `
    <label>Group
      <select id="filter-group">
        <option value="all" ${selectedGroup === 'all' ? 'selected' : ''}>All groups</option>
        ${groups.map(g => `<option value="${g}" ${g === selectedGroup ? 'selected' : ''}>Group ${g}</option>`).join('')}
      </select>
    </label>
    <label>Country
      <select id="filter-team">
        <option value="" ${!selectedTeam ? 'selected' : ''}>All countries</option>
        ${allTeams.map(t => `<option value="${escapeAttr(t)}" ${t === selectedTeam ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select>
    </label>
    <label>Venue
      <select id="filter-venue">
        <option value="" ${!selectedVenue ? 'selected' : ''}>All venues</option>
        ${venues.slice().sort((a, b) => a.city.localeCompare(b.city)).map(v => `<option value="${escapeAttr(v.id)}" ${v.id === selectedVenue ? 'selected' : ''}>${escapeHtml(v.city)} — ${escapeHtml(v.name)}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="watch-filter ${watchOnly ? 'is-active' : ''}" id="filter-watch" aria-pressed="${watchOnly}">★ Watchlist</button>
    <a class="venues-link" href="#/venues" title="Open venues map" aria-label="Open venues map">🗺️</a>
    <a class="venues-link winner-link" href="#/winner" title="Winner odds" aria-label="Winner odds">🏆</a>
  `;
  root.appendChild(filter);

  filter.querySelector('#filter-group').addEventListener('change', (e) => {
    setRoute('matchups', { group: e.target.value, team: undefined, venue: undefined, watchlist: undefined });
  });
  filter.querySelector('#filter-team').addEventListener('change', (e) => {
    const t = e.target.value;
    if (t) setRoute('matchups', { team: t, group: undefined, venue: undefined, watchlist: undefined });
    else setRoute('matchups', { group: 'all', team: undefined, venue: undefined, watchlist: undefined });
  });
  filter.querySelector('#filter-venue').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) setRoute('matchups', { venue: v, group: undefined, team: undefined, watchlist: undefined });
    else setRoute('matchups', { group: 'all', team: undefined, venue: undefined, watchlist: undefined });
  });
  filter.querySelector('#filter-watch').addEventListener('click', () => {
    if (watchOnly) setRoute('matchups', { group: 'D', watchlist: undefined });
    else setRoute('matchups', { watchlist: '1', group: undefined, team: undefined, venue: undefined });
  });

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  if (watchOnly) heading.textContent = 'Watchlist';
  else if (selectedTeam) heading.textContent = `${selectedTeam}'s group matches`;
  else if (selectedVenue) {
    const v = venueById.get(selectedVenue);
    heading.textContent = v ? `Matches at ${v.name} (${v.city})` : 'Matches at venue';
  }
  else if (selectedGroup === 'all') heading.textContent = `All matches (${countAll(data)} total)`;
  else heading.textContent = `Group ${selectedGroup}`;
  heading.style.cssText = 'margin: 0 0 10px; font-size: 16px;';
  root.appendChild(heading);

  let matches = [];
  if (watchOnly) {
    const keys = new Set(watchlistKeys());
    for (const info of Object.values(data.groupMatchups)) {
      for (const m of info.matches) {
        const key = `${m.team_a}__vs__${m.team_b}`;
        if (keys.has(key)) matches.push({ ...m, group: info.group });
      }
    }
  } else if (selectedTeam) {
    for (const info of Object.values(data.groupMatchups)) {
      for (const m of info.matches) {
        if (m.team_a === selectedTeam || m.team_b === selectedTeam) {
          matches.push({ ...m, group: info.group });
        }
      }
    }
  } else if (selectedVenue) {
    for (const info of Object.values(data.groupMatchups)) {
      for (const m of info.matches) {
        const mid = m.match_id || `${m.team_a}__vs__${m.team_b}`;
        if (matchToVenue.get(mid) === selectedVenue) {
          matches.push({ ...m, group: info.group });
        }
      }
    }
  } else if (selectedGroup === 'all') {
    for (const info of Object.values(data.groupMatchups)) {
      for (const m of info.matches) matches.push({ ...m, group: info.group });
    }
  } else {
    const info = data.groupMatchups[selectedGroup];
    if (info) matches = info.matches.map(m => ({ ...m, group: info.group }));
  }

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = watchOnly ? 'No starred matches yet — tap ☆ on a card.' : 'No matches.';
    root.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'matchup-list';
  for (const m of matches) list.appendChild(matchupCard(m, data));
  root.appendChild(list);
}

function countAll(data) {
  let n = 0;
  for (const g of Object.values(data.groupMatchups)) n += g.matches.length;
  return n;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
