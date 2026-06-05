/* share-card.mjs — R15b (#8) DRAFT.
   Server-rendered Open Graph / Twitter card for shared brackets.

   WHY this exists: share links used to be `…/#/shared/token/<t>`. The token is
   in the URL *fragment*, which browsers never send to the server — so when a
   link was pasted into iMessage / WhatsApp / Twitter / Slack, the crawler hit
   the bare SPA shell and produced no preview (or a generic one).

   This function serves `/s/<token>` (a real path, see netlify.toml). It looks
   up the snapshot via the public get_shared_bracket RPC, emits proper OG/Twitter
   meta tags, then bounces real humans into the SPA at `#/shared/token/<token>`
   (which already knows how to render a shared bracket). Crawlers read the meta
   and stop; they don't run the redirect.

   No new secret: uses the same anon URL/key the static build already injects. */

const SUPABASE_URL = (process.env.WC26_SUPABASE_URL || '').trim();
const SUPABASE_ANON = (process.env.WC26_SUPABASE_ANON_KEY || '').trim();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchSnapshot(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_bracket`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        authorization: `Bearer ${SUPABASE_ANON}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.payload || data || null;
  } catch {
    return null;
  }
}

function describe(payload) {
  const meta = payload?.meta || {};
  const picks = payload?.picks || {};
  const label = meta.label || 'WC26 Bracket';
  const pickCount = meta.pick_count ?? Object.keys(picks).length;
  // The champion is the pick on the final (match 104) when present.
  const champ = picks?.['104']?.team || picks?.['104']?.choice || null;
  const desc = champ
    ? `${pickCount} picks · ${champ} to lift the trophy. Build yours for the 2026 FIFA World Cup.`
    : `${pickCount} picks for the 2026 FIFA World Cup. Build your own bracket and compare.`;
  return { title: `${label} — WC26 Tracker`, desc };
}

export default async (req) => {
  const url = new URL(req.url);
  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || origin_from(url);
  // netlify.toml rewrites /s/<token> → this function with ?token=<token>.
  // Fall back to parsing the path in case it's hit directly.
  const token = (
    url.searchParams.get('token') ||
    url.pathname.replace(/^\/s\//, '').replace(/\/+$/, '')
  );
  const appUrl = `${origin}/#/shared/token/${encodeURIComponent(token)}`;
  const ogImage = `${origin}/icons/icon-512.png`; // TODO: branded 1200×630 card

  const payload = token ? await fetchSnapshot(token) : null;
  const { title, desc } = payload
    ? describe(payload)
    : { title: 'WC26 Bracket', desc: 'A shared 2026 FIFA World Cup bracket on WC26 Tracker.' };

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
<meta property="og:url" content="${esc(`${origin}/s/${token}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="canonical" href="${esc(appUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body style="font-family:system-ui,sans-serif;background:#0D1117;color:#fff;padding:2rem">
<p>Opening this bracket… <a style="color:#E11D48" href="${esc(appUrl)}">tap here</a> if it doesn't redirect.</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short cache so previews update if a snapshot is re-shared; crawlers re-fetch.
      'cache-control': 'public, max-age=300',
    },
  });
};

function origin_from(url) {
  return `${url.protocol}//${url.host}`;
}
