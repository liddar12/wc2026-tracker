/* match-stats.js — RJ30.2 Match Intelligence (Wave-1 B).
 *
 * Pure render module. Given a match and the loaded data bundle, it builds a
 * .home-card panel of REAL ESPN boxscore stats for the fixture:
 *   - a two-sided POSSESSION bar (the two shares sum to ~100, tabular-nums,
 *     aria-labelled so VoiceOver reads "Team A 58 percent, Team B 42 percent");
 *   - a shots + on-target comparison and passing %;
 *   - 3-5 additional key stats per team (saves, tackles, fouls, offsides,
 *     crosses, blocked shots — whichever ESPN reported);
 *   - a "SHOTS vs MODEL xG" line placing ESPN real shots/on-target next to the
 *     app's MODEL xG from data.xg (clearly labeled "model xG", NOT event xG);
 *   - the free, computed insight lines from app/lib/match-insights.js.
 *
 * Data source: data.matchStats[match_id] — Wave-2's data-loader exposes it and
 * DEFAULTS TO {}. When there is no entry for this fixture the component returns
 * an EMPTY DocumentFragment (nothing renders, no VoiceOver noise) — NOT an
 * empty-state, which would imply an error / advertise an unshipped feature.
 *
 * No network, no state import, no router — display only, never throws. All
 * interpolated strings are escaped via escapeHtml; numeric widths are clamped.
 *
 * matchStats entry shape (produced by scripts/scrape_match_stats.py):
 *   {
 *     team_a, team_b,
 *     stats_a: { possession, totalShots, shotsOnTarget, passPct,
 *                accuratePasses, totalPasses, saves, tackles, fouls,
 *                offsides, crosses, blockedShots },
 *     stats_b: { ...same keys... },
 *     key_events: [ { minute, type, team, text } ]   // used by momentum-chart
 *   }
 * Every numeric field is optional — a missing field is simply omitted from the
 * key-stats grid; possession falls back to a 50/50 split when absent on a side.
 */
import { escapeHtml } from '../lib/escape.js';

/* app/lib/match-insights.js is Wave-1 A's deliverable (lands in the same wave).
 * We bind it with a guarded top-level-await import so this module never crashes
 * if A's file is momentarily absent during isolated builds/tests — it simply
 * degrades to no insight lines (same "absent → nothing" philosophy as the panel
 * itself). Once A ships, the real matchInsights() is bound at module load, so
 * insights are available synchronously on the very first render. */
let matchInsights = () => [];
try {
  ({ matchInsights } = await import('../lib/match-insights.js'));
} catch {
  matchInsights = () => [];
}

/** Resolve the matchStats entry for a fixture, tolerant of key orientation. */
export function resolveMatchStats(match, data) {
  const stats = (data && data.matchStats) || {};
  const fwd = `${match.team_a}__vs__${match.team_b}`;
  const rev = `${match.team_b}__vs__${match.team_a}`;
  const hit = stats[fwd] || stats[rev];
  if (!hit) return null;
  // If the entry is keyed in reverse orientation, swap the sides so stats_a is
  // always this match's team_a (keeps the bar/labels aligned with the header).
  if (!stats[fwd] && stats[rev] && hit.team_a === match.team_b) {
    return {
      team_a: match.team_a,
      team_b: match.team_b,
      stats_a: hit.stats_b || {},
      stats_b: hit.stats_a || {},
      key_events: hit.key_events || [],
    };
  }
  return {
    team_a: hit.team_a || match.team_a,
    team_b: hit.team_b || match.team_b,
    stats_a: hit.stats_a || {},
    stats_b: hit.stats_b || {},
    key_events: hit.key_events || [],
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampPct = (v) => Math.max(0, Math.min(100, v));

/** The two possession shares, normalized to sum to 100 (fallback 50/50). */
export function possessionSplit(sa, sb) {
  let a = num(sa && sa.possession);
  let b = num(sb && sb.possession);
  if (a == null && b == null) return { a: 50, b: 50, known: false };
  if (a == null) a = 100 - b;
  if (b == null) b = 100 - a;
  const total = a + b;
  if (total <= 0) return { a: 50, b: 50, known: false };
  const na = clampPct((a / total) * 100);
  return { a: Math.round(na), b: Math.round(100 - na), known: true };
}

/** Model xG row for the pair, tolerant of key orientation (mirrors xg.js). */
function modelXg(match, data) {
  const xg = (data && data.xg) || {};
  const fwd = xg[`${match.team_a}__vs__${match.team_b}`];
  const rev = xg[`${match.team_b}__vs__${match.team_a}`];
  if (fwd && typeof fwd.team_a_xg === 'number') {
    return { a: fwd.team_a_xg, b: fwd.team_b_xg };
  }
  if (rev && typeof rev.team_a_xg === 'number') {
    // rev is keyed B__vs__A → its team_a_xg belongs to our team_b.
    return { a: rev.team_b_xg, b: rev.team_a_xg };
  }
  return null;
}

/* Key-stat rows to show (in order) when both sides carry the field. Labels are
 * plain English; INTEGRATOR wires the i18n keys (see summary). */
const KEY_STATS = [
  { key: 'totalShots', label: 'Shots' },
  { key: 'shotsOnTarget', label: 'On target' },
  { key: 'passPct', label: 'Passing %', suffix: '%' },
  { key: 'saves', label: 'Saves' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'offsides', label: 'Offsides' },
  { key: 'crosses', label: 'Crosses' },
  { key: 'blockedShots', label: 'Blocked' },
];

function statRow(label, aVal, bVal, suffix) {
  const tr = document.createElement('div');
  tr.className = 'ms-stat-row';
  const fmt = (v) => (v == null ? '—' : `${v}${suffix || ''}`);
  tr.innerHTML = `
    <span class="ms-stat-a tnum">${escapeHtml(fmt(aVal))}</span>
    <span class="ms-stat-label">${escapeHtml(label)}</span>
    <span class="ms-stat-b tnum">${escapeHtml(fmt(bVal))}</span>
  `;
  return tr;
}

/**
 * Render the Match Stats panel.
 * @param {{team_a:string, team_b:string}} match
 * @param {object} data  the loaded data bundle (reads data.matchStats + data.xg)
 * @returns {HTMLElement|DocumentFragment} a .home-card panel, or an empty
 *   DocumentFragment when there is no stats entry for this fixture.
 */
export function renderMatchStats(match, data) {
  const s = resolveMatchStats(match, data);
  // Absent → nothing renders (empty fragment, NOT an empty-state).
  if (!s) return document.createDocumentFragment();

  const sa = s.stats_a || {};
  const sb = s.stats_b || {};
  const aName = escapeHtml(s.team_a);
  const bName = escapeHtml(s.team_b);

  const card = document.createElement('div');
  card.className = 'home-card match-stats-card';
  card.setAttribute('data-testid', 'match-stats');

  const h = document.createElement('h2');
  h.className = 'ms-title';
  h.textContent = 'Match stats';
  card.appendChild(h);

  // ---- POSSESSION (two-sided bar, sums ~100, aria) ----
  const poss = possessionSplit(sa, sb);
  const possWrap = document.createElement('div');
  possWrap.className = 'ms-possession';
  possWrap.setAttribute('data-testid', 'ms-possession');
  possWrap.innerHTML = `
    <div class="ms-poss-head">
      <span class="ms-poss-label">Possession</span>
    </div>
    <div class="ms-poss-vals">
      <span class="ms-poss-a tnum" data-testid="ms-poss-a">${poss.a}%</span>
      <span class="ms-poss-b tnum" data-testid="ms-poss-b">${poss.b}%</span>
    </div>
    <div class="ms-poss-bar" role="img"
         aria-label="Possession: ${aName} ${poss.a} percent, ${bName} ${poss.b} percent">
      <div class="ms-poss-seg ms-seg-a" style="width:${poss.a}%"></div>
      <div class="ms-poss-seg ms-seg-b" style="width:${poss.b}%"></div>
    </div>
  `;
  card.appendChild(possWrap);

  // ---- team name header for the stat columns ----
  const cols = document.createElement('div');
  cols.className = 'ms-cols';
  cols.innerHTML = `
    <span class="ms-col-a">${aName}</span>
    <span class="ms-col-mid" aria-hidden="true"></span>
    <span class="ms-col-b">${bName}</span>
  `;
  card.appendChild(cols);

  // ---- shots + on-target + passing + 3-5 key stats ----
  const grid = document.createElement('div');
  grid.className = 'ms-stat-grid';
  grid.setAttribute('data-testid', 'ms-stat-grid');
  let shown = 0;
  for (const def of KEY_STATS) {
    const av = num(sa[def.key]);
    const bv = num(sb[def.key]);
    if (av == null && bv == null) continue;
    grid.appendChild(statRow(def.label, av, bv, def.suffix));
    shown += 1;
    if (shown >= 7) break; // shots + on-target + passing + up to 4 more
  }
  card.appendChild(grid);

  // ---- SHOTS vs MODEL xG line ----
  const xg = modelXg(match, data);
  const shotsA = num(sa.totalShots);
  const shotsB = num(sb.totalShots);
  const sotA = num(sa.shotsOnTarget);
  const sotB = num(sb.shotsOnTarget);
  const xgLine = document.createElement('div');
  xgLine.className = 'ms-xg-line';
  xgLine.setAttribute('data-testid', 'ms-shots-xg');
  const shotStr = (sh, sot) => {
    if (sh == null && sot == null) return '—';
    const s1 = sh == null ? '—' : String(sh);
    const s2 = sot == null ? '' : ` (${sot} on tgt)`;
    return `${s1}${s2}`;
  };
  const xgStr = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
  xgLine.innerHTML = `
    <span class="ms-xg-label">Shots vs <strong>model xG</strong></span>
    <div class="ms-xg-row">
      <span class="ms-xg-a tnum">${escapeHtml(shotStr(shotsA, sotA))} · ${escapeHtml(xg ? xgStr(xg.a) : '—')} xG</span>
      <span class="ms-xg-b tnum">${escapeHtml(shotStr(shotsB, sotB))} · ${escapeHtml(xg ? xgStr(xg.b) : '—')} xG</span>
    </div>
  `;
  card.appendChild(xgLine);

  // ---- free computed insights (deterministic, $0, safe when stats missing) ----
  let lines = [];
  try {
    // Pass the full resolved row (incl. key_events for the clinical-finishing
    // read) + the model row (`match` carries predicted_winner/upset_risk for
    // knockout/group fixtures) so possession, clinical, model-agreement and the
    // xG read can all fire.
    lines = matchInsights({ team_a: s.team_a, team_b: s.team_b, stats_a: sa, stats_b: sb, key_events: s.key_events }, { xg, model: match }) || [];
  } catch { lines = []; }
  if (Array.isArray(lines) && lines.length) {
    const ins = document.createElement('ul');
    ins.className = 'ms-insights';
    ins.setAttribute('data-testid', 'ms-insights');
    ins.innerHTML = lines
      .slice(0, 3)
      .map((l) => `<li class="ms-insight">${escapeHtml(typeof l === 'string' ? l : (l && l.text) || '')}</li>`)
      .join('');
    card.appendChild(ins);
  }

  return card;
}
