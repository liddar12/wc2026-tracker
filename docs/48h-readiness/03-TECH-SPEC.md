# Tech Spec — WC26 48-Hour Readiness (R16)

Concrete, file-level design + per-phase test plan. Every phase = its own PR, green at QA L1–L4 before merge.

---

## Phase 1 — Auth modal + unified entry points + logout repaint

### Changes
1. **New `app/auth-modal.js`**
   - `openAuth(mode='entry')`: build a centered overlay (lift markup/behavior from `toolbar-auth.js:228-260 promptHandle` — backdrop, `role="dialog" aria-modal`, focus-trap, Esc/backdrop close, focus restore). Mount `renderAuthPanel(host, getCompetitionState(), handlers)`.
   - `handlers`: reuse the set at `toolbar-auth.js:186-224` (`getPanelMode`/`setPanelMode`/`onSignIn`/`onSignUp`/`onGuest`), but `setPanelMode(mode,true)` re-renders **inside the same overlay** (no dropdown remount races). `onSignIn/onSignUp/onGuest` success → `closeAuth()` (state-change repaint handles the view).
   - `closeAuth()`: remove overlay, restore focus.
2. **`app/main.js`** — add `window.addEventListener('competition:state-change', renderView);` (bridges auth state → active-view repaint; fixes logout everywhere). Verify no double-render storm (debounce a microtask if needed).
3. **`app/toolbar-auth.js`** — replace the sign-in/up dropdown paths: signed-out/guest → button calls `openAuth('entry')`; signed-in → keep the small account popover with Sign out (`signOut()` then `closeAuth()`/repaint). Delete `mountFullAuthPanel` dropdown remount + its race patches.
4. **`app/views/settings-view.js:172,180`** — `#settings-go-signin` → `openAuth('signin')` (remove `setRoute('picks')`). Update copy (drop "Sign in from My Picks").
5. **`app/views/home-view.js:331-341`** — `[data-go-signin]` → `openAuth('signin')` (remove the `setAuthPanelMode`+`tbBtn.click()` indirection).
6. **`app/views/my-picks.js:192-193`** — landing CTA → `openAuth('entry')` instead of `auth-toolbar-btn.click()`.
7. **Play submit wall** (`app/views/play-view.js` submit path) — when a guest/anon taps submit-to-pool, `openAuth('entry')`.

### Tests (L1–L3)
- **L2** `tests/feature/r16-auth-modal.test.mjs`: `openAuth` mode→form mapping (entry/signin/signup), handler wiring is a pure-ish unit (mock host); `competition:state-change` bridges to a render callback.
- **L3** `tests/ux/r16-auth-entrypoints.spec.mjs` (mobile 390px): for each of the 5 entry points → modal appears in one tap; signin form reachable; bad creds show inline error + modal stays; **signout from toolbar repaints My Picks to logged-out**; settings "Sign in" opens modal (no nav to My Picks); Esc/backdrop close; focus trap.
- **Regression:** existing `tests/ux/nav-toolbar.spec.mjs` stays green.

---

## Phase 2 — Combined leaderboard total

### Changes
- **`app/competition.js fetchLeaderboard` (514-539)**: also query `group_predictions(user_id,picks,score)` for the group; build a `Map<user_id, {group, knockout}>` unioning IDs from both tables; `total = scoreGroupPredictions(gp.picks,data).score + scoreBracketWeighted(gb.picks,data).score`; rank by `total`. Keep `compareLeaderboardEntries` (feed it `total`).
- **`app/components/podium-modal.js`** — show `group + knockout = total` on the submit confirmation (the submit path already returns both, `play-view.js:849-857`).

### Tests (L1)
- `tests/feature/r16-leaderboard-total.test.mjs`: sum (60+40→100); union (group-only user appears; bracket-only user appears); missing-half defaults to 0; max 180; tie-break unchanged.

---

## Phase 3 — Remove offline + anon expiry

### Changes
- **`sw.js`**: `VERSION='wc26-v16'`; `SHELL_ASSETS=[]`; `install` → `skipWaiting()` (no `addAll`); `fetch` handler → network-only (`event.respondWith(fetch(event.request))` for navigations, else passthrough `return;`); keep `activate` purge (deletes `wc26-v15-*`). SW stays registered in `index.html`.
- **`app/lib/version-purge.js`**: `APP_VERSION='wc26-v16'` (lockstep — `r14-version-sync` test); add `export function expireAnonCache(storage, nowMs)` — reads `wc26.anon.sessionStart`; if absent set it; if `now-start>90*60*1000` remove `ANON_KEYS=['wc26.grouppicks.local','wc26.mybrackets.local','wc26.picks','wc26.competition.guestHandle','wc26.competition.guestMode']` and reset stamp. Gate caller on `!state.user`.
- **`app/main.js`**: call `expireAnonCache` at boot after `purgeLegacyState` (only when not signed in).
- **`app/views/play-view.js:829-837`** (anon submit branch): after a successful anon stage-3 submit, clear anon draft keys + reset stamp (direct call).

### Tests (L1–L3)
- `tests/feature/r16-anon-expiry.test.mjs`: TTL boundary (89min keeps, 91min clears); signed-in drafts untouched; stage-3 clear; idempotent.
- `tests/feature/r16-sw-network-only.test.mjs`: assert `sw.js` has empty `SHELL_ASSETS`, network-only fetch, v16, and version-sync holds.
- **L3** Playwright: with offline emulation, app does **not** boot from cache (no SW-served shell).

---

## Phase 4 — Server scorer + Everyone pool

### Migrations (DRAFT to preview first, then prod after sign-off)
1. `20260605010000_scorer_and_lock_bypass.sql`
   - Add `if current_setting('app.scorer', true) = 'on' then return new; end if;` to `enforce_group_predictions_lock` / `enforce_group_brackets_lock`.
   - `score_all()` SECURITY DEFINER: `perform set_config('app.scorer','on',true);` then recompute + UPDATE both score columns from a results source (see note). Port `WEIGHTED_ROUND_POINTS` + group points into SQL.
   - Schedule via `pg_cron` hourly (or wire to a results-update trigger).
2. `20260605020000_everyone_pool.sql`
   - Ensure system auth user; insert "Everyone" group (fixed UUID, public, owned by system user).
   - `handle_new_user_join_everyone()` SECURITY DEFINER trigger on profile/user insert → `insert into group_members … on conflict do nothing`.
   - Backfill existing users into Everyone.
3. `20260605030000_leaderboard_rpc.sql`
   - `leaderboard(p_group_id uuid, p_limit int default 50, p_offset int default 0)` returns `(rank,user_id,username,group_score,knockout_score,total)` ordered by total desc; joins `group_predictions`+`group_brackets`+`profiles`; SECURITY DEFINER + RLS-safe; indexes on `group_members(group_id)`, score cols.

> **Results-source note:** simplest is `score_all()` fetching the public `actual_results.json` is NOT possible from SQL; either (a) a Netlify scheduled function calls an RPC passing parsed results, or (b) add an `actual_results` table the pipeline writes and `score_all()` reads. Decide at Phase-4 kickoff; (a) is less schema churn for 48h.

### Client
- `app/competition.js fetchLeaderboard` → call `leaderboard` RPC (paginated) for the active pool; keep JS scorer for local/unsubmitted preview only.
- Pin "Everyone" in `pools-view.js`; default active group for new users.

### Tests
- **L1/L2** SQL parity test: SQL `score_all` results == JS `scoreBracketWeighted`/`scoreGroupPredictions` for fixtures.
- RPC contract test (preview project): pagination, ordering, combined total; auto-join inserts a membership row for a new signup; scorer updates locked rows without trigger error.
- **L5** preview: load Everyone leaderboard → one bounded RPC call (no `.in()` storm).

---

## Phase 5 — Regression + QA hardening
- Run L1 (`node --test tests/feature/*.mjs`), L3 (`playwright … tests/ux tests/integrated`), L4 happy-path; explicitly run `tests/ux/qa-*` scenario specs (guest, signed-out, signed-in, pwa-ios) for customer sign-off.
- Apply migrations to **both** Supabase projects (preview + prod) so preview QA is faithful.
- Prod deploy → re-verify all Go/No-Go items on `worldcup2026.j5lagenticstrategy.com`.

---

## Rollback
- Each phase is an isolated PR; revert the merge commit to roll back.
- SW: if v16 network-only misbehaves, re-point `fetch` to passthrough and bump to v17 (activate purges).
- Migrations are additive; the scorer bypass + Everyone seed can be disabled (drop trigger / `unschedule` cron) without dropping tables.
