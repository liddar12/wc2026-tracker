# RJ30-B — Goal + Kickoff Web Push Notifications (RJ30-3)

**Owner-approved scope:** new Supabase table + RLS (PLANNED, not applied) and a free Netlify
function sender. iOS Web Push works **only** for installed PWAs (iOS 16.4+, Add to Home Screen),
so the entire feature is install-gated with graceful fallback to in-app toasts for everyone else.

**Zero additional cost:** VAPID Web Push is free (no provider, no APNs key). The sender is a
Netlify scheduled function (already on the plan, same as `score-brackets.mjs` / `results-health.mjs`).
Goal/kickoff state comes from the **existing** committed data files (`data/match_events.json`,
`data/actual_results.json`, `data/schedule_full.json`) and Supabase. No new external API.

---

## 0. Grounding — how the code actually works (cited)

- **Service worker** `sw.js` is a *pure cache-purger*: it `skipWaiting()`s, deletes every `wc26-*`
  cache on `activate`, and has **no** `fetch`, `push`, or `notificationclick` handler
  (`sw.js:16-42`). The header comment says re-adding behaviour here later is intended/reversible.
  We add `push` + `notificationclick` + `pushsubscriptionchange` listeners only — **no fetch handler**
  (keeping the no-offline contract from `CLAUDE.md`).
- **SW registration** is in `index.html:102-106` (`navigator.serviceWorker.register('sw.js')` on
  `load`). Unchanged.
- **Install detection / iOS gate** already exists in `app/install-prompt.js`: standalone check via
  `matchMedia('(display-mode: standalone)')` + `navigator.standalone` (lines 11-13), iOS-Safari UA
  sniff (lines 17-20), dismissal TTL in `localStorage` (`wc26.installPrompt.dismissed`, 14 days).
  We **reuse these exact predicates** (extract to a tiny shared helper) so the push UI and the
  install banner agree on "is this an installed iOS PWA".
- **Supabase client**: created in `app/competition.js:90` from `getConfig()`
  (`window.__WC26_CONFIG__`, lines 106-110), exposed via `getCompetitionState().client` /
  `.user`. `app/favorites.js` is the canonical example of an authed table write/read
  (`favorites.js:29-72` — `state.client.from('profiles').update(...).eq('user_id', state.user.id)`).
  Push subscriptions follow the **same pattern**.
- **Favorites** are the team-targeting source: `getFavoriteTeam()` (`favorites.js:8`) →
  `localStorage 'wc26.favoriteTeam'`, synced to `profiles.favorite_team` on Supabase
  (`favorites.js:35-38`), and a `favorite:change` CustomEvent fires on change (`favorites.js:25`).
- **Goal detection source**: `data/match_events.json` is `{ "<match_id>": { events:[{minute,type,player,team}], updated_at }, "__meta__":{updated_at,source} }`
  with `type:"goal"` rows (verified: Mexico vs South Africa has two `type:"goal"` events).
  `data/actual_results.json` is `{ <tier>: { "<A__vs__B>": {score_a,score_b,status,kickoff_utc,minute?} }, last_updated }`.
  Both are committed to `main` by GitHub Actions crons (the scrapers `scrape_match_events.py` /
  `scrape_live_results.py`). The client live overlay (`app/live-scores.js mergeLiveScores`,
  `live-poller.js`) is a **display** overlay and is NOT a server source — the sender must read the
  committed JSON off the deployed site, exactly like `score-brackets.mjs:48-51` and
  `results-health.mjs:34-37` do (`fetchJson(siteBase, '/data/...')`).
- **Kickoffs**: `data/schedule_full.json` is a list of `{match_id, stage, team_a, team_b, kickoff_utc, group, ...}`.
  `kickoff_utc` is the only kickoff source (per `CLAUDE.md`).
- **Netlify function conventions** (`netlify.toml:5-7`): `directory = netlify/functions`,
  `node_bundler = esbuild`. Scheduled fns use `export const config = { schedule: '@hourly' }`
  (`results-health.mjs:13-17`, `score-brackets.mjs:22`). Service-role secret pattern + **dormant
  when unset** is established in `score-brackets.mjs:24-42` (reads
  `WC26_SUPABASE_URL` / `WC26_SUPABASE_SERVICE_KEY`, no-ops if missing). Supabase client is the
  **vendored** `../../vendor/supabase-js.js` (`score-brackets.mjs:18`), NOT esm.sh.
- **RLS / migration convention**: SQL files in `supabase/migrations/`, header `-- DRAFT — review,
  then apply to prod (vodjwymxquuertmhtvuw) via SQL editor.` (`20260611120000_protect_score_columns.sql:1`).
  Service-role detection inside triggers via `request.jwt.claims ->> 'role' = 'service_role'`
  (same file, lines 28-42). We follow this verbatim.
- **Settings surface**: `app/views/settings-view.js` mounts stacked `<section class="home-card">`
  cards (favorite, theme, motion, account, model, reset). The push opt-in card slots in here,
  reusing `home-card` / `settings-toggle` / `pick-btn` classes (lines 50-187). Route `/#/settings`,
  gear icon wired in `app/main.js:332`.
- **Tests**: logic = `node --test` under `tests/feature/*.mjs` (node:test + node:assert/strict,
  e.g. `match-status.test.mjs`); UX = Playwright `tests/ux/*.spec.mjs` at 390x844 (`playwright.config.mjs`).
  Gate: `validate_data.py` → `tests/smoke.sh` → `node --test ...` → `playwright`.

---

## ARCHITECTURE OVERVIEW (free, zero-cost)

```
 [Settings push card] --subscribe--> PushManager.subscribe(VAPID_PUBLIC)
        |                                     |
        |  (iOS-install-gated UI)             v
        |                          push_subscriptions (Supabase, RLS: own rows)
        |                          + per-team prefs (favorite_team drives target)
        v
 sw.js push/notificationclick handlers  <----- Web Push (VAPID, free)
        ^                                            |
        |                                            |
 [Netlify scheduled fn: push-notify.mjs] -----------+
    reads /data/match_events.json (goals) + /data/actual_results.json (scores)
       + /data/schedule_full.json (kickoffs)
    diffs vs last-sent state in push_notify_state (Supabase, service-role)
    fans out web-push to matching subscriptions, prunes 404/410
```

Two notification triggers, both keyed off a user's **favorite team**:
1. **GOAL** — a new `type:"goal"` event (or a score increment) appears for a match involving the
   favorite, while the match status is LIVE (not a stale re-scrape).
2. **KICKOFF** — a favorited team's match `kickoff_utc` is within the imminent window
   (default T-15min) and hasn't been sent yet.

---

## ITEM RJ30-3a — Supabase schema + RLS (PLANNED ONLY; do not apply)

### User story
> As the product owner, I want a `push_subscriptions` table with strict RLS and a service-role-only
> send-state table, so that subscriptions are private to each user and the Netlify sender can fan
> out pushes without exposing keys to clients.

### Acceptance criteria (Given/When/Then)
- **Given** a signed-in user, **When** they subscribe, **Then** a row is inserted in
  `push_subscriptions` with their `user_id`, the `endpoint`, `p256dh`, `auth` keys, and prefs; and
  **only that user** can `select/insert/update/delete` it (RLS `auth.uid() = user_id`).
- **Given** any authenticated user, **When** they try to read another user's subscription, **Then**
  RLS returns zero rows.
- **Given** the Netlify sender (service role), **When** it reads all subscriptions to fan out,
  **Then** it bypasses RLS (service key) — same trust model as `score-brackets.mjs`.
- **Given** an endpoint that returns 404/410 (expired), **When** the sender hits it, **Then** it
  deletes that row (service role).
- **Given** the migration file, **When** reviewed, **Then** it carries the DRAFT header and is NOT
  auto-applied (matches `20260611120000_protect_score_columns.sql` convention).

### Schema (new migration file — PLANNED, not applied)
`supabase/migrations/20260701010000_push_subscriptions.sql`:

```sql
-- DRAFT — review, then apply to prod (vodjwymxquuertmhtvuw) via SQL editor.
-- RJ30-3: Web Push subscriptions + per-team prefs, and a service-role-only
-- send-state ledger for goal/kickoff de-duplication.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  -- prefs: what to notify on. favorite_team is read from profiles at send time,
  -- but we snapshot it here so a guest-then-signin or multi-device case is sane.
  notify_goals     boolean not null default true,
  notify_kickoffs  boolean not null default true,
  -- comma-free JSON array of canonical team names; empty/null => use profiles.favorite_team
  teams       jsonb not null default '[]'::jsonb,
  quiet_start smallint,   -- local hour 0-23 (nullable = no quiet hours)
  quiet_end   smallint,
  tz_offset   smallint default 0,  -- minutes east of UTC, for quiet-hours math
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "own_subscriptions_select" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "own_subscriptions_insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "own_subscriptions_update" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_subscriptions_delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

-- Service-role-only de-dup ledger: which (match_id, kind, seq) we've already
-- pushed. No RLS policies for normal users => only the service key can touch it.
create table if not exists public.push_notify_state (
  match_id   text not null,
  kind       text not null,             -- 'goal' | 'kickoff'
  seq        integer not null default 0, -- goal count already sent (goals); 0 for kickoff
  sent_at    timestamptz not null default now(),
  primary key (match_id, kind)
);
alter table public.push_notify_state enable row level security;
-- intentionally NO policies: authenticated/anon get zero access; service_role bypasses RLS.
```

### Edge cases
- **Duplicate device subscribe**: `unique(user_id, endpoint)` → upsert on conflict (client uses
  `.upsert(..., { onConflict: 'user_id,endpoint' })`).
- **Account deletion**: `on delete cascade` from `auth.users`.
- **Guest user**: guests have no `user_id` → push is gated to signed-in users (see UI gate). Stored
  `teams` snapshot covers the favorite-on-multiple-devices case.

### Files
- **New:** `supabase/migrations/20260701010000_push_subscriptions.sql` (DRAFT, not applied).

---

## ITEM RJ30-3b — Service worker push handlers

### User story
> As an installed-PWA user, I want goal and kickoff pushes to appear as native notifications even
> when the app is closed, and tapping one to deep-link to the match, so that I never miss my team's
> moments.

### Acceptance criteria
- **Given** a `push` event with our JSON payload, **When** the SW receives it, **Then** it shows a
  notification with title/body/icon/tag and `data.url` (deep link).
- **Given** two goal pushes for the same match arrive, **When** they share a `tag` (the match_id),
  **Then** the OS collapses/replaces rather than stacking (renotify true so the user still sees it).
- **Given** the user taps the notification, **When** `notificationclick` fires, **Then** the SW
  focuses an existing app window (or opens one) at `data.url` (e.g. `/#/matchup/<match_id>`).
- **Given** a `pushsubscriptionchange` event (browser rotated the endpoint), **When** it fires,
  **Then** the SW re-subscribes with the stored VAPID key and posts the new subscription to clients
  (best-effort; if no client is open the next app launch re-syncs).
- **Given** the existing no-offline contract, **When** these handlers are added, **Then** NO `fetch`
  handler is added (verified by test).

### Tasks (exact code, `sw.js`)
Append to `sw.js` (keep `VERSION` bump in sync with `app/lib/version-purge.js` per the
`r14-version-sync` test — bump `wc26-v16` → `wc26-v17`):

```js
// RJ30-3: Web Push. Adds push + notificationclick + pushsubscriptionchange.
// NO fetch handler is added — the no-offline contract is preserved.
const VAPID_PUBLIC_KEY = ''; // injected by app at register time via message; see below

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'WC26', body: event.data?.text?.() || '' }; }
  const title = data.title || 'World Cup 2026';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-72.png',
    tag: data.tag || 'wc26',          // collapse per-match
    renotify: true,
    data: { url: data.url || '/' },
    timestamp: data.ts || Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate?.(url); } catch {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const key = (await caches.match('wc26-vapid'))?.text?.() || '';
      // re-subscribe is best-effort; the app re-syncs on next launch regardless.
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      });
      const all = await self.clients.matchAll({ includeUncontrolled: true });
      all.forEach((c) => c.postMessage({ type: 'PUSH_RESUBSCRIBED', subscription: sub.toJSON() }));
    } catch {}
  })());
});
```

### Edge cases / iOS quirks
- iOS requires `userVisibleOnly: true` AND every push to **show a notification** (silent pushes are
  banned on iOS — show one every time).
- `clients.navigate()` is not on all WebKit versions → wrapped in try/catch with `focus()` fallback;
  if no window, `openWindow(url)`.
- Badge icon must exist; we add `/icons/badge-72.png` (or reuse an existing monochrome icon — see
  Open Questions). If missing, iOS falls back to the app icon — non-fatal.

### Files
- **Modified:** `sw.js` (append handlers; bump `VERSION`).
- **Modified:** `app/lib/version-purge.js` (bump `APP_VERSION` to match — required by the
  `r14-version-sync` test).

---

## ITEM RJ30-3c — Client subscribe/permission module + Settings UI

### User story
> As a fan with the app installed on my iPhone, I want a clear opt-in for goal/kickoff alerts for my
> favorite team, with an honest message when my browser/device can't do push, so that I'm never
> confused about why I'm (not) getting alerts.

### Acceptance criteria
- **Given** an installed iOS PWA + signed-in user, **When** they open Settings, **Then** a
  "Match alerts" card shows an **Enable notifications** button.
- **Given** they tap Enable, **When** the OS permission prompt resolves `granted`, **Then** the app
  `PushManager.subscribe()`s with the VAPID public key and upserts the row into `push_subscriptions`;
  the card flips to show **per-trigger toggles** (Goals / Kickoffs) + quiet-hours + a Disable button.
- **Given** permission is `denied`, **When** the card renders, **Then** it shows guidance to enable
  in iOS Settings (no infinite re-prompt — browsers block repeat prompts anyway).
- **Given** the device is **NOT an installed iOS PWA** (Safari tab, or unsupported), **When** the
  card renders, **Then** it shows "Add to Home Screen to get match alerts" with the same share-sheet
  hint as `install-prompt.js`, and the Enable button is hidden/disabled (graceful fallback to the
  existing in-app live toasts).
- **Given** a guest (not signed in), **When** the card renders, **Then** it shows "Sign in to enable
  alerts" wired to `openAuth('signin')` (same pattern as `settings-view.js:184`).
- **Given** no favorite team is set, **When** they enable, **Then** the card warns "Pick a favorite
  team to choose who you get alerts for" and links to the favorite picker (still subscribes; sender
  no-ops with no team).
- **Given** `Notification`/`PushManager`/`serviceWorker` are absent, **When** the module loads,
  **Then** `isPushSupported()` returns false and the card degrades — no thrown errors.

### Tasks
**New `app/lib/pwa-install.js`** — extract the standalone+iOS predicates from `install-prompt.js`
(do not duplicate the UA logic in two places):
```js
export function isStandalonePWA() {
  if (typeof window === 'undefined') return false;
  return (window.matchMedia?.('(display-mode: standalone)').matches) || !!window.navigator?.standalone;
}
export function isIOSSafari() { /* exact UA logic moved from install-prompt.js:17-20 */ }
export function isInstalledIOSPWA() { return isIOSSafari() && isStandalonePWA(); }
```
Then `install-prompt.js` imports these (no behaviour change; covered by existing fav-team layout
tests + a new unit test).

**New `app/push.js`** — the subscribe lifecycle:
```js
import { getCompetitionState } from './competition.js';
import { isStandalonePWA, isIOSSafari } from './lib/pwa-install.js';

export const VAPID_PUBLIC_KEY = (window.__WC26_CONFIG__?.vapidPublicKey) || '';

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}
// iOS-gate: on iOS, push ONLY works installed. Other platforms: supported if APIs exist.
export function canSubscribeHere() {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return false;
  if (isIOSSafari() && !isStandalonePWA()) return false;
  return true;
}
export function permissionState() { return (typeof Notification !== 'undefined') ? Notification.permission : 'denied'; }

export async function enablePush() {
  if (!canSubscribeHere()) throw new Error('Push not available here');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission-' + perm);
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await saveSubscription(sub);   // upsert into push_subscriptions
  return sub;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await deleteSubscription(sub.endpoint); await sub.unsubscribe(); }
}
// saveSubscription/deleteSubscription/getStatus use getCompetitionState().client like favorites.js
```
- `urlBase64ToUint8Array` is the standard VAPID key decoder (pure function — unit-tested).
- `saveSubscription`: `state.client.from('push_subscriptions').upsert({ user_id, endpoint, p256dh, auth, user_agent, teams:[favorite] }, { onConflict: 'user_id,endpoint' })` — mirrors
  `favorites.js:35-38`. Fire-and-forget tolerant.
- Listen for `PUSH_RESUBSCRIBED` SW messages → re-save (handles `pushsubscriptionchange`).
- VAPID **public** key injected into `window.__WC26_CONFIG__.vapidPublicKey` by
  `scripts/write-runtime-config.mjs` (extend it to also read `WC26_VAPID_PUBLIC_KEY` env — public is
  safe to ship to the client; private NEVER touches client).

**New `app/views/settings-push-card.js`** (or inline in settings-view) — `renderPushCard()` returns
a `<section class="home-card">` matching the existing cards. Wire into `settings-view.js`:
- `import { renderPushCard } from './settings-push-card.js';` and append after the favorite card
  (so "who" precedes "alerts"): `root.appendChild(renderPushCard(data));`

### Edge cases / iOS quirks
- **iOS demands a user gesture** for `Notification.requestPermission()` → only called from the
  Enable button click handler, never on load.
- **No `beforeinstallprompt` on iOS** → install path is manual (share → Add to Home Screen); we
  reuse the `install-prompt.js` copy.
- Subscribing twice returns the same endpoint (idempotent upsert).
- Permission `default` after a dismissed prompt: button stays "Enable"; re-tap re-prompts (allowed).
- `denied`: show recovery copy ("Notifications are off for this app. Enable in iOS Settings →
  Notifications → World Cup 2026"). No auto-reprompt.

### Files
- **New:** `app/push.js`, `app/views/settings-push-card.js`, `app/lib/pwa-install.js`.
- **Modified:** `app/views/settings-view.js` (mount card), `app/install-prompt.js` (import shared
  predicates), `scripts/write-runtime-config.mjs` (inject `vapidPublicKey`).

---

## ITEM RJ30-3d — Netlify sender function (goal + kickoff diff + fan-out)

### User story
> As the product owner, I want a free scheduled function that detects new goals and imminent
> kickoffs from the committed data files and pushes them to subscribers of the involved teams,
> de-duplicating sends and pruning dead subscriptions, so the feature runs at zero marginal cost and
> never double-notifies.

### Acceptance criteria
- **Given** `WC26_SUPABASE_SERVICE_KEY` / `WC26_VAPID_PRIVATE_KEY` unset, **When** the fn runs,
  **Then** it is **dormant** (no-op 200) — same safety as `score-brackets.mjs:36-42`.
- **Given** `match_events.json` shows a match with N goal events for a team, and
  `push_notify_state` has `seq < N` for `(match_id,'goal')`, **When** the fn runs and the match
  status is LIVE (not FINAL-stale and not SCHEDULED), **Then** it pushes one "GOAL" notification per
  *new* goal to subscribers whose `teams` (or `profiles.favorite_team`) include either team, and
  updates `seq = N`.
- **Given** a match `kickoff_utc` is within `[now, now+KICKOFF_LEAD_MIN]` and no
  `(match_id,'kickoff')` state row exists, **When** the fn runs, **Then** it pushes a "Kicks off
  soon" notification to subscribers of either team and writes the state row.
- **Given** a push endpoint returns 404 or 410, **When** the fn sends, **Then** it deletes that
  `push_subscriptions` row (cleanup).
- **Given** a subscriber's quiet hours cover "now" in their `tz_offset`, **When** a non-kickoff push
  would fire, **Then** it is suppressed (kickoff always sends, see Open Q on quiet-hours scope).
- **Given** two consecutive runs with no new goals, **When** the fn runs, **Then** zero pushes
  (idempotent — `seq` gate).

### Tasks (exact files / data flow)
**New `netlify/functions/push-notify.mjs`** — mirrors `score-brackets.mjs` structure:
```js
import { createClient } from '../../vendor/supabase-js.js';
import { diffGoals, imminentKickoffs } from './_lib/push-diff-core.mjs';
import { sendWebPush } from './_lib/web-push.mjs';

export const config = { schedule: '* * * * *' };  // every minute — see Open Q on cadence

const URL_BASE = (process.env.WC26_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.WC26_SUPABASE_SERVICE_KEY || '').trim();
const VAPID_PUBLIC = (process.env.WC26_VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE = (process.env.WC26_VAPID_PRIVATE_KEY || '').trim();

export default async (req, context) => {
  if (!URL_BASE || !SERVICE_KEY || !VAPID_PRIVATE) { /* dormant 200, like score-brackets */ }
  const siteBase = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://worldcup2026.j5lagenticstrategy.com';
  const [events, results, schedule] = await Promise.all([
    fetchJson(siteBase, '/data/match_events.json'),
    fetchJson(siteBase, '/data/actual_results.json'),
    fetchJson(siteBase, '/data/schedule_full.json'),
  ]);
  const sb = createClient(URL_BASE, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: state } = await sb.from('push_notify_state').select('match_id,kind,seq');
  // PURE diff (unit-testable, no I/O):
  const goalNotices = diffGoals(events, results, schedule, state);     // [{match_id, teams:[a,b], player, minute, score}]
  const koNotices   = imminentKickoffs(schedule, results, state, Date.now(), KICKOFF_LEAD_MIN);
  // For each notice, resolve target subscriptions (teams overlap) and send.
  // On 404/410 -> sb.from('push_subscriptions').delete().eq('endpoint', ep)
  // On success -> upsert push_notify_state row (seq for goals, 0 for kickoff)
};
```

**New `netlify/functions/_lib/push-diff-core.mjs`** — **pure** functions (the testable core, mirrors
`_lib/results-health-core.mjs`):
- `diffGoals(events, results, schedule, stateRows)`:
  - For each `match_id` in `events`, count `events[].type === 'goal'` → `goalCount`.
  - Look up the match status in `results` (via `tier[A__vs__B]` like `mergeLiveScores`'s key logic,
    `live-scores.js:139-143`) — **only emit if status is LIVE** (use `LIVE_STATUSES` from
    `app/lib/match-status.js`) OR became FINAL this run (so the final goal still notifies). Skip
    `STATUS_SCHEDULED`.
  - `prevSeq = stateRows[(match_id,'goal')].seq ?? 0`. Emit `goalCount - prevSeq` new-goal notices
    (the latest goal's player/minute for the body), carry `nextSeq = goalCount`.
- `imminentKickoffs(schedule, results, stateRows, nowMs, leadMin)`:
  - For each schedule row, `k = Date.parse(kickoff_utc)`; if `now <= k <= now+leadMin*60000`, status
    is not already LIVE/FINAL, and no `(match_id,'kickoff')` state row → emit.
- `targetTeamsForNotice(notice)` → `[team_a, team_b]` (canonical names; subscriber `teams` or
  `profiles.favorite_team` match against these).

**New `netlify/functions/_lib/web-push.mjs`** — minimal VAPID Web Push encryption (ECDH/HKDF/AES-GCM
via Node's `crypto`, plus an ES256 JWT for the `Authorization: vapid` header). **Bundled with esbuild**
(per `netlify.toml`). Implemented from scratch with `node:crypto` (no npm `web-push` dependency to
keep the no-build/zero-dep stance — but see Open Q: vendoring `web-push` is the lower-risk alt).
`sendWebPush({endpoint,p256dh,auth}, payloadJSON, {vapidPublic, vapidPrivate, subject})` → returns
`{status}`; caller treats 201/200 as ok, 404/410 as prune.

**Subscriber resolution:** join `push_subscriptions` to `profiles.favorite_team` server-side:
`sb.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth,teams,notify_goals,notify_kickoffs,quiet_start,quiet_end,tz_offset')`
then a second `select('user_id,favorite_team').in('user_id', ids)` (or a view — see Open Q). Match a
notice's team set against `teams` (falling back to the profile favorite when `teams` is empty).

### Edge cases / races
- **Duplicate sends across runs**: `push_notify_state.seq` gate is the de-dup. Two fn invocations
  overlapping (rare) both read the same `seq` → both could send; mitigated by the cadence (1/min, runs
  are short) and by upserting state immediately. Accept at-most-rare-double; an alternative is an
  advisory lock (Open Q).
- **Stale re-scrape**: a cron re-commits `match_events.json` unchanged → `goalCount` equal to `seq`
  → zero new notices.
- **Match finished long ago**: status FINAL and `seq` already at `goalCount` → no-op. A *first ever*
  observation of an already-FINAL match (e.g. fn was dormant during the game) would otherwise blast
  every goal at once → guard: skip goal notices when `now - kickoff > GOAL_BACKFILL_GUARD` (e.g. 3h,
  matching `live-poller.js LIVE_WINDOW_MS`) UNLESS `seq` row absent AND match is currently LIVE.
- **410 Gone / 404**: prune the subscription row.
- **No subscribers for a team**: emit nothing, still advance `seq` (so we don't re-evaluate forever).
- **Empty favorites**: subscriber with empty `teams` and null `favorite_team` matches nothing.
- **Clock skew on kickoff**: `KICKOFF_LEAD_MIN` window is inclusive of now→now+lead; a fn that misses
  a minute (Netlify scheduling jitter) still catches it next run as long as kickoff is still ahead;
  once kickoff passes, the kickoff notice is skipped (would be late) — accepted.
- **iOS payload size**: keep payload < 4KB (title+body+url only).

### Files
- **New:** `netlify/functions/push-notify.mjs`, `netlify/functions/_lib/push-diff-core.mjs`,
  `netlify/functions/_lib/web-push.mjs`.

---

## QA TEST SCRIPTS (concrete, implementable)

### T1 — `tests/feature/push-diff.test.mjs` (node:test) — goal/kickoff diff core
Type: `node --test`. Imports the **pure** `_lib/push-diff-core.mjs` (no network).
```
Given events {"A__vs__B":{events:[{type:'goal',team:'A',player:'X',minute:"9'"}]}},
  results.group_stage["A__vs__B"]={status:'STATUS_FIRST_HALF',score_a:1,score_b:0},
  schedule=[{match_id:'A__vs__B',team_a:'A',team_b:'B',stage:'group',kickoff_utc:<now-10min>}],
  state=[] (no prior)
When  diffGoals(events,results,schedule,state)
Then  returns length 1; notice.match_id==='A__vs__B'; notice.teams deepEqual ['A','B'];
      notice.player==='X'; notice.nextSeq===1
```
```
Given same events but state=[{match_id:'A__vs__B',kind:'goal',seq:1}]
When  diffGoals(...)
Then  returns length 0  (already sent — de-dup)
```
```
Given results status 'STATUS_SCHEDULED' (0-0 stub) with a goal event present
When  diffGoals(...)
Then  returns length 0  (status-gated — never notify on scheduled stub)
```
```
Given a FINAL match with kickoff 5h ago, seq row absent, 3 goal events
When  diffGoals(...)
Then  returns length 0  (GOAL_BACKFILL_GUARD — no historic blast)
```
```
Given schedule row kickoff_utc = now+10min, results has no LIVE/FINAL row, state=[]
When  imminentKickoffs(schedule,results,state,Date.now(),15)
Then  returns length 1; notice.kind==='kickoff'; teams==['A','B']
Given the same with state=[{match_id,kind:'kickoff'}]  → returns length 0
Given kickoff_utc = now+40min (outside 15-min lead) → returns length 0
```
Assertions use `node:assert/strict` `deepEqual`/`equal`, matching `match-status.test.mjs` style.
**Fixtures**: inline JS objects (no files needed).

### T2 — `tests/feature/web-push-encode.test.mjs` (node:test) — VAPID + key decode
Type: `node --test`.
```
Given a known VAPID base64url public key string
When  urlBase64ToUint8Array(key)  (exported from app/push.js or a shared util)
Then  result is Uint8Array length 65, first byte 0x04 (uncompressed P-256 point)
```
```
Given sendWebPush builds a request (mock fetch capturing headers)
When  invoked with vapidPublic/Private/subject
Then  Authorization header starts 'vapid t=' (a JWT) and 'k=' the public key;
      TTL header present; body is the AES-GCM ciphertext (length>0)
```
(Use a `globalThis.fetch` stub returning `{status:201}`; assert the captured request, do NOT hit a
real push service.)

### T3 — `tests/feature/sw-push-contract.test.mjs` (node:test) — SW has push, no fetch
Type: `node --test`. Reads `sw.js` as text.
```
Given the file sw.js
When  read as a string
Then  it contains "addEventListener('push'" AND "addEventListener('notificationclick'"
      AND does NOT contain "addEventListener('fetch'"   (no-offline contract preserved)
And   VERSION constant matches app/lib/version-purge.js APP_VERSION (extend existing
      r14-version-sync expectation, or assert here)
```

### T4 — `tests/feature/push-client-gate.test.mjs` (node:test) — iOS install gate logic
Type: `node --test`. Imports `canSubscribeHere`/`isInstalledIOSPWA` with a stubbed `window`/`navigator`.
```
Given navigator.userAgent = iPhone Safari, standalone=false, Notification/PushManager present
When  canSubscribeHere()
Then  false   (iOS Safari tab — gated)
Given same UA but matchMedia('(display-mode: standalone)')=true
Then  true    (installed iOS PWA)
Given a desktop UA with the APIs present and a VAPID key
Then  true
Given Notification undefined
Then  isPushSupported()===false and canSubscribeHere()===false  (graceful)
```
Use a small `global.window`/`global.navigator` shim per-case (jsdom not in stack — hand-roll like the
existing pure-logic tests do).

### T5 — `tests/ux/push-settings.spec.mjs` (Playwright, 390x844)
Type: `npx playwright test`. baseURL `http://localhost:8088` (config). Mobile-chromium project.
> Note: WebKit/iOS-standalone push can't be truly exercised in CI (no real push service / no
> standalone Chromium). This spec verifies the **UI gating + copy**, not real delivery.
```
Given the app at /#/settings in a NON-standalone mobile viewport (emulated iPhone UA)
When  the page renders
Then  a card [data-testid="push-card"] is visible
And   it shows the "Add to Home Screen to get match alerts" hint (install-gated copy)
And   no live OS prompt is triggered on load (assert Notification.requestPermission not called —
      stub window.Notification.requestPermission and assert call count 0 after render)
```
```
Given window forced to standalone (page.addInitScript overriding matchMedia + navigator.standalone)
  AND signed-out
When  /#/settings renders
Then  push-card shows "Sign in to enable alerts" with a button that calls openAuth (assert the
      auth modal [data-testid="auth-modal"] appears on click)
```
```
Given standalone + signed-in (seed competition state / localStorage as qa-signed-in.spec does)
  AND Notification.permission stubbed 'default', PushManager + serviceWorker.ready stubbed
When  the user taps [data-testid="push-enable"]
Then  Notification.requestPermission is called exactly once (user-gesture path)
And   on stubbed 'granted', pushManager.subscribe is called and the card flips to show
      [data-testid="push-toggle-goals"] and [data-testid="push-toggle-kickoffs"]
```
Selectors to add in the card: `data-testid="push-card"`, `push-enable`, `push-disable`,
`push-toggle-goals`, `push-toggle-kickoffs`, `push-install-hint`, `push-signin`.
Stubs via `page.addInitScript` (override `window.Notification`, `navigator.serviceWorker`,
`PushManager`) — Playwright pattern already used in `qa-pwa-ios.spec.mjs` `page.evaluate` seeding.

### T6 — `validate_data.py` (extend) / smoke
No data-schema change to existing files → `validate_data.py` unaffected. Add a `tests/smoke.sh`
line asserting `netlify/functions/push-notify.mjs` and `_lib/push-diff-core.mjs` exist and import
cleanly (`node --check`), mirroring how smoke validates other fns. Confirm the SW still parses
(`node --check sw.js`).

---

## iOS / UX NOTES
- **Install-gated, honest:** on iOS the only path to push is Add-to-Home-Screen (iOS 16.4+). The card
  detects non-standalone iOS and shows the share-sheet hint identical to `install-prompt.js` rather
  than a dead Enable button. Everyone else (no push support) keeps the existing **in-app live
  toasts** from the live poller — push is strictly additive, no regression.
- **Permission only on tap:** `requestPermission()` is wired to the Enable button (iOS requires a
  user gesture); never on load. No nagging — denied state shows recovery copy once.
- **Safe areas / design language:** the card is a standard `home-card` with `settings-toggle` rows —
  inherits existing safe-area padding and visual language; no new full-bleed surfaces, no new
  sticky bars (the `qa-pwa-ios` audit checks gesture-zone overlap; we add none).
- **Notification UX:** per-match `tag` collapses goal spam; `renotify:true` so a 2nd goal still buzzes.
  Tap deep-links to `/#/matchup/<match_id>`.
- **Battery/quiet hours:** optional quiet-hours suppress non-kickoff pushes; kickoff alert respects a
  T-15 default so it's actionable, not noise.

## FILES TOUCHED / NEW FILES
**New (disjoint ownership):**
- `supabase/migrations/20260701010000_push_subscriptions.sql` (DRAFT)
- `sw.js` *(modified)*, `app/lib/version-purge.js` *(modified — version bump)*
- `app/lib/pwa-install.js`, `app/push.js`, `app/views/settings-push-card.js`
- `netlify/functions/push-notify.mjs`, `netlify/functions/_lib/push-diff-core.mjs`,
  `netlify/functions/_lib/web-push.mjs`
- Tests: `tests/feature/push-diff.test.mjs`, `tests/feature/web-push-encode.test.mjs`,
  `tests/feature/sw-push-contract.test.mjs`, `tests/feature/push-client-gate.test.mjs`,
  `tests/ux/push-settings.spec.mjs`

**Modified:** `app/views/settings-view.js` (mount card), `app/install-prompt.js` (import shared
predicates), `scripts/write-runtime-config.mjs` (inject `vapidPublicKey`).

## MANUAL HANDOFFS REQUIRED (owner)
1. Generate VAPID keypair (free, one command): `npx web-push generate-vapid-keys` (or
   `node` `crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'})`).
2. Set Netlify env vars (Site settings → Environment): `WC26_VAPID_PUBLIC_KEY`,
   `WC26_VAPID_PRIVATE_KEY`, and confirm `WC26_SUPABASE_SERVICE_KEY` (already used by score-brackets).
3. Apply the migration SQL to prod `vodjwymxquuertmhtvuw` via the Supabase SQL editor (explicit OK
   required — NOT auto-applied).
4. The sender stays **dormant** until 1–3 are done (safe to ship code first).

## OPEN QUESTIONS (each a choice + recommendation)
1. **Where the sender runs / cadence.** (a) Netlify scheduled fn `* * * * *` (every minute);
   (b) `@hourly` like the other fns; (c) a Claude Code remote routine/cron firing the fn.
   **Recommend (a)** — goals need sub-minute latency; Netlify scheduled fns at 1/min are free and
   match the live-window cadence (`live-poller.js` polls 30s). Caveat: it only sees data as fresh as
   the *committed* `match_events.json`, which the GitHub crons throttle — so latency is bounded by the
   data pipeline, not the fn. (See Q5.)
2. **Goal-diff state storage.** (a) `push_notify_state` table (planned above); (b) a Netlify Blob;
   (c) recompute from `actual_results` score deltas only. **Recommend (a)** — durable, queryable,
   service-role-only, and reuses the Supabase trust model already in place.
3. **web-push implementation.** (a) Hand-rolled `node:crypto` VAPID encrypt in `_lib/web-push.mjs`;
   (b) vendor the npm `web-push` package into `vendor/` and import it (esbuild bundles it).
   **Recommend (b)** — Web Push payload encryption (HKDF/AES128GCM + ES256 JWT) is error-prone to
   hand-roll; `web-push` is battle-tested, MIT, zero-runtime-cost, and esbuild already bundles
   function deps. Keeps the "no app build step" rule intact (it's a *function* dep, not app code).
4. **Goal latency vs the throttled data pipeline.** Goal pushes are only as fast as
   `data/match_events.json` lands on `main` (GitHub `schedule:` crons are throttled per `CLAUDE.md`).
   Options: (a) accept pipeline latency (minutes); (b) have the sender fetch ESPN's summary endpoint
   *directly* (like `live-scores.js`) for true ~30s goal latency, bypassing the commit lag.
   **Recommend (b) as a fast-follow**, ship (a) first — (a) is zero-new-surface and correct; (b) adds
   a direct-ESPN read in the fn for real-time but needs the same RENAMES sync. Confirm before (b).
5. **Quiet-hours scope.** (a) Suppress goals only, always send kickoff; (b) suppress both;
   (c) no quiet hours v1. **Recommend (a)** — kickoff is time-critical and rare; goals are the noisy
   ones. Ship the column now, default off.
6. **Targeting beyond favorite team.** v1 targets the single `favorite_team`. Multi-team follow
   (the `teams` jsonb column) — ship the column now, UI later? **Recommend yes**: store `teams` but
   v1 UI only writes `[favorite]`; unlocks multi-follow with no migration later.
7. **Badge icon.** Reuse an existing monochrome icon for `badge` or add `/icons/badge-72.png`?
   **Recommend** reuse the existing 192 icon as `icon` and ship a tiny monochrome `badge-72.png`
   (iOS ignores badge today but Android uses it) — non-blocking either way.
