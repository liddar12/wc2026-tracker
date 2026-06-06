# Auth (login/logout) — RCA + test plan

Deep-dive on every login/logout affordance across pages + platforms. The user
reports they "operate and fail in different ways," the **header username
sometimes doesn't show when logged in**, and behavior **differs on desktop vs
iOS Safari vs iOS PWA**.

## Root causes (from code trace)
| # | Root cause | Evidence | Symptom it explains |
|---|---|---|---|
| **RC1** | `onAuthStateChange` updates `state.user/profile/groups` but **never dispatches `competition:state-change`** | `competition.js:694-704` | **Header username missing when logged in**, intermittent + platform-varying. On cold boot, `initCompetition` resolves via `getSession()` then fires state-change (works). But if the session resolves LATE (slow storage / iOS PWA / token refresh / cross-tab), it comes through `onAuthStateChange` → state updates with **no repaint** → header stuck on "Sign in." Timing-dependent → "different on desktop/iOS/PWA." |
| **RC2** | Header label uses `user.email` local-part (truncated to 12), not `profile.username` | `toolbar-auth.js:26-27,73-77` | Email-signups show the email, not their chosen username; long usernames truncated; header ≠ page body (which uses `profile.username`). |
| **RC3** | Pools "Sign in" routes to `picks` instead of `openAuth('signin')` | `pools-view.js:128` | The ONE "Sign in" that behaves differently — bounces to My Picks instead of opening the modal ("fails differently across pages"). |
| **RC4** | Home "Continue Anonymously" calls `continueAsGuest()` with **no** handle prompt | `home-view.js:341` | Guest UX differs from the modal/`startGuest` (which prompt for a name). |
| RC5 | my-picks signout does a redundant manual repaint; dead code (`renderGuestBanner`, my-picks `authHandlers`) | `my-picks.js:262`,`competition-auth-panel.js:80` | Minor; not user-facing. |

**Platform-specific (manual — can't be exercised in headless chromium):**
- **iOS PWA storage/session**: standalone PWA has a separate storage jar; session restore timing is slower → makes RC1 fire more often. RC1's fix mitigates it.
- **Stale service worker**: a PWA installed before R16 (v16 network-only SW) may serve the OLD cached shell until the SW updates → old auth code/behavior. Resolves on next launch after the v16 SW activates.
- **Safe-area positioning**: the account popover (`position:fixed`) near the notch/Dynamic Island on iOS PWA.

## Test plan
### A. Automated — signed-out consistency (Playwright, runs now)
Every "Sign in" affordance must open the **R16 auth modal** (`[data-testid=auth-modal]`):
| Page | Selector | Expected |
|---|---|---|
| Header | `#auth-toolbar-btn` | modal opens (entry) |
| Home | `[data-go-signin]` | modal opens (signin) |
| Settings | `#settings-go-signin` | modal opens (signin) |
| My Picks | `#invite-go-auth` | modal opens (entry) |
| Pool standings | "Sign in" btn | modal opens (signin) |
| **Pools** | `#pools-signin` | **modal opens (signin)** ← currently FAILS (RC3) |

### B. Automated — RCA guards (source-level, run now)
- RC1: the `onAuthStateChange` callback dispatches `competition:state-change`.
- RC2: `syncLabel` prefers `profile.username`.
- RC3: Pools sign-in uses `openAuth`.
- RC4: Home guest path prompts for a handle.

### C. Manual — signed-in lifecycle (run on each platform: desktop Safari/Chrome, iOS Safari, iOS PWA)
For each platform, signed in as a username-account AND an email-account:
1. Sign in via the modal → **header shows your username** (not email, not "Sign in", not "Account").
2. **Reload the page** → header still shows your username (RC1 — session restore repaint).
3. Leave the tab ~1h or force a token refresh → header still correct (RC1 — token-refresh repaint).
4. Sign out from **each** surface: header popout, Settings, My Picks → header flips to "Sign in" AND the current view repaints to signed-out, on every surface.
5. Sign in in one tab → other tab's header updates within a few seconds (RC1 — cross-tab).
6. iOS PWA only: install to home screen, sign in, close + reopen → still signed in, username shown.

### D. Regression
Full suite (173) stays green; the 6 R16 auth-modal Playwright tests stay green.

## Deep-RCA update — RC1's TRUE root cause (the screenshots)
The user's screenshots (header "Sign in" while logged in; Settings "Not signed
in" while the account menu showed signed-in) drove a deeper trace. Findings,
proven by instrumenting the boot + a real signed-in reload:
- The session token persists and a FRESH client's `getSession()` restores it —
  yet the app stayed signed-out on reload.
- Cause: `onAuthStateChange` was an **async callback that awaited
  `loadProfileAndGroups()`** (a Supabase `.from().select()`). That query needs
  the **same GoTrue auth lock the callback holds → DEADLOCK**, which hung
  `resolveCurrentUser()`'s `getSession()` so the repaint event never fired.
  Lock timing varies by engine → intermittent + "different on desktop/iOS/PWA."
- Fix: make the callback **synchronous** (set state + dispatch immediately) and
  **defer** `loadProfileAndGroups()` via `setTimeout(0)` (Supabase's documented
  pattern). Verified on prod: sign in → reload (×2) → header stays
  "signed-in/<username>".

## Run results + fixes — RESOLVED
Reproductions confirmed all four root causes (4/4 source guards + the Pools
behavioral test failed). Fixes applied + verified:
- RC1 ✅ **deadlock fix** — sync `onAuthStateChange` + deferred profile load (+ still dispatches `competition:state-change`) — `competition.js`. Regression guard asserts the callback is sync + deferred.
- RC2 ✅ `syncLabel` → `profile?.username` then email fallback — `toolbar-auth.js`.
- RC3 ✅ `#pools-signin` → `openAuth('signin')` — `pools-view.js`.
- RC4 ✅ Home guest → shared `startGuest()` (handle prompt) — `home-view.js`.

Post-fix run: §A Pools sign-in opens the modal; §B all 4 RCA guards green; §D
147 feature + 31 Playwright green (no regression). The reproduction tests
(`tests/feature/r20-auth-rca.test.mjs`, `tests/ux/r20-auth-consistency.spec.mjs`)
are now permanent regression guards.

§C manual lifecycle tests still recommended on real iOS Safari + iOS PWA to
confirm RC1's fix resolves the platform-specific "username not shown" (headless
can't exercise signed-in/PWA states).
