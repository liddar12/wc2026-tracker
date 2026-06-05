/* search-overlay.js — client-side global search. */
import { escapeHtml } from '../lib/escape.js';
import { setRoute } from '../state.js';
import { flagFor } from './team-flag.js';

let overlayEl = null;

export function openSearch(data) {
  if (!overlayEl) overlayEl = buildOverlay();
  overlayEl.querySelector('input').value = '';
  overlayEl.querySelector('.search-results').innerHTML = '';
  overlayEl.hidden = false;
  document.body.classList.add('search-open');
  setTimeout(() => overlayEl.querySelector('input').focus(), 50);
  overlayEl._data = data;
}

export function closeSearch() {
  if (!overlayEl) return;
  overlayEl.hidden = true;
  document.body.classList.remove('search-open');
}

function buildOverlay() {
  const el = document.createElement('div');
  el.className = 'search-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="search-panel">
      <div class="search-header">
        <input type="search" class="search-input" placeholder="Teams, players, venues…" autocomplete="off" enterkeyhint="search">
        <button type="button" class="search-close" aria-label="Close search">✕</button>
      </div>
      <div class="search-results" role="listbox"></div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('.search-close').addEventListener('click', closeSearch);
  el.addEventListener('click', (e) => {
    if (e.target === el) closeSearch();
  });
  el.querySelector('input').addEventListener('input', (e) => {
    runSearch(el._data, e.target.value, el.querySelector('.search-results'));
  });
  return el;
}

function runSearch(data, q, container) {
  container.innerHTML = '';
  const query = (q || '').trim().toLowerCase();
  if (query.length < 2) {
    container.innerHTML = '<p class="muted search-hint">Type at least 2 characters</p>';
    return;
  }

  const groups = { Teams: [], Players: [], Matches: [], Venues: [] };

  for (const name of Object.keys(data.teams || {})) {
    if (name.toLowerCase().includes(query)) {
      groups.Teams.push({ label: name, href: `#/team/name/${encodeURIComponent(name)}`, icon: flagFor(name) });
    }
    const coach = data.teams[name]?.coach?.name;
    if (coach && coach.toLowerCase().includes(query)) {
      groups.Players.push({
        label: `${coach} (coach, ${name})`,
        href: `#/team/name/${encodeURIComponent(name)}`,
      });
    }
  }

  for (const p of data.players || []) {
    if ((p.name || '').toLowerCase().includes(query)) {
      groups.Players.push({
        label: `${p.name} (${p.team})`,
        href: `#/team/name/${encodeURIComponent(p.team)}`,
      });
    }
  }

  for (const info of Object.values(data.groupMatchups || {})) {
    for (const m of info.matches || []) {
      const label = `${m.team_a} vs ${m.team_b}`;
      if (label.toLowerCase().includes(query) || m.team_a.toLowerCase().includes(query) || m.team_b.toLowerCase().includes(query)) {
        groups.Matches.push({
          label,
          href: `#/matchup/team_a/${encodeURIComponent(m.team_a)}/team_b/${encodeURIComponent(m.team_b)}`,
        });
      }
    }
  }

  for (const v of data.venues || []) {
    const hay = `${v.name} ${v.city} ${v.country}`.toLowerCase();
    if (hay.includes(query)) {
      groups.Venues.push({
        label: `${v.name} (${v.city})`,
        href: `#/venue/id/${encodeURIComponent(v.id)}`,
      });
    }
  }

  let any = false;
  for (const [title, items] of Object.entries(groups)) {
    if (!items.length) continue;
    any = true;
    const h = document.createElement('div');
    h.className = 'search-group-title';
    h.textContent = title;
    container.appendChild(h);
    for (const item of items.slice(0, 8)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-row';
      row.innerHTML = item.icon ? `<span class="flag">${item.icon}</span> ${escapeHtml(item.label)}` : escapeHtml(item.label);
      row.addEventListener('click', () => {
        closeSearch();
        location.hash = item.href.replace(/^#/, '');
        const m = item.href.match(/^#\/([^/]+)/);
        if (m) {
          const route = parseHref(item.href);
          setRoute(route.view, route.params);
        }
      });
      container.appendChild(row);
    }
  }
  if (!any) container.innerHTML = '<p class="muted search-hint">No results</p>';
}

function parseHref(href) {
  const trimmed = href.replace(/^#\/?/, '');
  const [view, ...rest] = trimmed.split('/');
  const params = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i]) params[rest[i]] = decodeURIComponent(rest[i + 1] || '');
  }
  return { view: view || 'matchups', params };
}

