/* live-odds.js — near-real-time betting lines straight from the browser.
 *
 * The cron only refreshes Kalshi odds ~hourly, and Kalshi's API is CORS-blocked
 * for the browser. ESPN's per-match summary DOES carry live sportsbook lines
 * (DraftKings moneyline 3-way + Over/Under total) and ESPN is open-CORS (we
 * already poll it for scores). This pulls those lines for TODAY's matches,
 * de-vigs them to probabilities, and the Parlay of the Day blends them in — so
 * the parlay's market view moves in near-real-time, no new vendor, no key.
 */
const SB = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';
const RENAMES = {
  'United States': 'USA', 'South Korea': 'Korea Republic', 'Türkiye': 'Turkiye', 'Turkey': 'Turkiye',
  'Czech Republic': 'Czechia', 'Cape Verde': 'Cabo Verde', 'Ivory Coast': "Cote d'Ivoire",
  'IR Iran': 'Iran', 'Congo DR': 'DR Congo', 'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina', 'Curaçao': 'Curacao',
};
const norm = (n) => { const t = (n || '').trim(); return RENAMES[t] || RENAMES[t.replace(/-/g, ' ')] || t; };
const etDate = (d = new Date()) => new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);

// American odds → implied probability (with vig).
function implied(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

function parseSummaryOdds(summary) {
  const o = (summary.pickcenter || summary.odds || []).find((x) => x && (x.homeTeamOdds || x.moneyline));
  if (!o) return null;
  const comp = (summary.header?.competitions || [])[0] || {};
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  const homeName = norm(home?.team?.displayName);
  const awayName = norm(away?.team?.displayName);
  if (!homeName || !awayName) return null;

  // Moneyline 3-way → de-vigged probs
  let wdl = null;
  const ph = implied(o.homeTeamOdds?.moneyLine), pa = implied(o.awayTeamOdds?.moneyLine), pd = implied(o.drawOdds?.moneyLine);
  if (ph != null && pa != null && pd != null) {
    const s = ph + pd + pa;
    wdl = { home: homeName, away: awayName, hp: ph / s, dp: pd / s, ap: pa / s };
  }
  // Over/Under total
  let ou = null;
  const po = implied(o.overOdds), pu = implied(o.underOdds);
  if (typeof o.overUnder === 'number' && po != null && pu != null) {
    ou = { line: o.overUnder, over: po / (po + pu) };
  }
  if (!wdl && !ou) return null;
  return { homeName, awayName, wdl, ou, provider: (o.provider || {}).name || 'book' };
}

/** Returns { 'TeamA__vs__TeamB': { wdl:{a,d,b}, ou:{line,over}, provider }, __ts } */
export async function fetchLiveOdds() {
  const out = {};
  const today = etDate();
  const board = await (await fetch(`${SB}?dates=${today.replace(/-/g, '')}`, { cache: 'no-store' })).json();
  const events = (board?.events || []).filter((e) => e?.id);
  // limit to today's matches; one summary call each (bounded, run on the slow tick)
  for (const ev of events) {
    let s;
    try { s = await (await fetch(`${SUMMARY}?event=${ev.id}`, { cache: 'no-store' })).json(); } catch { continue; }
    const parsed = parseSummaryOdds(s);
    if (!parsed) continue;
    const key = `${parsed.homeName}__vs__${parsed.awayName}`;
    const rec = {};
    if (parsed.wdl) rec.wdl = { a: parsed.wdl.hp, d: parsed.wdl.dp, b: parsed.wdl.ap, home: parsed.homeName, away: parsed.awayName };
    if (parsed.ou) rec.ou = parsed.ou;
    rec.provider = parsed.provider;
    out[key] = rec;
  }
  out.__ts = new Date().toISOString();
  return out;
}
