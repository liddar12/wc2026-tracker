/* live-api/api/live.js — Vercel Edge Function: real-time live-score read path.
 *
 * Phase 1 of docs/REALTIME_ARCHITECTURE.md. Fetches ESPN's public scoreboard
 * (today + previous UTC-ET day, to catch late-night games), normalizes to the
 * SAME "board" shape the PWA's mergeLiveScores() already consumes, and serves
 * it edge-cached so every client gets <=15s-fresh scores with no Netlify
 * redeploy. Public read-only (only exposes already-public scores); CORS limited
 * to the production origin.
 *
 * Keep parseScoreboard() byte-for-byte in step with app/live-scores.js's
 * fetchEspnLive() normalization — they must agree so the client behaves
 * identically whether it reads ESPN directly (fallback) or this endpoint.
 */
export const config = { runtime: 'edge' };

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ALLOW_ORIGIN = 'https://worldcup2026.j5lagenticstrategy.com';

const RENAMES = {
  'United States': 'USA', 'South Korea': 'Korea Republic', 'Türkiye': 'Turkiye',
  'Turkey': 'Turkiye', 'Czech Republic': 'Czechia', 'Cape Verde': 'Cabo Verde',
  'Ivory Coast': "Cote d'Ivoire", 'IR Iran': 'Iran', 'Congo DR': 'DR Congo',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina', 'Curaçao': 'Curacao',
};
const norm = (n) => {
  const t = (n || '').trim();
  return RENAMES[t] || RENAMES[t.replace(/-/g, ' ')] || t;
};

function etDate(d = new Date()) {
  const et = new Date(d.getTime() - 4 * 3600 * 1000); // EDT during the tournament
  return et.toISOString().slice(0, 10).replace(/-/g, '');
}

/** PURE: ESPN scoreboard JSON -> [{ teams:{name:score}, status, minute }] */
export function parseScoreboard(data) {
  const out = [];
  for (const ev of data?.events || []) {
    const comp = (ev.competitions || [])[0] || {};
    const st = comp.status?.type || ev.status?.type || {};
    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;
    const teams = {};
    for (const c of competitors) {
      const name = norm(c.team?.displayName || c.team?.name);
      const score = Number(c.score);
      if (name) teams[name] = Number.isFinite(score) ? score : 0;
    }
    if (Object.keys(teams).length !== 2) continue;
    const rawClock = (st.state === 'in' && (comp.status?.displayClock || ev.status?.displayClock)) || '';
    out.push({ teams, status: st.name || '', minute: String(rawClock).replace(/'+$/, '') });
  }
  return out;
}

export default async function handler() {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': ALLOW_ORIGIN,
    'access-control-allow-methods': 'GET, OPTIONS',
    // one shared edge cache: ESPN sees ~6 req/min total, clients get <=10s fresh
    'cache-control': 'public, s-maxage=10, stale-while-revalidate=30',
  };
  try {
    const now = new Date();
    const days = [etDate(now), etDate(new Date(now.getTime() - 24 * 3600 * 1000))];
    const boards = await Promise.all(days.map(async (d) => {
      const res = await fetch(`${SCOREBOARD}?dates=${d}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`espn ${res.status}`);
      return parseScoreboard(await res.json());
    }));
    // Merge both days; first occurrence (today) wins per team-set.
    const seen = new Set();
    const board = [];
    for (const b of boards) {
      for (const entry of b) {
        const key = Object.keys(entry.teams).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        board.push(entry);
      }
    }
    return new Response(JSON.stringify({ board, generated_at: now.toISOString(), source: 'espn' }), { headers });
  } catch (e) {
    // 200 with empty board + short cache: the client falls back to direct ESPN,
    // so a transient ESPN blip never blanks scores.
    return new Response(
      JSON.stringify({ board: [], error: String(e), generated_at: new Date().toISOString() }),
      { headers: { ...headers, 'cache-control': 'public, s-maxage=5' } },
    );
  }
}
