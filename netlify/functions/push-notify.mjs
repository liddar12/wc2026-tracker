/* push-notify.mjs — RJ30-3 (RJ30-B). Free scheduled Web Push sender.
 *
 * Runs every minute. DIRECT-ESPN goal detection (adopted decision): it reads
 * ESPN's public scoreboard directly (same source as app/live-scores.js) for
 * ~30s-fresh goals + statuses, instead of waiting on the throttled GitHub data
 * pipeline. It still reads the committed data files for the schedule (kickoffs)
 * and for richer goal metadata (player/minute) when present.
 *
 * Flow per run:
 *   1. Dormant no-op unless WC26_SUPABASE_URL + WC26_SUPABASE_SERVICE_KEY +
 *      WC26_VAPID_PRIVATE_KEY are set (same safety as score-brackets.mjs).
 *   2. Fetch ESPN board (direct) + committed schedule_full.json + match_events.json.
 *   3. Build an actual_results-shaped overlay from the live board (status+score).
 *   4. Pure diff (push-diff-core.mjs): new goals + imminent kickoffs vs the
 *      push_notify_state ledger.
 *   5. Resolve target subscriptions (teams overlap, honoring notify_goals /
 *      notify_kickoffs + quiet hours) and send VAPID Web Push.
 *   6. Prune 404/410 subscriptions; advance push_notify_state.
 *
 * SECRETS (Netlify env): WC26_SUPABASE_URL, WC26_SUPABASE_SERVICE_KEY,
 * WC26_VAPID_PUBLIC_KEY, WC26_VAPID_PRIVATE_KEY. The private key is read ONLY
 * here, never shipped to the client.
 */

import { createClient } from '../../vendor/supabase-js.js';
import {
  diffGoals, imminentKickoffs, targetTeamsForNotice, TIER_BY_STAGE,
} from './_lib/push-diff-core.mjs';
import { sendWebPush } from './_lib/web-push.mjs';

export const config = { schedule: '* * * * *' }; // every minute (goals need sub-minute latency)

const URL_BASE = (process.env.WC26_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.WC26_SUPABASE_SERVICE_KEY || '').trim();
const VAPID_PUBLIC = (process.env.WC26_VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE = (process.env.WC26_VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.WC26_VAPID_SUBJECT || 'mailto:liddar@gmail.com').trim();
const KICKOFF_LEAD_MIN = Number(process.env.WC26_KICKOFF_LEAD_MIN || 15);

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// ESPN display names → canonical teams.json keys (mirror of live-scores.js RENAMES).
const RENAMES = {
  'United States': 'USA', 'South Korea': 'Korea Republic', 'Türkiye': 'Turkiye',
  'Turkey': 'Turkiye', 'Czech Republic': 'Czechia', 'Cape Verde': 'Cabo Verde',
  'Ivory Coast': "Cote d'Ivoire", 'IR Iran': 'Iran', 'Congo DR': 'DR Congo',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Curaçao': 'Curacao',
};
const norm = (n) => {
  const t = (n || '').trim();
  return RENAMES[t] || RENAMES[t.replace(/-/g, ' ')] || t;
};

async function fetchJson(siteBase, path) {
  try {
    const res = await fetch(`${siteBase}${path}`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function etDate(d = new Date()) {
  const et = new Date(d.getTime() - 4 * 3600 * 1000);
  return et.toISOString().slice(0, 10).replace(/-/g, '');
}

/** ESPN scoreboard JSON → [{ teams:{name:score}, status }]. */
function parseScoreboard(data) {
  const out = [];
  for (const ev of data?.events || []) {
    const comp = (ev.competitions || [])[0] || {};
    const st = comp.status?.type || ev.status?.type || {};
    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;
    const teams = {};
    for (const c of competitors) {
      const name = norm(c.team?.displayName || c.team?.name);
      if (!name) continue;
      const score = Number(c.score);
      teams[name] = Number.isFinite(score) ? score : 0;
    }
    if (Object.keys(teams).length !== 2) continue;
    out.push({ teams, status: st.name || '' });
  }
  return out;
}

async function fetchEspnBoard() {
  try {
    const res = await fetch(`${SCOREBOARD}?dates=${etDate()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return parseScoreboard(await res.json());
  } catch {
    return [];
  }
}

/** Build an actual_results-shaped overlay + a synthetic events map from the
 *  live ESPN board, keyed to the schedule's match_ids. The events map carries
 *  one synthetic 'goal' per scored goal so the pure core's seq de-dup applies;
 *  committed match_events.json (if present) supplies real player/minute. */
function buildOverlay(board, schedule, committedEvents) {
  const results = {};
  const events = {};
  if (!Array.isArray(schedule)) return { results, events };

  for (const row of schedule) {
    const a = row.team_a, b = row.team_b;
    if (!a || !b) continue;
    const hit = board.find((x) => x.teams[a] != null && x.teams[b] != null);
    if (!hit) continue;
    const tierKey = TIER_BY_STAGE[row.stage] || 'group_stage';
    const tier = (results[tierKey] = results[tierKey] || {});
    tier[`${a}__vs__${b}`] = {
      score_a: hit.teams[a], score_b: hit.teams[b],
      status: hit.status, kickoff_utc: row.kickoff_utc,
    };

    const total = (Number(hit.teams[a]) || 0) + (Number(hit.teams[b]) || 0);
    if (total > 0) {
      // Prefer committed real goal events for player/minute; otherwise synthesize.
      const committed = committedEvents?.[row.match_id]?.events;
      const realGoals = Array.isArray(committed)
        ? committed.filter((e) => e && e.type === 'goal')
        : [];
      const goals = [];
      for (let i = 0; i < total; i++) {
        goals.push(realGoals[i] || { type: 'goal', player: '', minute: '' });
      }
      events[row.match_id] = { events: goals };
    }
  }
  return { results, events };
}

/** Quiet-hours check: true => suppress (only applied to goals). */
function inQuietHours(sub, nowMs) {
  const qs = sub.quiet_start, qe = sub.quiet_end;
  if (qs == null || qe == null) return false;
  const off = Number(sub.tz_offset) || 0; // minutes east of UTC
  const localHour = (new Date(nowMs + off * 60000)).getUTCHours();
  if (qs === qe) return false;
  if (qs < qe) return localHour >= qs && localHour < qe;
  // wraps midnight
  return localHour >= qs || localHour < qe;
}

function dormantResponse(msg) {
  console.log(`[push-notify] ${msg}`);
  return new Response(JSON.stringify({ ok: false, dormant: true, msg }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

export default async (req, context) => {
  if (!URL_BASE || !SERVICE_KEY || !VAPID_PRIVATE) {
    return dormantResponse('dormant: set WC26_SUPABASE_SERVICE_KEY + WC26_VAPID_PRIVATE_KEY to activate.');
  }

  const siteBase = process.env.URL || process.env.DEPLOY_PRIME_URL ||
    (req?.url ? new URL(req.url).origin : 'https://worldcup2026.j5lagenticstrategy.com');
  const now = Date.now();

  const [board, schedule, committedEvents] = await Promise.all([
    fetchEspnBoard(),
    fetchJson(siteBase, '/data/schedule_full.json'),
    fetchJson(siteBase, '/data/match_events.json'),
  ]);
  if (!Array.isArray(schedule)) {
    return dormantResponse('no schedule_full.json — nothing to evaluate.');
  }

  const { results, events } = buildOverlay(board, schedule, committedEvents);

  const sb = createClient(URL_BASE, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: stateRows } = await sb.from('push_notify_state').select('match_id,kind,seq');
  const state = stateRows || [];

  // PURE diff — no I/O.
  const goalNotices = diffGoals(events, results, schedule, state, now);
  const koNotices = imminentKickoffs(schedule, results, state, now, KICKOFF_LEAD_MIN);
  const notices = [...goalNotices, ...koNotices];

  const summary = { goals: goalNotices.length, kickoffs: koNotices.length, sent: 0, pruned: 0, errors: [] };
  if (notices.length === 0) {
    console.log('[push-notify]', JSON.stringify(summary));
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  // Load all subscriptions + their owners' favorite_team (fallback target).
  const { data: subs, error: subErr } = await sb.from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth,teams,notify_goals,notify_kickoffs,quiet_start,quiet_end,tz_offset');
  if (subErr) summary.errors.push(`read subs: ${subErr.message}`);
  const allSubs = subs || [];

  const userIds = [...new Set(allSubs.map((s) => s.user_id))];
  const favByUser = new Map();
  if (userIds.length) {
    const { data: profs } = await sb.from('profiles').select('user_id,favorite_team').in('user_id', userIds);
    for (const p of profs || []) favByUser.set(p.user_id, p.favorite_team || null);
  }

  // Which teams does a subscription follow? (teams snapshot, else profile fav.)
  const followedTeams = (sub) => {
    const t = Array.isArray(sub.teams) ? sub.teams.filter(Boolean) : [];
    if (t.length) return t;
    const fav = favByUser.get(sub.user_id);
    return fav ? [fav] : [];
  };

  // Endpoints to prune (collected, deleted once at the end).
  const pruneEndpoints = new Set();
  // Per-match next state to write (last notice for a match wins).
  const nextState = new Map(); // key `${match_id}|${kind}` -> seq

  for (const notice of notices) {
    const targets = targetTeamsForNotice(notice);
    const payload = JSON.stringify(buildPayload(notice));
    nextState.set(`${notice.match_id}|${notice.kind}`,
      notice.kind === 'goal' ? notice.nextSeq : 0);

    for (const sub of allSubs) {
      // Trigger pref gate.
      if (notice.kind === 'goal' && sub.notify_goals === false) continue;
      if (notice.kind === 'kickoff' && sub.notify_kickoffs === false) continue;
      // Team-targeting.
      const teams = followedTeams(sub);
      if (!teams.some((t) => targets.includes(t))) continue;
      // Quiet hours suppress goals only (kickoff is time-critical).
      if (notice.kind === 'goal' && inQuietHours(sub, now)) continue;

      try {
        const res = await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          { vapidPublic: VAPID_PUBLIC, vapidPrivate: VAPID_PRIVATE, subject: VAPID_SUBJECT },
        );
        if (res.status === 404 || res.status === 410) pruneEndpoints.add(sub.endpoint);
        else if (res.status >= 200 && res.status < 300) summary.sent++;
        else summary.errors.push(`send ${sub.endpoint.slice(0, 40)}: HTTP ${res.status}`);
      } catch (e) {
        summary.errors.push(`send err: ${e.message}`);
      }
    }
  }

  // Prune dead subscriptions.
  for (const ep of pruneEndpoints) {
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', ep);
    if (error) summary.errors.push(`prune: ${error.message}`);
    else summary.pruned++;
  }

  // Advance the de-dup ledger (so we never re-send the same goal/kickoff).
  for (const [key, seq] of nextState) {
    const [match_id, kind] = key.split('|');
    const { error } = await sb.from('push_notify_state')
      .upsert({ match_id, kind, seq, sent_at: new Date().toISOString() }, { onConflict: 'match_id,kind' });
    if (error) summary.errors.push(`state ${key}: ${error.message}`);
  }

  console.log('[push-notify]', JSON.stringify(summary));
  return new Response(JSON.stringify({ ok: summary.errors.length === 0, ...summary }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

/** Notification payload (< 4KB; title/body/url/tag only). */
function buildPayload(notice) {
  const [a, b] = notice.teams;
  const url = `/#/matchup/${encodeURIComponent(notice.match_id)}`;
  if (notice.kind === 'kickoff') {
    return {
      title: 'Kicks off soon',
      body: `${a} vs ${b} starts shortly.`,
      tag: notice.match_id,
      url,
      ts: Date.now(),
    };
  }
  // goal
  const who = notice.player ? `${notice.player} ` : '';
  const min = notice.minute ? ` ${notice.minute}` : '';
  const score = notice.score ? ` (${notice.score})` : '';
  return {
    title: 'GOAL!',
    body: `${a} vs ${b}${score} — ${who}scored${min}`.trim(),
    tag: notice.match_id,
    url,
    ts: Date.now(),
  };
}
