/* momentum-chart.js — RJ30.2 Match Intelligence (Wave-1 B).
 *
 * A compact "momentum strip" for the matchup-detail view, built from the ESPN
 * key-events timeline that scrape_match_stats.py stores at
 * data.matchStats[match_id].key_events. It shows the FLOW of a game:
 *   - a per-minute shot-pressure sparkline (reusing app/components/sparkline.js),
 *     where each side's shots are bucketed into ~6-minute-of-play columns and the
 *     home/away pressure is the running difference (attack up, defend down);
 *   - goal markers pinned on the strip at the minute each goal was scored.
 *
 * Display-only, pure, never throws. Reuses the shared sparkline so it inherits
 * the app's line styling and the reduced-motion contract (SVG is static; the
 * wrapper carries data-reduced-motion so CSS can suppress any entrance anim).
 *
 * ABSENT DATA → EMPTY DocumentFragment (nothing renders, no VoiceOver noise) —
 * NOT an empty-state (an empty-state would imply an error / advertise an
 * unshipped feature). Same rule as match-stats.js / match-preview.js.
 *
 * key_events entry shape (from scrape_match_stats.py, ESPN keyEvents):
 *   { minute:Number, type:'goal'|'yellow'|'red'|'sub'|'shot'|'shotOnTarget',
 *     team:String /* canonical team name *\/, text:String }
 */
import { escapeHtml } from '../lib/escape.js';
import { sparklineSvg } from './sparkline.js';
import { resolveMatchStats } from './match-stats.js';

const MATCH_MINUTES = 90;      // regulation; extra-time events clamp to 90+
const BUCKETS = 15;            // ~6 minutes of play per column

const asMinute = (e) => {
  const m = Number(e && e.minute);
  if (!Number.isFinite(m) || m < 0) return null;
  return Math.min(m, MATCH_MINUTES + 30);
};

const isGoal = (e) => e && String(e.type).toLowerCase() === 'goal';
const isShot = (e) => {
  const t = String((e && e.type) || '').toLowerCase();
  return t === 'shot' || t === 'shotontarget' || t === 'goal';
};

/**
 * Build the per-bucket pressure series (team_a minus team_b shot events) and the
 * list of goal markers. Exported for unit testing without a DOM.
 * @param {Array} events key_events
 * @param {string} teamA canonical name of the panel's team_a
 * @returns {{ series:number[], goals:Array<{minute:number, side:'a'|'b'|null, pct:number}> }}
 */
export function buildMomentum(events, teamA) {
  const evs = Array.isArray(events) ? events : [];
  const series = new Array(BUCKETS).fill(0);
  const goals = [];
  const bucketOf = (m) => Math.max(0, Math.min(BUCKETS - 1, Math.floor((m / MATCH_MINUTES) * BUCKETS)));

  for (const e of evs) {
    const m = asMinute(e);
    if (m == null) continue;
    const sideA = teamA != null && e.team === teamA;
    if (isShot(e)) {
      series[bucketOf(m)] += sideA ? 1 : -1;
    }
    if (isGoal(e)) {
      goals.push({
        minute: m,
        side: e.team == null ? null : (sideA ? 'a' : 'b'),
        pct: Math.max(0, Math.min(100, (m / MATCH_MINUTES) * 100)),
      });
    }
  }
  return { series, goals };
}

/** True when there is at least one usable timeline event. */
function hasTimeline(events) {
  return Array.isArray(events) && events.some((e) => asMinute(e) != null && (isShot(e) || isGoal(e)));
}

/**
 * Render the momentum strip.
 * @param {{team_a:string, team_b:string}} match
 * @param {object} data  reads data.matchStats[match_id].key_events
 * @returns {HTMLElement|DocumentFragment} a .home-card strip, or an empty
 *   DocumentFragment when there are no usable key_events for this fixture.
 */
export function renderMomentum(match, data) {
  const s = resolveMatchStats(match, data);
  const events = s ? s.key_events : null;
  if (!hasTimeline(events)) return document.createDocumentFragment();

  const teamA = s.team_a;
  const { series, goals } = buildMomentum(events, teamA);

  const card = document.createElement('div');
  card.className = 'home-card momentum-card';
  card.setAttribute('data-testid', 'momentum');
  // Reduced-motion hook: the SVG is static, but flag the wrapper so CSS can
  // disable any entrance transition when prefers-reduced-motion is set.
  const reduced = (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  card.setAttribute('data-reduced-motion', reduced ? 'true' : 'false');

  const h = document.createElement('h2');
  h.className = 'mm-title';
  h.textContent = 'Momentum';
  card.appendChild(h);

  const strip = document.createElement('div');
  strip.className = 'mm-strip';
  strip.setAttribute('role', 'img');
  strip.setAttribute(
    'aria-label',
    `Momentum: shot pressure by minute for ${escapeHtml(s.team_a)} versus ${escapeHtml(s.team_b)}, ${goals.length} goal${goals.length === 1 ? '' : 's'} marked`,
  );

  // Shot-pressure sparkline (reuses the shared component).
  const spark = sparklineSvg(series, { width: 260, height: 28, className: 'sparkline mm-spark' });
  strip.appendChild(spark);

  // Goal markers pinned by minute along the strip.
  if (goals.length) {
    const markers = document.createElement('div');
    markers.className = 'mm-goals';
    for (const g of goals) {
      const dot = document.createElement('span');
      dot.className = `mm-goal mm-goal-${g.side || 'x'}`;
      dot.setAttribute('data-testid', 'mm-goal');
      dot.style.left = `${g.pct.toFixed(1)}%`;
      dot.setAttribute('title', `${g.minute}' goal`);
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '⚽';
      markers.appendChild(dot);
    }
    strip.appendChild(markers);
  }

  card.appendChild(strip);
  return card;
}
