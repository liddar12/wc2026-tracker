/* large-match-card.js — Apple Sports-inspired large match card.
   One card per match, ~240–280px tall, big tabular score numbers in the
   display font, team-color gradient banner. Modes: upcoming / live / final.
*/
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { getTeamColors } from '../team-skin.js';
import { shortTeamName } from '../lib/team-names.js';

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

  // Score line (only for live + final). B7: data-prev attrs let the score-
  // reveal animation count up from the previous value when polling refreshes.
  const scoreRow = (mode === 'live' || mode === 'final') && actual && Number.isFinite(actual.score_a)
    ? `<div class="lcard-score"><span class="lcard-score-num" data-side="a" data-val="${actual.score_a}">${actual.score_a}</span> <span class="lcard-score-dash">–</span> <span class="lcard-score-num" data-side="b" data-val="${actual.score_b}">${actual.score_b}</span></div>`
    : (mode === 'upcoming' && kickoff
      ? `<div class="lcard-kickoff">${escapeHtml(formatKickoffTime(kickoff))}</div>`
      : '');

  card.innerHTML = `
    <div class="lcard-banner" data-team-a="${escapeHtml(teamA)}" data-team-b="${escapeHtml(teamB)}"></div>
    <div class="lcard-body">
      <div class="lcard-teams">
        <div class="lcard-team lcard-team-a">
          <span class="lcard-flag">${flagFor(teamA)}</span>
          <span class="lcard-team-name" title="${escapeHtml(teamA)}">${escapeHtml(shortTeamName(teamA))}</span>
        </div>
        ${scoreRow || '<div class="lcard-vs">vs</div>'}
        <div class="lcard-team lcard-team-b">
          <span class="lcard-team-name" title="${escapeHtml(teamB)}">${escapeHtml(shortTeamName(teamB))}</span>
          <span class="lcard-flag">${flagFor(teamB)}</span>
        </div>
      </div>
      <div class="lcard-meta muted">
        ${venue ? `<span>${escapeHtml(venue)}</span>` : ''}
        ${extraMeta ? `<span>${escapeHtml(extraMeta)}</span>` : ''}
      </div>
      <!-- Status/group/your-team line moved BELOW the venue (was overlaying the
           team-color banner gradient — an ADA contrast failure). -->
      <div class="lcard-eyebrow lcard-eyebrow-below">${eyebrow}</div>
    </div>
  `;

  // Apply team-color gradient asynchronously without blocking initial render
  paintBanner(card, teamA, teamB).catch(() => {});

  // B7: when a score value changes between data refreshes, bump-animate
  // the new digit. Triggered when the new render replaces the same DOM
  // node — we compare against the previous data-prev-val attr stamped
  // by sessionStorage.
  applyScoreBumpFromMemory(card, match.match_id || `${teamA}__vs__${teamB}`, actual);

  return card;
}

const SCORE_MEMO = (typeof window !== 'undefined') ? (window.__wc26ScoreMemo ||= new Map()) : new Map();
function applyScoreBumpFromMemory(card, key, actual) {
  if (!actual || !Number.isFinite(actual.score_a)) return;
  const prev = SCORE_MEMO.get(key);
  const next = { a: actual.score_a, b: actual.score_b };
  SCORE_MEMO.set(key, next);
  if (!prev) return;  // first time we see this match's score
  if (prev.a !== next.a) {
    const el = card.querySelector('.lcard-score-num[data-side="a"]');
    if (el) bump(el);
  }
  if (prev.b !== next.b) {
    const el = card.querySelector('.lcard-score-num[data-side="b"]');
    if (el) bump(el);
  }
}
function bump(el) {
  el.classList.remove('is-bumped');
  void el.offsetWidth;
  el.classList.add('is-bumped');
  fireBallBurst(el);
}

function fireBallBurst(scoreEl) {
  const reduce = (typeof document !== 'undefined') &&
    (document.documentElement.classList.contains('wc-reduce-motion') ||
     (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  if (reduce) return;
  // The score span needs to be a positioning context so the burst is centered.
  scoreEl.classList.add('lcard-score-bumpable');
  const burst = document.createElement('span');
  burst.className = 'wc-ball-burst';
  burst.setAttribute('aria-hidden', 'true');
  scoreEl.appendChild(burst);
  setTimeout(() => burst.remove(), 1200);
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

// ---- actual-result lookup for cards -----------------------------------------
// largeMatchCard accepts opts.actual but NO view was passing it — cards showed
// "FINAL" (time-inferred) with no score digits. This is the one shared,
// orientation-safe lookup both Home and Schedule wire in.
const TIER_BY_STAGE = {
  group: 'group_stage', group_stage: 'group_stage',
  round_of_32: 'round_of_32', round_of_16: 'round_of_16',
  quarterfinals: 'quarterfinals', semifinals: 'semifinals',
  third_place: 'third_place', final: 'final',
};
// Knockout matches can end after extra time (STATUS_FINAL_AET) or a penalty
// shootout (STATUS_FINAL_PEN) — ESPN's score field holds the regulation score
// (e.g. 1-1) and the status carries the resolution. These never occur in the
// group stage, so they were missing here; without them a finished knockout
// card fell through to a bare "vs" with no time and no score.
const FINAL_STATUSES = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME',
  'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
]);
// ESPN soccer uses HALF-specific statuses live (verified June 12: a 26'-minute
// game reports STATUS_FIRST_HALF, not STATUS_IN_PROGRESS) — missing them made
// the lookup reject live records entirely (no score, no clock).
const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF',
  'STATUS_HALFTIME', 'STATUS_END_PERIOD', 'STATUS_OVERTIME',
  'STATUS_FIRST_HALF_EXTRA_TIME', 'STATUS_SECOND_HALF_EXTRA_TIME',
  'STATUS_HALFTIME_ET', 'STATUS_SHOOTOUT',
]);

/**
 * Returns { actual: {score_a, score_b}, mode } for a schedule row, oriented to
 * the row's team_a/team_b — or null when there's nothing displayable yet.
 * STATUS_SCHEDULED placeholder rows (the scraper writes 0-0 stubs for future
 * matches) are excluded, or every upcoming card would read "0 – 0".
 */
export function actualForCard(actualResults, match) {
  if (!actualResults || !match?.team_a || !match?.team_b) return null;
  const tier = actualResults[TIER_BY_STAGE[match.stage] || 'group_stage'] || {};
  const direct = tier[`${match.team_a}__vs__${match.team_b}`];
  const flipped = direct ? null : tier[`${match.team_b}__vs__${match.team_a}`];
  const rec = direct || flipped;
  if (!rec) return null;
  const sa = Number(rec.score_a ?? rec.team_a_score);
  const sb = Number(rec.score_b ?? rec.team_b_score);
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  const status = rec.status || '';
  if (status && !FINAL_STATUSES.has(status) && !LIVE_STATUSES.has(status)) return null;
  const actual = flipped ? { score_a: sb, score_b: sa } : { score_a: sa, score_b: sb };
  if (rec.minute) actual.minute = rec.minute; // live game clock (e.g. "67'")
  const mode = FINAL_STATUSES.has(status) ? 'final' : LIVE_STATUSES.has(status) ? 'live' : null;
  return { actual, mode };
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

