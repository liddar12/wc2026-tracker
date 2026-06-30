/* match-card.mjs — RJ30.1 Item C-1.
   Server-rendered Open Graph / Twitter card for a SINGLE matchup link.

   WHY this exists: matchup links across the app are hash routes
   (`#/matchup/team_a/<A>/team_b/<B>`). The team identity lives in the URL
   *fragment*, which browsers never send to the server — so when a matchup link
   is pasted into iMessage / WhatsApp / Twitter / Slack / Discord, the crawler
   hits the bare SPA shell + generic index.html OG tags and produces no useful
   preview. This is exactly the bracket-card problem (see share-card.mjs),
   unsolved for matches. This closes it.

   This function serves `/m/<A>__vs__<B>` (a real path, see netlify.toml). It
   resolves the pair against committed, publicly-served JSON
   (group_matchups / knockout_matchups / schedule_full) — NO Supabase, NO new
   secret — emits per-match OG/Twitter meta (team names, kickoff, model pick /
   to-advance), then bounces real humans into the SPA at
   `#/matchup/team_a/<A>/team_b/<B>`. Crawlers read the meta and stop; they
   don't run the redirect.

   Mirrors the resolver precedence of app/views/matchup-detail.js#resolveMatch:
   group → knockout → schedule, both team orientations. Every fetch/parse is
   wrapped — on any failure the function still returns a 200 generic card and
   never throws (a broken preview is worse than a generic one). */

const SEP = '__vs__';

// Phase 1: reuse the existing static branded card. The title/description below
// stay fully dynamic. Flip MATCH_IMAGES_ENABLED + ship the prebuild loop to
// upgrade to a per-match image (Phase 2) without touching the meta logic.
const MATCH_IMAGES_ENABLED = false;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function origin_from(url) {
  return `${url.protocol}//${url.host}`;
}

// Map the model's stage token → a human round name. Mirrors
// app/views/matchup-detail.js#prettyStageName.
function prettyStageName(stage) {
  return {
    round_of_32: 'Round of 32',
    round_of_16: 'Round of 16',
    quarterfinals: 'Quarterfinal',
    semifinals: 'Semifinal',
    third_place: 'Third-place play-off',
    final: 'Final',
  }[stage] || 'Knockout stage';
}

// Split the `<A>__vs__<B>` pair defensively: split on the LAST separator so a
// (hypothetical) team name containing `__vs__` doesn't break the orientation.
// decodeURIComponent each side; tolerate a missing separator.
export function parsePair(raw) {
  const s = String(raw ?? '');
  const idx = s.lastIndexOf(SEP);
  let aRaw = s;
  let bRaw = '';
  if (idx >= 0) {
    aRaw = s.slice(0, idx);
    bRaw = s.slice(idx + SEP.length);
  }
  const dec = (v) => {
    try { return decodeURIComponent(v); } catch { return v; }
  };
  return { a: dec(aRaw).trim(), b: dec(bRaw).trim() };
}

// Pure, dependency-free kickoff formatter. Returns '' for missing/invalid input
// (so the description simply omits the kickoff clause — never "Invalid Date").
// e.g. "2026-06-19T01:00:00Z" → "Fri Jun 19, 01:00 UTC".
export function formatKickoff(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dow = days[d.getUTCDay()];
  const mon = months[d.getUTCMonth()];
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dow} ${mon} ${day}, ${hh}:${mm} UTC`;
}

async function fetchJson(origin, file) {
  try {
    const res = await fetch(`${origin}/data/${file}`);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Mirror resolveMatch precedence: group → knockout → schedule, both orientations.
// Returns { match, source } where source is 'group' | 'knockout' | 'schedule'
// | null. Never throws — callers fall through to the generic card on null.
export function resolveMatchServer(a, b, { groupMatchups, knockoutMatchups, scheduleFull }) {
  if (!a || !b) return { match: null, source: null };
  const pair = (m) =>
    (m.team_a === a && m.team_b === b) || (m.team_a === b && m.team_b === a);

  const groups = groupMatchups || {};
  for (const [g, info] of Object.entries(groups)) {
    for (const m of (info?.matches || [])) {
      if (pair(m)) return { match: { ...m, group: g }, source: 'group' };
    }
  }
  for (const m of (knockoutMatchups || [])) {
    if (pair(m)) return { match: { ...m }, source: 'knockout' };
  }
  for (const row of (scheduleFull || [])) {
    if (pair(row)) return { match: { ...row }, source: 'schedule' };
  }
  return { match: null, source: null };
}

// Build the dynamic title + description for the unfurl.
// - group (modeled): kickoff · Model: <winner> <conf>%.
// - knockout: <round> · <A> <adv_a>% to advance vs <B> <adv_b>%. kickoff.
// - placeholder / unknown: generic 2026 FIFA World Cup copy (never empty).
export function describeMatch({ a, b, match, source, scheduleFull }) {
  const teamA = a;
  const teamB = b;
  const title = `${teamA} vs ${teamB} — WC26 Tracker`;
  const pctTxt = (n) =>
    (typeof n === 'number' && Number.isFinite(n)) ? `${n.toFixed(0)}%` : null;

  // Kickoff: knockout/schedule rows carry kickoff_utc; group rows do not, so
  // look it up in schedule_full by match_id.
  let kickoffIso = match?.kickoff_utc || null;
  if (!kickoffIso && match?.match_id && Array.isArray(scheduleFull)) {
    const sm = scheduleFull.find((r) => r.match_id === match.match_id);
    kickoffIso = sm?.kickoff_utc || null;
  }
  const kickoff = formatKickoff(kickoffIso);

  if (match && source === 'knockout') {
    const round = prettyStageName(match.stage);
    const adA = pctTxt(match.advance_pct_a);
    const adB = pctTxt(match.advance_pct_b);
    let desc;
    if (adA && adB) {
      desc = `${round} · ${teamA} ${adA} to advance vs ${teamB} ${adB}.`;
    } else {
      desc = `${round} · ${teamA} vs ${teamB} · 2026 FIFA World Cup.`;
    }
    if (kickoff) desc += ` ${kickoff}.`;
    return { title, desc };
  }

  if (match && source === 'group') {
    const conf = pctTxt(match.win_confidence_pct);
    const winner = match.predicted_winner;
    let desc;
    if (winner && conf) {
      desc = `${kickoff ? `${kickoff} · ` : ''}Model: ${winner} ${conf}. See the full matchup breakdown.`;
    } else {
      desc = `${kickoff ? `${kickoff} · ` : ''}${teamA} vs ${teamB} · 2026 FIFA World Cup.`;
    }
    return { title, desc };
  }

  if (match && source === 'schedule') {
    const group = match.group ? `Group ${match.group}` : '2026 FIFA World Cup';
    const desc = `${kickoff ? `${kickoff} · ` : ''}${group} · ${teamA} vs ${teamB}.`;
    return { title, desc };
  }

  // Unknown pair / unresolved: generic but still names both sides.
  return {
    title,
    desc: `${teamA} vs ${teamB} · 2026 FIFA World Cup. See the full matchup breakdown on WC26 Tracker.`,
  };
}

function ogImageFor(origin, match) {
  if (MATCH_IMAGES_ENABLED && match?.match_id) {
    return `${origin}/assets/og/match/${encodeURIComponent(match.match_id)}.jpg`;
  }
  return `${origin}/assets/og/share-card.jpg`;
}

export default async (req) => {
  const url = new URL(req.url);
  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || origin_from(url);

  // netlify.toml rewrites /m/<pair> → this function with ?pair=<pair>. Fall back
  // to parsing the path in case it's hit directly.
  const rawPair =
    url.searchParams.get('pair') ||
    url.pathname.replace(/^\/m\//, '').replace(/\/+$/, '');
  const { a, b } = parsePair(rawPair);

  // Resolve against committed JSON — every fetch is best-effort.
  let resolved = { match: null, source: null };
  let scheduleFull = null;
  try {
    const [groupMatchups, knockoutMatchups, sched] = await Promise.all([
      fetchJson(origin, 'group_matchups.json'),
      fetchJson(origin, 'knockout_matchups.json'),
      fetchJson(origin, 'schedule_full.json'),
    ]);
    scheduleFull = Array.isArray(sched) ? sched : null;
    resolved = resolveMatchServer(a, b, {
      groupMatchups,
      knockoutMatchups,
      scheduleFull,
    });
  } catch {
    // fall through to the generic card
  }

  const { match, source } = resolved;
  const { title, desc } = describeMatch({ a, b, match, source, scheduleFull });
  const ogImage = ogImageFor(origin, match);

  // Human bounce target: the SPA hash route. encodeURIComponent each side so a
  // space/apostrophe round-trips to the same #/matchup/… the in-app links use.
  const appUrl =
    `${origin}/#/matchup/team_a/${encodeURIComponent(a)}/team_b/${encodeURIComponent(b)}`;
  const canonicalUrl = `${origin}/m/${encodeURIComponent(`${a}${SEP}${b}`)}`;
  const altText = `${a} vs ${b} — 2026 FIFA World Cup on WC26 Tracker`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="WC26 Tracker">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(altText)}">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="twitter:image:alt" content="${esc(altText)}">
<link rel="canonical" href="${esc(appUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body style="font-family:system-ui,sans-serif;background:#0D1117;color:#fff;padding:2rem">
<p>Opening this matchup… <a style="color:#E11D48" href="${esc(appUrl)}">tap here</a> if it doesn't redirect.</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short cache so previews refresh as the model updates; crawlers re-fetch.
      'cache-control': 'public, max-age=300',
    },
  });
};
