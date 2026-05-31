/* large-match-card.js — Apple Sports-inspired large match card.
   One card per match, ~240–280px tall, big tabular score numbers in the
   display font, team-color gradient banner. Modes: upcoming / live / final.
*/
import { flagFor } from './team-flag.js';
import { getTeamColors } from '../team-skin.js';

export function largeMatchCard(match, opts = {}) {
  const {
    mode = inferMode(match),   // 'upcoming' | 'live' | 'final'
    actual = null,             // { score_a, score_b, minute? }
    onTap = null,              // optional click handler
    favorite = null,           // favorite team name; adds ⭐ eyebrow tag + accent border
    extraMeta = null,          // optional string appended to .lcard-meta (e.g. broadcast channel)
  } = opts;
  const isFavorite = favorite && (match.team_a === favorite || match.team_b === favorite);

  const card = document.createElement('article');
  card.className = 'lcard' + (isFavorite ? ' is-fav' : '');
  card.setAttribute('data-mode', mode);
  card.setAttribute('data-testid', 'large-match-card');
  if (match.team_a) card.setAttribute('data-team-a', match.team_a);
  if (match.team_b) card.setAttribute('data-team-b', match.team_b);
  if (isFavorite) card.setAttribute('data-favorite', 'true');
  if (onTap) {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', () => onTap(match));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(match); }});
  }

  const teamA = match.team_a || 'TBD';
  const teamB = match.team_b || 'TBD';
  const kickoff = match.kickoff_utc ? new Date(match.kickoff_utc) : null;
  const stage = prettyStage(match);
  const venue = match.venue_label || venueLabel(match);

  // Eyebrow string — varies by mode
  let eyebrow = '';
  if (mode === 'live') {
    const minute = actual?.minute || match.minute || '';
    eyebrow = `<span class="live-indicator">LIVE${minute ? ' ' + escapeHtml(String(minute)) + "'" : ''}</span> · ${escapeHtml(stage)}`;
  } else if (mode === 'final') {
    eyebrow = `FINAL · ${escapeHtml(stage)}`;
  } else {
    eyebrow = kickoff
      ? `${kickoffEyebrow(kickoff)} · ${escapeHtml(stage)}`
      : `TBD · ${escapeHtml(stage)}`;
  }
  // Favorite team tag at the very start of the eyebrow
  if (isFavorite) {
    eyebrow = `<span class="lcard-fav-tag">⭐ YOUR TEAM</span> · ${eyebrow}`;
  }

  // Score line (only for live + final)
  const scoreRow = (mode === 'live' || mode === 'final') && actual && Number.isFinite(actual.score_a)
    ? `<div class="lcard-score">${actual.score_a} <span class="lcard-score-dash">–</span> ${actual.score_b}</div>`
    : (mode === 'upcoming' && kickoff
      ? `<div class="lcard-kickoff">${escapeHtml(formatKickoffTime(kickoff))}</div>`
      : '');

  card.innerHTML = `
    <div class="lcard-banner" data-team-a="${escapeHtml(teamA)}" data-team-b="${escapeHtml(teamB)}"></div>
    <div class="lcard-body">
      <div class="lcard-eyebrow">${eyebrow}</div>
      <div class="lcard-teams">
        <div class="lcard-team lcard-team-a">
          <span class="lcard-flag">${flagFor(teamA)}</span>
          <span class="lcard-team-name">${escapeHtml(teamA)}</span>
        </div>
        ${scoreRow || '<div class="lcard-vs">vs</div>'}
        <div class="lcard-team lcard-team-b">
          <span class="lcard-team-name">${escapeHtml(teamB)}</span>
          <span class="lcard-flag">${flagFor(teamB)}</span>
        </div>
      </div>
      <div class="lcard-meta muted">
        ${venue ? `<span>${escapeHtml(venue)}</span>` : ''}
        ${extraMeta ? `<span>${escapeHtml(extraMeta)}</span>` : ''}
      </div>
    </div>
  `;

  // Apply team-color gradient asynchronously without blocking initial render
  paintBanner(card, teamA, teamB).catch(() => {});

  return card;
}

async function paintBanner(card, teamA, teamB) {
  const banner = card.querySelector('.lcard-banner');
  if (!banner) return;
  const [ca, cb] = await Promise.all([getTeamColors(teamA), getTeamColors(teamB)]);
  const a = (ca && ca.primary) || 'var(--primary)';
  const b = (cb && cb.primary) || 'var(--accent)';
  banner.style.background = `linear-gradient(135deg, ${a} 0%, ${a} 45%, ${b} 55%, ${b} 100%)`;
}

function inferMode(match) {
  if (!match.kickoff_utc) return 'upcoming';
  const now = Date.now();
  const k = Date.parse(match.kickoff_utc);
  if (!Number.isFinite(k)) return 'upcoming';
  const ended = k + 2 * 60 * 60 * 1000; // 2 hours past kickoff
  if (now < k) return 'upcoming';
  if (now < ended) return 'live';
  return 'final';
}

function prettyStage(m) {
  if (m.stage === 'group') return `Group ${m.group || ''}`.trim();
  return {
    round_of_32: 'R32',
    round_of_16: 'R16',
    quarterfinals: 'Quarterfinal',
    semifinals: 'Semifinal',
    third_place: 'Bronze',
    final: 'Final',
  }[m.stage] || m.stage || '';
}

function venueLabel(m) {
  return m.venue_id || '';
}

function kickoffEyebrow(date) {
  const now = new Date();
  const todayLocal = now.toLocaleDateString();
  const dateLocal = date.toLocaleDateString();
  const dayMs = 86400000;
  const dayDiff = Math.floor((date - new Date(todayLocal)) / dayMs);
  if (dateLocal === todayLocal) return 'TODAY';
  if (dayDiff === 1) return 'TOMORROW';
  if (dayDiff > 0 && dayDiff < 7) return date.toLocaleDateString([], { weekday: 'long' }).toUpperCase();
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
}

function formatKickoffTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
