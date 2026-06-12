/* match-events.js — per-match goals + cards timeline and discipline panel.
   Data: data/match_events.json (scrape_match_events.py, ESPN summary keyEvents)
     { "<A__vs__B>": { events: [{minute, type, player, team}], updated_at } }
   Renders nothing when the match has no events yet (pre-kickoff). */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';

const ICONS = { goal: '⚽', 'pen-goal': '⚽ (pen)', 'own-goal': '⚽ (og)', yellow: '🟨', red: '🟥' };

function eventsFor(matchEvents, a, b) {
  const rec = (matchEvents || {})[`${a}__vs__${b}`] || (matchEvents || {})[`${b}__vs__${a}`];
  return Array.isArray(rec?.events) ? rec.events : null;
}

/** Tournament-wide card totals per player, aggregated across every match. */
function cardTotals(matchEvents) {
  const totals = {};
  for (const [key, rec] of Object.entries(matchEvents || {})) {
    if (key === '__meta__' || !Array.isArray(rec?.events)) continue;
    for (const e of rec.events) {
      if (e.type !== 'yellow' && e.type !== 'red') continue;
      if (!e.player) continue;
      const t = totals[e.player] || (totals[e.player] = { yellow: 0, red: 0, team: e.team });
      t[e.type]++;
    }
  }
  return totals;
}

export function matchEventsSection(match, matchEvents) {
  const events = eventsFor(matchEvents, match.team_a, match.team_b);
  if (!events || !events.length) return document.createDocumentFragment();

  const sec = document.createElement('div');
  sec.className = 'section';
  const goals = events.filter((e) => e.type.includes('goal'));
  const cards = events.filter((e) => e.type === 'yellow' || e.type === 'red');

  // Timeline (chronological, as delivered)
  const rows = events.map((e) => `
    <li class="ev-row">
      <span class="ev-minute">${escapeHtml(e.minute || '')}</span>
      <span class="ev-icon" aria-hidden="true">${ICONS[e.type] || ''}</span>
      <span class="ev-player">${escapeHtml(e.player || '—')} <span class="muted">${escapeHtml(e.team || '')}</span></span>
    </li>`).join('');

  // Discipline: per carded player — this game + tournament totals.
  const totals = cardTotals(matchEvents);
  const seen = new Set();
  const discRows = cards.filter((e) => {
    if (!e.player || seen.has(e.player)) return false;
    seen.add(e.player);
    return true;
  }).map((e) => {
    const t = totals[e.player] || { yellow: 0, red: 0 };
    const thisGame = cards.filter((x) => x.player === e.player)
      .map((x) => `${ICONS[x.type]} ${escapeHtml(x.minute || '')}`).join(' ');
    return `
      <li class="ev-row">
        <span class="ev-minute">${flagFor(e.team)}</span>
        <span class="ev-player">${escapeHtml(e.player)}
          <span class="muted">this game: ${thisGame} · tournament: ${t.yellow}🟨 ${t.red}🟥</span>
        </span>
      </li>`;
  }).join('');

  const teamCards = (team) => {
    const y = cards.filter((e) => e.team === team && e.type === 'yellow').length;
    const r = cards.filter((e) => e.team === team && e.type === 'red').length;
    return `${y}🟨 ${r}🟥`;
  };

  sec.innerHTML = `
    <h2>Match events</h2>
    <ol class="ev-list" data-testid="match-events">${rows}</ol>
    ${cards.length ? `
      <h3 class="ev-subhead">Discipline <span class="muted ev-team-totals">${escapeHtml(match.team_a)} ${teamCards(match.team_a)} · ${escapeHtml(match.team_b)} ${teamCards(match.team_b)}</span></h3>
      <ul class="ev-list" data-testid="match-discipline">${discRows}</ul>` : ''}
    <p class="muted" style="font-size:11px;margin:6px 0 0;">${goals.length} goal${goals.length === 1 ? '' : 's'} · ${cards.length} card${cards.length === 1 ? '' : 's'} · refreshes through the match.</p>
  `;
  return sec;
}
