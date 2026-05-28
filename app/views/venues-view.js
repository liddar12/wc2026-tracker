/* venues-view.js — SVG map of host cities + list of venues sorted by match count.
 *
 * Route: #/venues
 */
import { setRoute } from '../state.js';
import { BASEMAP_SVG, VIEWBOX, project } from '../components/venues-map.svg.js';

export function renderVenuesView(root, data, _params) {
  const venues = Array.isArray(data.venues) ? data.venues : [];
  const schedule = Array.isArray(data.scheduleFull) ? data.scheduleFull : [];

  if (!venues.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Venues list is not yet published.';
    root.appendChild(empty);
    return;
  }

  // Match counts per venue
  const countByVid = new Map();
  for (const row of schedule) {
    if (!row?.venue_id) continue;
    countByVid.set(row.venue_id, (countByVid.get(row.venue_id) || 0) + 1);
  }

  // Map
  const wrap = document.createElement('div');
  wrap.className = 'venues-map-wrap';
  wrap.innerHTML = `
    <svg class="venues-map" viewBox="${VIEWBOX}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Host cities for WC26">
      ${BASEMAP_SVG}
      <g class="pins"></g>
    </svg>
  `;
  root.appendChild(wrap);

  const pinsLayer = wrap.querySelector('.pins');
  for (const v of venues) {
    const { x, y } = project(v.lat, v.lon);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'venue-pin');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${v.name}, ${v.city}`);
    g.dataset.vid = v.id;
    g.innerHTML = `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" />
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="dot" />
      <text x="${(x + 11).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="13" class="pin-label">${escapeHtml(v.city)}</text>
    `;
    g.addEventListener('click', () => setRoute('venue', { id: v.id }));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setRoute('venue', { id: v.id });
      }
    });
    pinsLayer.appendChild(g);
  }

  // List sorted by match count desc
  const sorted = [...venues].sort((a, b) =>
    (countByVid.get(b.id) || 0) - (countByVid.get(a.id) || 0)
    || a.city.localeCompare(b.city)
  );

  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Host venues</h2>';
  const list = document.createElement('div');
  list.className = 'venue-list';
  for (const v of sorted) {
    const card = document.createElement('a');
    card.className = 'venue-card';
    card.href = `#/venue/id/${encodeURIComponent(v.id)}`;
    const cnt = countByVid.get(v.id) || 0;
    card.innerHTML = `
      <div class="venue-card__head">
        <div class="venue-card__name">${escapeHtml(v.name)}</div>
        <div class="muted">${escapeHtml(v.city)}, ${escapeHtml(v.country)}</div>
      </div>
      <div class="venue-card__meta">
        <span class="muted">Cap ${formatCap(v.capacity)}</span>
        <span class="badge">${cnt} ${cnt === 1 ? 'match' : 'matches'}</span>
      </div>
    `;
    list.appendChild(card);
  }
  sec.appendChild(list);
  root.appendChild(sec);
}

function formatCap(n) {
  if (typeof n !== 'number') return '?';
  return (n / 1000).toFixed(0) + 'k';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
