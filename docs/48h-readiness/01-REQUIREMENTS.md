# Requirements — WC26 48-Hour Readiness (R16)

Format: **FR** = functional, **NFR** = non-functional, **AC** = acceptance criteria (testable).

---

## 1. Authentication (Phase 1 — critical)

### Functional
- **FR-A1** A single `openAuth(mode)` function opens a **centered modal/lightbox** (overlay + backdrop, `role="dialog" aria-modal="true"`), reusing the proven overlay pattern in `toolbar-auth.js:228 promptHandle()`.
- **FR-A2** Modes: `entry` (Sign in / Create account / Continue as guest), `signin`, `signup`. `openAuth('signin')` opens directly on the sign-in form (no extra entry hop).
- **FR-A3** Every entry point calls `openAuth()`:
  - Navbar account button (`#auth-toolbar-btn`)
  - Home CTA (`home-view.js` `[data-go-signin]`)
  - Settings "Sign in" (`settings-view.js:172,180`) — **must open the modal, not `setRoute('picks')`**
  - My Picks unauth landing (`my-picks.js`)
  - Play submit wall (when a guest/anon tries to submit to a pool)
- **FR-A4** Sign in, sign up, continue-as-guest, and **sign out** all work from the modal and from Settings/My Picks.
- **FR-A5** On any auth state change (sign in/up/out/guest), the **currently rendered view repaints** — not just the toolbar label.
- **FR-A6** Errors (bad credentials, unconfigured deploy) show inline in the modal (`#comp-msg`), modal stays open; success closes the modal and repaints.

### Non-functional
- **NFR-A1** Modal is usable on a 390px mobile viewport (no clipping; the current `position:fixed` dropdown clips on mobile).
- **NFR-A2** Keyboard: Esc closes, focus trapped in modal, focus returns to opener on close; backdrop click closes.
- **NFR-A3** Touch targets ≥44px; contrast ≥4.5:1 (per ui-ux-pro-max a11y rules).

### Acceptance
- **AC-A1** From each of the 5 entry points, the centered modal appears in **one tap** (signin/signup deep-links skip the entry screen).
- **AC-A2** Sign out from the toolbar menu **updates the visible view** (e.g. My Picks flips to the logged-out landing) without a manual reload.
- **AC-A3** Settings "Sign in" opens the modal in place; it never navigates to My Picks.
- **AC-A4** Playwright specs cover all 5 entry points + signin + signup + signout + guest, on mobile viewport.

---

## 2. Combined leaderboard (Phase 2)

### Functional
- **FR-L1** Leaderboard total = `group_predictions.score (max 84) + group_brackets.score (max 96)` = **max 180**, per user.
- **FR-L2** `fetchLeaderboard` reads **both** tables and unions user IDs (a user with group picks but no bracket — or vice-versa — still appears).
- **FR-L3** Totals recompute from `data.actualResults` for idempotency (same approach the bracket half already uses at `competition.js:528`).
- **FR-L4** Podium/submit confirmation surfaces both components (group + knockout) so the total is legible (`podium-modal.js`).

### Acceptance
- **AC-L1** A user with group score 60 + knockout 40 ranks at 100, not 40.
- **AC-L2** Tie-break order unchanged (`compareLeaderboardEntries`).
- **AC-L3** Feature tests assert the sum, the union of users, and the 0-default for a missing half.

---

## 3. Caching / offline removal + anon expiry (Phase 3)

### Functional
- **FR-C1** The service worker no longer provides offline usage: **network-only fetch**, empty precache. Bumping `VERSION` (→ `wc26-v16`) makes `activate` purge old `wc26-v15-*` caches.
- **FR-C2** SW stays **registered** (reversible); no full unregister rollout.
- **FR-C3** Anonymous (`!state.user`) draft state auto-expires:
  - after **90 minutes** from session start (`wc26.anon.sessionStart`), checked at boot; **or**
  - immediately **after an anon completes a stage-3 submit** (`play-view.js:829-837`).
- **FR-C4** Expiry clears anon draft keys (`wc26.grouppicks.local`, `wc26.mybrackets.local`, `wc26.picks`, anon guest identity) — **never** signed-in pool drafts.

### Non-functional
- **NFR-C1** Expiry reuses the idempotent boot-time `version-purge.js` mechanism (called once in `main.js` before any module reads localStorage).
- **NFR-C2** No timer that fails to survive reload as the *only* guard — boot-time TTL is the backstop.

### Acceptance
- **AC-C1** With the network blocked, a previously-loaded app **no longer boots from cache** (offline removed).
- **AC-C2** An anon draft present at T+0 is gone at next boot after T+90min; a signed-in pool draft is untouched.
- **AC-C3** After an anon stage-3 submit, anon draft keys are cleared on that action.
- **AC-C4** `version-purge` + new `expireAnonCache` have unit tests; old caches purged on version bump (SW test).

---

## 4. Everyone pool + server scorer (Phase 4)

### Functional — Everyone pool
- **FR-E1** A single seeded **"Everyone"** `groups` row (fixed UUID, `visibility='public'`), owned by a dedicated **system auth user** (never deleted; `groups.created_by` is NOT NULL).
- **FR-E2** Every user (on sign-up / first sign-in) is **auto-joined** via a SECURITY DEFINER trigger inserting into `group_members` (bypasses the self-insert RLS cleanly).
- **FR-E3** "Everyone" surfaces as a default/pinned pool; new users see it as their initial active pool.

### Functional — server scorer + leaderboard RPC
- **FR-E4** A SECURITY DEFINER **scorer** recomputes `group_predictions.score` and `group_brackets.score` from results, **exempt** from the lock triggers via a scoped session flag (`current_setting('app.scorer')`), run on a schedule (pg_cron hourly) — or triggered by results updates.
- **FR-E5** A **paginated, server-ranked** `leaderboard(group_id, limit, offset)` RPC returns `{rank, username, group_score, knockout_score, total}` ordered by total desc — no unbounded client `.in()` scan.
- **FR-E6** Client leaderboard (home + my-picks) consumes the RPC for the active pool (one code path; removes the client recompute divergence).

### Non-functional / risk
- **NFR-E1** Putting all users in one pool makes `profiles_select_comembers` expose every username + favorite team globally — **accepted** (usernames are public display handles). Documented in `02-ARCHITECTURE.md`.
- **NFR-E2** Leaderboard RPC must be indexed (`group_members(group_id)`, score columns) and capped/paginated; never return the full table to the client.
- **NFR-E3** Scoring logic exists once authoritatively (server); the client scorer becomes display-only/fallback and must match `WEIGHTED_ROUND_POINTS` / group `GROUP_POINTS`.

### Acceptance
- **AC-E1** A brand-new signup appears in "Everyone" `group_members` automatically.
- **AC-E2** The leaderboard RPC returns correctly-ordered combined totals and paginates (e.g. limit 50).
- **AC-E3** The scorer updates `score` for locked rows without tripping the lock triggers.
- **AC-E4** Loading "Everyone" leaderboard issues **one** bounded RPC, not an O(N) client recompute.

---

## Cross-cutting NFRs
- **NFR-X1** No regression: the existing 90 feature + 16 Playwright tests stay green.
- **NFR-X2** Every change ships behind the 6-level QA gate (`00-PLAN.md`).
- **NFR-X3** Prod = Supabase `vodjwymxquuertmhtvuw`; preview = `wstbfwluaiheumntrrwa` (migrations/seed must be applied to **both** for faithful preview QA).
