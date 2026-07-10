/* live-momentum.js — R18: the live "Match Momentum" sampler + panel.
 *
 * For a LIVE match on the matchup page, samples ESPN's summary boxscore on a
 * fast tick (SAMPLE_MS = 10s, owner spec) and feeds app/lib/momentum.js —
 * per-minute MAX-extreme pressure, not averages. ESPN's stats refresh slower
 * than 10s; the tracker dedupes identical payloads so extremes stay honest.
 *
 * Each fresh sample also stashes the live SoT + red-card counts in a window
 * store (keyed by pair) that the win-probability widget reads on its own 30s
 * re-render — so the live prediction inherits the bounded shot-pressure tilt
 * without coupling the two components.
 *
 * Display-only: never touches actualResults, never advances a bracket. The
 * sampler stops itself at FINAL status, on teardown (container removed from
 * the DOM), or after LIVE_MAX_MS as a failsafe.
 */
import { escapeHtml } from './lib/escape.js';
import { renderMomentum } from './components/momentum-chart.js';

const SB = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';
const SAMPLE_MS = 10 * 1000;          // owner spec: 10-second ticks
const LIVE_MAX_MS = 4 * 3600 * 1000;  // failsafe stop
const FINAL_RE = /FINAL|FULL.?TIME/i;

// Mirrors live-scores.js RENAMES (keep in sync — same ESPN naming quirks).
const RENAMES = {
  'United States': 'USA', 'South Korea': 'Korea Republic', 'Türkiye': 'Turkiye', 'Turkey': 'Turkiye',
  'Czech Republic': 'Czechia', 'Cape Verde': 'Cabo Verde', 'Ivory Coast': "Cote d'Ivoire",
  'IR Iran': 'Iran', 'Congo DR': 'DR Congo', 'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina', 'Curaçao': 'Curacao',
};
const norm = (n) => { const t = (n || '').trim(); return RENAMES[t] || t; };

export function liveStatsStore() {
  if (typeof window === 'undefined') return {};
  return window.__wc26LiveStats || (window.__wc26LiveStats = {});
}

function statNum(stats, name) {
  const s = (stats || []).find((x) => x && x.name === name);
  const v = Number(s && s.displayValue);
  return Number.isFinite(v) ? v : null;
}

/** Parse one ESPN summary into a momentum snapshot oriented to (teamA, teamB).
 *  Exported for tests. Returns null when the boxscore isn't usable yet. */
export function snapshotFromSummary(summary, teamA, teamB) {
  const box = (summary && summary.boxscore) || {};
  const teams = box.teams || [];
  if (teams.length !== 2) return null;
  const byName = {};
  for (const t of teams) {
    byName[norm((t.team || {}).displayName)] = t.statistics || [];
  }
  const sa = byName[teamA], sb = byName[teamB];
  if (!sa || !sb) return null;

  const comp = ((summary.header || {}).competitions || [])[0] || {};
  const status = ((comp.status || {}).type || {}).name || '';
  const clock = (comp.status || {}).displayClock || '';
  const mm = /(\d+)/.exec(String(clock));
  const minute = mm ? Number(mm[1]) : null;

  let scoreA = null, scoreB = null, redA = 0, redB = 0;
  for (const c of comp.competitors || []) {
    const name = norm((c.team || {}).displayName);
    const sc = Number(c.score);
    if (name === teamA && Number.isFinite(sc)) scoreA = sc;
    if (name === teamB && Number.isFinite(sc)) scoreB = sc;
  }
  redA = statNum(sa, 'redCards') || 0;
  redB = statNum(sb, 'redCards') || 0;

  if (!Number.isFinite(minute)) return null;
  return {
    minute,
    shotsA: statNum(sa, 'totalShots') || 0, shotsB: statNum(sb, 'totalShots') || 0,
    sotA: statNum(sa, 'shotsOnTarget') || 0, sotB: statNum(sb, 'shotsOnTarget') || 0,
    possA: statNum(sa, 'possessionPct') ?? 50,
    scoreA, scoreB, redA, redB,
    final: FINAL_RE.test(status),
  };
}

/** Render the per-minute extremes bars into `host`. Exported for tests
 *  (accepts a plain series so no DOM fetch is needed). */
export function drawExtremes(host, series, teamA, teamB) {
  host.innerHTML = '';
  if (!series.length) {
    const wait = document.createElement('p');
    wait.className = 'muted mm-live-wait';
    wait.textContent = 'Sampling live pressure…';
    host.appendChild(wait);
    return;
  }
  const row = document.createElement('div');
  row.className = 'mm-live-bars';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label',
    `Live momentum: per-minute pressure extremes, ${escapeHtml(teamA)} up, ${escapeHtml(teamB)} down`);
  for (const { minute, value } of series) {
    const bar = document.createElement('span');
    bar.className = `mm-live-bar ${value >= 0 ? 'is-a' : 'is-b'}`;
    bar.style.height = `${Math.max(6, Math.abs(value) * 100)}%`;
    bar.title = `${minute}' ${value >= 0 ? teamA : teamB} ${(Math.abs(value) * 100).toFixed(0)}`;
    row.appendChild(bar);
  }
  host.appendChild(row);
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function resolveEventId(match) {
  // Try today and yesterday (UTC drift around late kickoffs).
  for (const off of [0, -1]) {
    const d = new Date(Date.now() + off * 86400 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const board = await fetchJson(`${SB}?dates=${d}`);
    for (const ev of (board || {}).events || []) {
      const comp = (ev.competitions || [])[0] || {};
      const names = (comp.competitors || []).map((c) => norm((c.team || {}).displayName));
      if (names.includes(match.team_a) && names.includes(match.team_b) && ev.id) return ev.id;
    }
  }
  return null;
}

function withinLiveWindow(match, scheduleFull) {
  const row = (scheduleFull || []).find((r) =>
    (r.team_a === match.team_a && r.team_b === match.team_b)
    || (r.team_a === match.team_b && r.team_b === match.team_a));
  const koff = Date.parse((row || match).kickoff_utc || '');
  if (!Number.isFinite(koff)) return false;
  const now = Date.now();
  return now >= koff - 10 * 60 * 1000 && now <= koff + LIVE_MAX_MS;
}

/**
 * The momentum section for a matchup: LIVE matches get the 10s extremes panel
 * (self-managing sampler); everything else falls through to the cron-fed strip.
 */
export function momentumSection(match, data) {
  if (!match || !withinLiveWindow(match, data && data.scheduleFull)) {
    return renderMomentum(match, data);
  }

  const card = document.createElement('div');
  card.className = 'home-card momentum-card mm-live';
  card.setAttribute('data-testid', 'momentum-live');
  card.innerHTML = `<h2 class="mm-title">Match Momentum <small class="live-indicator">LIVE</small></h2>
    <p class="muted mm-live-note">Per-minute pressure extremes (shots on target, shots, possession swing) — sampled every 10s, the peak of each minute kept.</p>`;
  const host = document.createElement('div');
  host.className = 'mm-live-host';
  card.appendChild(host);

  // Lazy import keeps momentum.js out of the critical path for non-live pages.
  let stopped = false;
  let timer = null;
  const stop = () => { stopped = true; if (timer) clearInterval(timer); };

  (async () => {
    const { createTracker } = await import('./lib/momentum.js');
    const tracker = createTracker();
    const eventId = await resolveEventId(match);
    if (!eventId || stopped) { drawExtremes(host, [], match.team_a, match.team_b); return; }
    const key = `${match.team_a}__vs__${match.team_b}`;
    const startedAt = Date.now();

    const tick = async () => {
      if (stopped || !document.body.contains(card)) return stop();
      if (Date.now() - startedAt > LIVE_MAX_MS) return stop();
      const summary = await fetchJson(`${SUMMARY}?event=${eventId}`);
      const snap = summary && snapshotFromSummary(summary, match.team_a, match.team_b);
      if (!snap) return;
      liveStatsStore()[key] = {
        sotA: snap.sotA, sotB: snap.sotB, redA: snap.redA, redB: snap.redB,
        updated: Date.now(),
      };
      if (tracker.addSample(snap)) drawExtremes(host, tracker.series(), match.team_a, match.team_b);
      if (snap.final) stop();
    };
    await tick();
    if (!stopped) timer = setInterval(tick, SAMPLE_MS);
  })();

  return card;
}
