/* large-match-card.js — Apple Sports-inspired large match card.
   One card per match, ~240–280px tall, big tabular score numbers in the
   display font, team-color gradient banner. Modes: upcoming / live / final.
*/
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';
import { getTeamColors } from '../team-skin.js';
import { shortTeamName } from '../lib/team-names.js';
// Single source of truth for status — replaces the local FINAL/LIVE Sets and
// the old 2h-clock inferMode (which mislabeled a past-kickoff knockout with no
// record as a phantom 'final').
import {
  FINAL_STATUSES, LIVE_STATUSES, deriveMode, methodOfVictory, winnerFromRecord,
} from '../lib/match-status.js';

export function largeMatchCard(match, opts = {}) {
  const {
    mode = deriveMode(null, match.kickoff_utc, { stage: match.stage }),
                               // 'upcoming' | 'live' | 'final' | 'pending'
    actual = null,             // { score_a, score_b, minute? }
    winner = null,             // canonical winning team name (final cards) — for ties
                               //   broken by ET/pens this is the only correct source
    method = null,             // methodOfVictory() result (FT/AET/pens) for the tag
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

  // Winning team + method of victory (FT/AET/pens) for a final card. Callers
  // pass opts.winner / opts.method (from actualForCard, which is orientation- and
  // tie-aware — the only correct source for a pen/ET tie). When a caller forwards
  // only opts.actual we still highlight the higher score (the regulation case),
  // so a finished group game lights up its winner without any extra wiring.
  // Winner is a canonical team name; compare against the raw team names.
  const winnerName = (mode === 'final')
    ? (winner || (actual && Number.isFinite(actual.score_a) && actual.score_a !== actual.score_b
        ? (actual.score_a > actual.score_b ? teamA : teamB)
        : null))
    : null;
  const methodTag = (mode === 'final')
    ? (method || (actual?.status ? methodOfVictory({ status: actual.status }) : null))
    : null;
  const aWins = !!winnerName && winnerName === teamA;
  const bWins = !!winnerName && winnerName === teamB;

  // Eyebrow string — varies by mode
  let eyebrow = '';
  if (mode === 'live') {
    const minute = actual?.minute || match.minute || '';
    eyebrow = `<span class="live-indicator">LIVE${minute ? ' ' + escapeHtml(String(minute)) + "'" : ''}</span> · ${escapeHtml(stage)}`;
  } else if (mode === 'final') {
    // Append the method tag (FT/AET/pens) so a knockout decided in ET or on
    // penalties reads correctly — and so the cue is not score-only.
    // Include the shootout suffix (e.g. " (3–2)", en-dash hi–lo) so a pen
    // knockout reads "pens (3–2)" on the card eyebrow, matching the
    // matchup-detail view and methodOfVictory()'s suffix.
    const tag = methodTag
      ? ` <span class="lcard-method" data-method="${escapeHtml(methodTag.method || 'reg')}">${escapeHtml(methodTag.label)}${escapeHtml(methodTag.suffix || '')}</span>`
      : '';
    eyebrow = `FINAL${tag} · ${escapeHtml(stage)}`;
  } else if (mode === 'pending') {
    // Past kickoff, no result yet — show the time (or a neutral note), never a
    // phantom "FINAL" with a bare "vs".
    eyebrow = kickoff
      ? `${escapeHtml(formatKickoffTime(kickoff))} · ${escapeHtml(stage)}`
      : `RESULT PENDING · ${escapeHtml(stage)}`;
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
      : (mode === 'pending'
        ? '<div class="lcard-vs lcard-pending">Result pending</div>'
        : ''));

  card.innerHTML = `
    <div class="lcard-banner" data-team-a="${escapeHtml(teamA)}" data-team-b="${escapeHtml(teamB)}"></div>
    <div class="lcard-body">
      <div class="lcard-teams">
        <div class="lcard-team lcard-team-a${aWins ? ' is-winner' : ''}">
          <span class="lcard-flag">${flagFor(teamA)}</span>
          <span class="lcard-team-name" title="${escapeHtml(teamA)}">${escapeHtml(shortTeamName(teamA))}</span>
        </div>
        ${scoreRow || '<div class="lcard-vs">vs</div>'}
        <div class="lcard-team lcard-team-b${bWins ? ' is-winner' : ''}">
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

// ---- actual-result lookup for cards -----------------------------------------
// largeMatchCard accepts opts.actual but NO view was passing it — cards showed
// "FINAL" (time-inferred) with no score digits. This is the one shared,
// orientation-safe lookup both Home and Schedule wire in. Status membership now
// comes from the shared match-status lib (FINAL_STATUSES / LIVE_STATUSES) so the
// knockout-only resolutions (STATUS_FINAL_AET / STATUS_FINAL_PEN) and the
// live HALF-specific statuses stay in lockstep with scoring/bracket/standings.
const TIER_BY_STAGE = {
  group: 'group_stage', group_stage: 'group_stage',
  round_of_32: 'round_of_32', round_of_16: 'round_of_16',
  quarterfinals: 'quarterfinals', semifinals: 'semifinals',
  third_place: 'third_place', final: 'final',
};

/**
 * Returns { actual: {score_a, score_b, minute?}, mode, winner?, status?, method? }
 * for a schedule row, oriented to the row's team_a/team_b — or null when there's
 * nothing displayable yet. STATUS_SCHEDULED placeholder rows (the scraper writes
 * 0-0 stubs for future matches) are excluded, or every upcoming card would read
 * "0 – 0".
 *
 * `actual` stays minimal ({score_a, score_b, minute?}) — it is the score payload
 * the card animates. For a FINAL record the winner (canonical team name,
 * orientation-safe) and the method of victory (FT/AET/pens + shootout tally)
 * ride along as SIBLING fields so the card can highlight the winner and tag how
 * the tie was broken; callers forward them via opts.winner / opts.method.
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
  const out = { actual, mode };
  if (mode === 'final') {
    out.status = status;
    // Winner is the canonical advancing team — explicit (ties broken by ET/pens)
    // or score-derived for a regulation result. winnerFromRecord reads the
    // record's OWN score orientation, so pass the team names in the record's
    // orientation (swapped when the stored row is flipped) — the returned winner
    // is a canonical name and stays correct for the card's a/b sides.
    const recA = flipped ? match.team_b : match.team_a;
    const recB = flipped ? match.team_a : match.team_b;
    const winner = winnerFromRecord(rec, recA, recB);
    if (winner) out.winner = winner;
    // Method tag (FT/AET/pens + shootout suffix). methodOfVictory orders the
    // shootout tally hi–lo, so the suffix is orientation-independent.
    out.method = methodOfVictory(rec);
  }
  return out;
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

