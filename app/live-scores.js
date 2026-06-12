/* live-scores.js — TRUE near-real-time scores + game clock, straight from the
   browser. Eliminates the pipeline latency for DISPLAY: the git/cron pipeline
   (ESPN → Actions → commit → Netlify deploy) takes 15-25 min end-to-end, which
   is why "live" scores looked broken on opening day. This module fetches
   ESPN's public scoreboard DIRECTLY from the client (the CSP already allows
   site.api.espn.com) every poll tick during live windows and merges the
   scores/clock into the in-memory actualResults — so tiles show 0-0 + LIVE
   within seconds of kickoff and goals appear within ~30s.

   SAFETY: merged records carry their ESPN status, and every scoring/standings/
   advancement path is status-gated (only FINAL counts), so in-progress merges
   can never corrupt pool points or bracket logic. The deployed JSON (the
   pipeline) remains the durable source of truth — the client merge is a
   display-freshness overlay that the next full refresh naturally agrees with. */

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// ESPN display names → canonical teams.json keys (kept in sync with the
// Python scrapers' TEAM_RENAMES).
const RENAMES = {
  'United States': 'USA', 'South Korea': 'Korea Republic', 'Türkiye': 'Turkiye',
  'Turkey': 'Turkiye', 'Czech Republic': 'Czechia', 'Cape Verde': 'Cabo Verde',
  'Ivory Coast': "Cote d'Ivoire", 'IR Iran': 'Iran', 'Congo DR': 'DR Congo',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  // ESPN's scoreboard uses the HYPHENATED form (verified live June 12) —
  // without it the Canada–Bosnia game could never be matched.
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Curaçao': 'Curacao',
};
const norm = (n) => {
  const t = (n || '').trim();
  // exact rename → hyphen variant ("X-Y" ≈ "X and Y") → as-is
  return RENAMES[t] || RENAMES[t.replace(/-/g, ' ')] || t;
};

const TIER_BY_STAGE = {
  group: 'group_stage', group_stage: 'group_stage',
  round_of_32: 'round_of_32', round_of_16: 'round_of_16',
  quarterfinals: 'quarterfinals', semifinals: 'semifinals',
  third_place: 'third_place', final: 'final',
};

// ESPN groups scoreboard days by US/Eastern dates.
function etDate(d = new Date()) {
  const et = new Date(d.getTime() - 4 * 3600 * 1000); // EDT during the tournament
  return et.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Fetch today's live board → { 'A__vs__B' (canonical, unordered match):
 *  { teams:{name:score}, status, minute } } */
export async function fetchEspnLive() {
  const res = await fetch(`${SCOREBOARD}?dates=${etDate()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  const data = await res.json();
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
    // displayClock arrives WITH the apostrophe ("26'") — strip it; the card's
    // live eyebrow appends its own (avoids rendering LIVE 26'').
    const rawClock = (st.state === 'in' && (comp.status?.displayClock || ev.status?.displayClock)) || '';
    out.push({
      teams,
      status: st.name || '',
      minute: String(rawClock).replace(/'+$/, ''),
    });
  }
  return out;
}

/** Merge the live board into data.actualResults IN PLACE (display overlay).
 *  Returns the number of records updated. */
export function mergeLiveScores(data, board) {
  if (!data?.scheduleFull || !Array.isArray(board) || !board.length) return 0;
  const actual = (data.actualResults = data.actualResults || {});
  let changed = 0;
  for (const row of data.scheduleFull) {
    const a = row.team_a, b = row.team_b;
    if (!a || !b) continue;
    const hit = board.find((x) => x.teams[a] != null && x.teams[b] != null);
    if (!hit) continue;
    // Don't regress: never overwrite a FINAL record with a non-final one.
    const tierKey = TIER_BY_STAGE[row.stage] || 'group_stage';
    const tier = (actual[tierKey] = actual[tierKey] || {});
    const key = `${a}__vs__${b}`;
    const prev = tier[key] || tier[`${b}__vs__${a}`];
    const prevFinal = prev?.status && ['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME'].includes(prev.status);
    const nextFinal = ['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME'].includes(hit.status);
    if (prevFinal && !nextFinal) continue;
    const rec = {
      score_a: hit.teams[a], score_b: hit.teams[b],
      kickoff_utc: row.kickoff_utc, status: hit.status,
    };
    if (hit.minute) rec.minute = hit.minute;
    const prevJson = JSON.stringify(tier[key] || null);
    tier[key] = { ...(tier[key] || {}), ...rec };
    if (JSON.stringify(tier[key]) !== prevJson) changed++;
  }
  return changed;
}
