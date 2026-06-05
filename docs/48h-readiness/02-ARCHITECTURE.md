# System Architecture — WC26 48-Hour Readiness (R16)

## Context (today)
Vanilla-JS ESM PWA, no build step, static-served on Netlify. Hash router (`app/state.js`, `app/main.js`). Supabase (auth + Postgres + RLS + RPCs); prod project `vodjwymxquuertmhtvuw`, preview `wstbfwluaiheumntrrwa`. Service worker `sw.js` (currently offline-capable). Auth/competition state in `app/competition.js` (`state` object, events on `window`).

---

## 1. Auth architecture

### Problem (root cause)
Auth lives inside a cramped `position:fixed` toolbar dropdown reached via 2–3 nested re-mounts, with **4 disconnected entry points** that each "open auth" differently, and **a broken state→render link**: `signOut()` and friends fire `competition:state-change`, but the router re-renders only on `state:change`/`hashchange` (`main.js:228-234`); the sole `competition:state-change` listener is the toolbar label (`toolbar-auth.js:46`). So views don't repaint on auth changes.

### Target
```
            ┌─────────────────────────────────────────────┐
 entry pts  │ openAuth(mode)   ← single public entry        │
 ───────────┤  • navbar #auth-toolbar-btn                   │
 toolbar    │  • home [data-go-signin]                      │
 home CTA   │  • settings "Sign in"                         │
 settings   │  • my-picks landing                           │
 my-picks   │  • play submit wall                           │
 play wall  └───────────────┬─────────────────────────────┘
                            │ mounts
                            ▼
        ┌──────────────────────────────────────┐
        │ AuthModal (centered overlay)          │  reuse promptHandle()
        │  backdrop · role=dialog · focus-trap  │  overlay pattern
        │  renders renderAuthPanel(mode)        │
        └───────────────┬──────────────────────┘
                        │ onSignIn/onSignUp/onGuest/onSignOut
                        ▼
        competition.js  signIn/signUp/signOut/continueAsGuest
                        │ dispatches
                        ▼
        competition:state-change  ──bridged──▶  re-render current view
```

### Key decisions
- **New module `app/auth-modal.js`** exporting `openAuth(mode='entry')` and `closeAuth()`. It owns the centered overlay (lifted from `promptHandle`), mounts `renderAuthPanel(host, comp, handlers)` (existing template, unchanged), and reuses the handler set already in `toolbar-auth.js:186-224` (signin/signup/guest with `#comp-msg` error surfacing).
- **`renderMenu` simplification:** the toolbar dropdown either (a) becomes a thin launcher that calls `openAuth()` (signed-out/guest) and only shows account+signout inline (signed-in), or (b) is removed in favor of the modal. Decision: keep a tiny signed-in account popover (sign-out) but route all *sign-in/up* through `openAuth()`.
- **Fix the render link (FR-A5):** bridge `competition:state-change` → a view repaint. Lowest-risk option: in `main.js`, add `window.addEventListener('competition:state-change', renderView)` (the router already has `renderView()` at `main.js:86`). This makes logout/sign-in repaint the active view everywhere, eliminating the per-call-site manual `paintCompetition`/`setRoute('home')` workarounds.
- **Deep-link modes:** `openAuth('signin')` sets panel mode then mounts, so the form shows immediately (fixes the home `[data-go-signin]` dead-end where `renderMenu` ignored the mode).

### Reused, unchanged
`renderAuthPanel` template (`competition-auth-panel.js`), `signIn/signUp/signOut/continueAsGuest` (`competition.js`), the guest-handle prompt.

---

## 2. Scoring & leaderboard architecture

### Today
100% client-side: `scoreGroupPredictions` (max 84, `group-scoring.js`) + `scoreBracketWeighted` (max 96, `competition-scoring.js`). `fetchLeaderboard` (`competition.js:514-539`) reads **only `group_brackets`**, recomputes the knockout half, ignores stored `score`, and **drops the 84-pt group score** (`:531`). No server scorer. `actual_results.json` is the sole results input (currently empty); lock triggers (`20260604060000`) block post-lock writes.

### Target (two stages)
**Stage A — combined total (Phase 2, client):** `fetchLeaderboard` reads `group_predictions` + `group_brackets`, unions users, total = group + knockout (recomputed from `data.actualResults`), max 180. Stored `score` becomes display-only; lock trigger scoped to skip score-only updates (`OLD.picks IS NOT DISTINCT FROM NEW.picks`).

**Stage B — authoritative server scorer (Phase 4, required for Everyone-pool scale):**
```
 results (actual_results) ──▶ score_all() SECURITY DEFINER
     (pg_cron hourly)            • set_config('app.scorer','on')  ← lock-trigger bypass
                                 • UPDATE group_predictions.score, group_brackets.score
                                       │
                                       ▼
                          leaderboard(group_id,limit,offset) RPC
                          rank by (group_score+knockout_score) desc, paginated
                                       │
                                       ▼
                          client home/my-picks  (one code path)
```
- Scoring rules are ported to SQL **once** and pinned to the JS constants (`WEIGHTED_ROUND_POINTS`, group points) with a parity test.
- The lock triggers get: `if current_setting('app.scorer', true) = 'on' then return new;` at the top of each enforce fn.
- Client `fetchLeaderboard` switches to the RPC; the JS scorer remains for the local/unsubmitted preview only.

---

## 3. Everyone pool architecture

### Build
- **Seed:** create `supabase/seed.sql` (referenced by `config.toml:65` but missing) **or** a migration that (1) ensures a system auth user exists, (2) inserts the "Everyone" group with a fixed UUID owned by that user.
- **Auto-join:** trigger on new `profiles` (or `auth.users`) insert → `insert into group_members(everyone_id, new.user_id) on conflict do nothing`. SECURITY DEFINER so it bypasses `group_members_insert_self`.
- **Surfacing:** pin "Everyone" in the pools list; default `activeGroup` for users with no other pool.

### Risk model (explicit)
- **Privacy:** `profiles_select_comembers` + `shares_group_with` (`20260604020000`) expose username + favorite_team to co-members. With everyone co-membered, these become **globally readable**. Accepted: usernames are public leaderboard handles by design. No emails/PII exposed (profiles holds username + favorite_team only).
- **Scale:** the current client `fetchLeaderboard` is O(N) with an unbounded `.in(user_id, …)`. Everyone-pool **must** use the paginated server RPC (FR-E5) — this is why Q4 requires the Q2-B scorer.
- **FK fragility:** `groups.created_by` NOT NULL + `on delete cascade` → if the owning auth user is deleted, the Everyone pool cascades away. Mitigation: dedicated system account, documented as never-delete; consider relaxing the FK for this row.

---

## 4. Caching / session architecture

### Today
SW precaches ~50 shell assets and falls back to cached `index.html` for navigations (the offline keystone, `sw.js:148-163`). Three storages: **Cache Storage** (`wc26-v15-*`), **localStorage** (`wc26.*` incl. anon `.local` drafts), in-memory. No anon session concept or TTL.

### Target
- **Remove offline:** `sw.js` → network-only fetch, empty `SHELL_ASSETS`, `VERSION='wc26-v16'`. Existing `activate` purge deletes `wc26-v15-*` on next visit. SW stays registered (reversible). `version-purge.js APP_VERSION` bumped in lockstep (the `r14-version-sync` test enforces this).
- **Anon expiry:** new `wc26.anon.sessionStart` stamped on first anon draft (or boot when `!state.user`). New `expireAnonCache()` in `version-purge.js`, called from `main.js` boot alongside `purgeLegacyState`: if `now - start > 90min`, remove anon draft keys + reset. Plus a direct call from the anon branch of `submitBracket` (`play-view.js:829-837`) after a stage-3 submit. Gated strictly to `!state.user`.
- "Cache" here = localStorage anon drafts (Cache Storage is gone once SW is network-only).

---

## Events & contracts (summary)
- `competition:state-change` → **now also** triggers `renderView()` (the fix for logout/sign-in repaint).
- New: `openAuth(mode)` / `closeAuth()` (auth-modal.js).
- New SQL: `score_all()`, `leaderboard(group_id,limit,offset)`, auto-join trigger, `app.scorer` bypass in lock enforce fns, Everyone seed.
- New LS key: `wc26.anon.sessionStart`.
