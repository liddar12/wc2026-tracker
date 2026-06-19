/* injuries-view.js — D10: tournament-wide injury dashboard.
   Reads data/injuries.json, groups by team, surfaces severity color codes.
*/
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from '../components/team-flag.js';
import { setRoute } from '../state.js';
import { suspensions } from '../lib/availability.js';

export function renderInjuriesView(root, data) {
  root.innerHTML = '';
  const injuries = data?.injuries || {};
  const byTeam = injuries.by_team || {};
  const updatedAt = injuries.__meta__?.updated_at || injuries.updated_at;

  const head = document.createElement('div');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">Injuries &amp; availability <span class="home-card-meta muted">${updatedAt ? `updated ${escapeHtml(formatRel(updatedAt))}` : 'no data'}</span></h2>
    <p class="muted" style="margin: 0; font-size: 13px;">Reported injuries, late fitness flags, and card suspensions across all 48 teams. Refreshed through the day.</p>
  `;
  root.appendChild(head);

  // Card suspensions (from live match events): a straight red = banned for the
  // team's NEXT match (at least); two accumulated yellows across matches = a
  // one-match ban (FIFA rule; accumulated yellows wipe after the QFs).
  const susp = suspensions(data);
  if (susp.length) {
    const card = document.createElement('section');
    card.className = 'home-card';
    card.style.marginBottom = '12px';
    card.dataset.testid = 'suspensions';
    card.innerHTML = `
      <h2 class="home-card-title">Suspensions (cards)</h2>
      <ul class="ev-list">
        ${susp.map((s) => `
          <li class="ev-row">
            <span class="ev-minute">${flagFor(s.team)}</span>
            <span class="ev-player"><strong>${escapeHtml(s.player)}</strong>
              <span class="muted">${escapeHtml(s.reason)}${s.misses ? ` — misses ${escapeHtml(s.misses)}` : ''}</span>
            </span>
          </li>`).join('')}
      </ul>
      <p class="muted" style="font-size:11px;margin:6px 0 0;">From live match events. Reds = next-match ban minimum (FIFA may extend); 2 accumulated yellows = one-match ban.</p>
    `;
    root.appendChild(card);
  }

  const teams = Object.keys(byTeam).sort();
  const withInjuries = teams.filter((t) => (byTeam[t] || []).length > 0);
  if (!withInjuries.length) {
    const empty = document.createElement('div');
    empty.className = 'bb-empty home-card';
    empty.innerHTML = `
      <p style="margin:0 0 8px;">No reported injuries yet.</p>
      <p class="muted" style="font-size:12px; margin:0;">Updates as the scrape picks up news from federation pages.</p>
    `;
    root.appendChild(empty);
    return;
  }

  for (const team of withInjuries) {
    const items = byTeam[team] || [];
    if (!items.length) continue;
    const section = document.createElement('section');
    section.className = 'home-card injury-team';
    section.style.marginBottom = '12px';
    section.innerHTML = `
      <h3 class="injury-team-head">${flagFor(team)} <strong>${escapeHtml(team)}</strong> <span class="muted">${items.length} report${items.length === 1 ? '' : 's'}</span></h3>
      <ul class="injury-list">
        ${items.map((inj) => `
          <li class="injury-row injury-sev-${severityClass(inj.status || inj.severity)}">
            <div class="injury-player">${escapeHtml(inj.player || inj.name || 'Unknown')} <span class="muted">${escapeHtml(inj.position || '')}</span></div>
            <div class="muted injury-meta">${escapeHtml(inj.injury || inj.note || inj.reason || 'Unspecified')}${inj.status ? ` · ${escapeHtml(inj.status)}` : ''}${inj.return ? ` · expected ${escapeHtml(inj.return)}` : ''}</div>
          </li>
        `).join('')}
      </ul>
      <button class="pick-btn pick-btn-secondary" data-team="${escapeHtml(team)}">View ${escapeHtml(team)} →</button>
    `;
    section.querySelector('[data-team]').addEventListener('click', (e) => {
      const t = e.currentTarget.dataset.team;
      setRoute('team', { name: t });
    });
    root.appendChild(section);
  }
}

function severityClass(status) {
  if (!status) return 'low';
  const s = String(status).toLowerCase();
  if (/(out|ruled out|long.term|fracture|tear|surgery|broken)/.test(s)) return 'high';
  if (/(doubt|question|hamstr|knock|minor|fit.*pending|game.time)/.test(s)) return 'med';
  return 'low';
}

function formatRel(iso) {
  if (!iso) return '';
  try {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return ''; }
}

// (Suspension derivation moved to app/lib/availability.js — shared with the
// matchup view so both surfaces agree on who is unavailable.)

