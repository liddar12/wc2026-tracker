# WC26 Tracker — QA User Stories & Acceptance Criteria

Scope: Auth (username/email), private groups, per-group brackets, lock windows,
leaderboard/scoring, guest mode, and platform/PWA behaviors for
`feature/auth-private-groups-brackets`.

Legend
- **Priority**: P0 (blocker / core), P1 (high), P2 (medium), P3 (nice-to-have).
- **Automation status**:
  - `Automated` — covered by `tests/competition.test.mjs` or `tests/smoke.sh`.
  - `Partial` — pure logic covered, end-to-end path not covered.
  - `Manual` — requires live Supabase (migrations applied) + browser.
  - `Not yet` — no coverage of any kind.
- **Platform(s)**: Desktop (Chrome/Edge/Firefox), iOS Safari, Android Chrome, PWA (installed standalone).

> Note: All DB-backed stories assume `supabase/migrations/20260527_auth_groups_brackets.sql`,
> `20260528_fix_group_members_rls.sql`, and `20260528_group_passphrase_secure_flow.sql`
> are applied and **Confirm email** is OFF for preview. As of the last status board, the
> migration apply is **blocked**, so every `Manual` story below is currently unverifiable on a live env.

## A. Authentication (signup / login / logout)

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| AUTH-01 | As a new user I can sign up with a username + password | Username 3-20 chars `[a-z0-9_]`; mapped to synthetic email `<username>@wc26.app`; password >= 8 chars; session active after signup; profile row created with username | Desktop, iOS Safari, Android, PWA | P0 | Partial (identifier/password rules in unit test; full signup Manual) |
| AUTH-02 | As a new user I can sign up with a real email + password | Valid email format enforced; inferred username from local-part when it matches `[a-z0-9_]{3,20}`, else random `user_xxxxxxxx`; profile created | Desktop, iOS Safari, Android, PWA | P0 | Partial |
| AUTH-03 | As a returning user I can log in by username | `Tracker_User` normalizes to `tracker_user@wc26.app`; trimmed of whitespace; session restored; groups loaded | Desktop, iOS Safari, Android, PWA | P0 | Partial (normalization Automated; login Manual) |
| AUTH-04 | As a returning user I can log in by email | Email passed through unchanged; inferred username derived; profile ensured to exist | Desktop, iOS Safari, Android, PWA | P0 | Partial |
| AUTH-05 | As a user I get clear validation errors | Username < 3 or > 20 → "3-20 chars" error; malformed email → "valid email address"; empty → "username or email"; password < 8 → "at least 8 characters"; empty password → "Enter a password." | Desktop, iOS Safari, Android, PWA | P1 | Partial (throw paths Automated; UI surface Manual) |
| AUTH-06 | As a user I can log out | Session cleared; `state.user/profile/groups/activeGroup` reset; guest mode re-enabled; auth panel returns to entry | Desktop, iOS Safari, Android, PWA | P0 | Manual |
| AUTH-07 | As a user my session persists across reloads | `persistSession: true` + `autoRefreshToken: true`; reload keeps me signed in; `onAuthStateChange` repopulates profile/groups | Desktop, iOS Safari, Android, PWA | P1 | Manual |
| AUTH-08 | As a user signing up with a taken username I see a friendly error | Duplicate username (unique constraint on `profiles.username`) surfaces a non-crashing error message | Desktop, iOS Safari, Android, PWA | P1 | Not yet |
| AUTH-09 | As a user signing in with wrong password I see a friendly error | Supabase auth error surfaced via `setMessage`; no session created | Desktop, iOS Safari, Android, PWA | P1 | Manual |
| AUTH-10 | Login disabled when Supabase not configured | If no url/anonKey, sign in/up throws "not configured on this deploy" instead of crashing | Desktop, iOS Safari, Android, PWA | P2 | Partial |

## B. Guest mode & local persistence

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| GUEST-01 | As a visitor I can continue as a guest | "Continue as guest" sets guest mode, dismisses auth panel, routes to picks; choice persisted in `localStorage` (`wc26.competition.guestMode`, `authDismissed`) | Desktop, iOS Safari, Android, PWA | P0 | Manual |
| GUEST-02 | As a guest my picks persist across reloads | Picks stored in local state survive reload without auth; `My Picks` re-renders saved selections | Desktop, iOS Safari, Android, PWA | P0 | Manual |
| GUEST-03 | As a guest I can build a local default bracket | "Local default bracket" reflects current `allPicks()`; pick count shown; duplicate/invalid picks normalized out | Desktop, iOS Safari, Android, PWA | P1 | Partial (normalize Automated) |
| GUEST-04 | Guest → login pick migration | After login, locally-built picks remain available as the "Local default bracket" and can be submitted to a group (localStorage is auth-independent) | Desktop, iOS Safari, Android, PWA | P0 | Partial |
| GUEST-05 | Guest banner reappears appropriately | When guest mode + dismissed, a compact guest banner renders instead of full auth panel; user can re-open auth | Desktop, iOS Safari, Android, PWA | P2 | Manual |
| GUEST-06 | Private/Incognito storage failure is non-fatal | If `localStorage` writes throw (Safari private mode), app does not crash; defaults applied (try/catch around all storage) | iOS Safari, Desktop | P1 | Partial (guards present; runtime Manual) |

## C. Create private group

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| GRP-01 | As a logged-in user I can create a private group | 3-step flow; requires group name (>= 2 chars) and passphrase (>= 8 chars); Create button disabled until both valid | Desktop, iOS Safari, Android, PWA | P0 | Manual (validation logic visible; RPC Manual) |
| GRP-02 | Group-created screen shows code + join URL | After creation: "Group Created" screen shows generated `word-word-1234` code and `/join/<code>` URL; offers bracket submission as step 3 | Desktop, iOS Safari, Android, PWA | P0 | Manual |
| GRP-03 | Passphrase is stored hashed, never plaintext | `create_private_group` RPC hashes via `crypt(..., gen_salt('bf'))`; only `passphrase_hash` + `passphrase_hint='set'` stored | Desktop (DB) | P0 | Automated (migration asserts hash usage) |
| GRP-04 | Required-field validation messages | Empty name → "Enter a group name."; empty passphrase → "Enter a passphrase."; short passphrase → "at least 8 characters."; both empty → combined message | Desktop, iOS Safari, Android, PWA | P1 | Manual |
| GRP-05 | Creator auto-joins their own group | Creating a group inserts a `group_members` row for the creator; group appears in "Your groups" immediately | Desktop, iOS Safari, Android, PWA | P0 | Manual |
| GRP-06 | RPC-missing fallback path | If `create_private_group` RPC is absent, client falls back to direct insert + membership and shows "apply latest migration" notice (no crash) | Desktop | P2 | Partial (path present; runtime Manual) |
| GRP-07 | Group code uniqueness | DB enforces unique `code` with format check `^[a-z]+-[a-z]+-[0-9]{4}$`; collision surfaces an error rather than silent overwrite | Desktop (DB) | P2 | Not yet (no collision test) |
| GRP-08 | Group name length bounds | Name 2-80 chars enforced (DB check); over/under-length rejected with friendly error | Desktop, iOS Safari, Android | P2 | Not yet |

## D. Join by code & deep link `/join/<code>`

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| JOIN-01 | Join a group via code + passphrase | Valid code format + correct passphrase adds membership; group becomes active; "Joined group" notice shown | Desktop, iOS Safari, Android, PWA | P0 | Partial (format Automated; join Manual) |
| JOIN-02 | Deep link `/join/<valid-code>` while logged out | Code detected, stored as `activeCode`, auth panel forced; notice "Sign in to join this private group"; URL stripped to base + `#/picks` | Desktop, iOS Safari, Android, PWA | P0 | Partial (`extractJoinCodeFromPath`/`buildPostJoinPath` Automated; landing Manual) |
| JOIN-03 | Deep link `/join/<valid-code>` while logged in | Pending code consumed automatically (`consumePendingJoinCode`) and membership attempted silently | Desktop, iOS Safari, Android, PWA | P0 | Partial |
| JOIN-04 | Deep link with subpath prefix | `/wc2026-tracker/join/<code>` resolves base path to `/wc2026-tracker/` and extracts code correctly | Desktop, PWA | P1 | Automated |
| JOIN-05 | Invalid code format rejected | `silverotter4821`, `silver-otter-821`, empty → "Code format must look like silver-otter-4821"; no network call | Desktop, iOS Safari, Android | P0 | Automated |
| JOIN-06 | Invalid `/join/<garbage>` deep link | Non-matching code sets `invalidJoinCode` + notice "Invite link looks invalid"; URL stripped; no crash | Desktop, iOS Safari, Android | P1 | Partial (`extractJoinCodeFromPath` returns null Automated; UI Manual) |
| JOIN-07 | Unknown (well-formed) code | Code passes format but not found in DB → RPC raises "Invalid code" → mapped to "Join code not found. Check the invite and try again." | Desktop, iOS Safari, Android | P0 | Partial (mapping logic present; DB Manual) |
| JOIN-08 | Missing passphrase on protected group | UI blocks submit with "Passphrase is required to join this private group."; RPC also raises "Passphrase required" → "Group passphrase is required to join." | Desktop, iOS Safari, Android | P0 | Partial |
| JOIN-09 | Wrong passphrase | RPC compares `crypt(input, hash)`; mismatch → "Invalid passphrase" → "Passphrase is incorrect. Ask the group owner..." | Desktop, iOS Safari, Android | P0 | Partial (migration compare Automated; e2e Manual) |
| JOIN-10 | Join while logged out (manual code entry) | Entering code without session stores it and shows "Sign in to finish joining"; no error thrown | Desktop, iOS Safari, Android | P1 | Partial |
| JOIN-11 | Membership sync race | If insert succeeds but membership not yet visible, user sees "access is still syncing. Try again" instead of false success | Desktop | P2 | Not yet |
| JOIN-12 | Re-joining a group already a member of | `on conflict do nothing`; idempotent; no duplicate membership; no error | Desktop | P2 | Not yet |

## E. Private access control (RLS)

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| RLS-01 | Non-members cannot read a group | `groups_select_members_only` via `is_group_member(id)`; non-member SELECT returns 0 rows | Desktop (DB) | P0 | Manual |
| RLS-02 | Non-members cannot read members/brackets | `group_members`/`group_brackets` SELECT gated by `is_group_member`; non-member sees nothing | Desktop (DB) | P0 | Manual |
| RLS-03 | Users can only insert their own membership | `group_members_insert_self` requires `auth.uid() = user_id` | Desktop (DB) | P0 | Manual |
| RLS-04 | Users cannot delete memberships | `group_members_delete_none` (`using false`) blocks all deletes | Desktop (DB) | P1 | Not yet |
| RLS-05 | Bracket insert/update restricted to self + member | `group_brackets_insert_self`/`update_self` require `auth.uid()=user_id` AND `is_group_member` | Desktop (DB) | P0 | Automated (migration policy asserted) + Manual e2e |
| RLS-06 | Only creator can update group settings | `groups_update_creator_only` requires `auth.uid() = created_by` | Desktop (DB) | P1 | Not yet |
| RLS-07 | No RLS infinite recursion | `is_group_member` SECURITY DEFINER avoids self-referential policy recursion (regression from `20260528_fix_group_members_rls.sql`) | Desktop (DB) | P0 | Manual |
| RLS-08 | RLS denial surfaces friendly message | `permission denied` / `row-level security` errors mapped to "You do not have access to that group yet." (or join-specific variant) | Desktop, iOS Safari | P1 | Partial (mapping present; trigger Manual) |
| RLS-09 | Profiles are private to owner | `profiles_select_self` — a user cannot read another user's profile row directly (leaderboard reads usernames via member-scoped batch lookup) | Desktop (DB) | P1 | Manual |

## F. One bracket per user per group

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| BRK-01 | A user has at most one bracket per group | `group_brackets` PK `(group_id, user_id)`; second insert raises unique violation | Desktop (DB) | P0 | Manual (constraint), Partial (error mapping) |
| BRK-02 | Duplicate submission shows friendly error | Second submit → "You already submitted one bracket to this group. One submission per user is enforced." | Desktop, iOS Safari, Android | P0 | Partial (mapping in `toCompetitionError` + UI; e2e Manual) |
| BRK-03 | Independent brackets across different groups | Same user can submit one bracket each to multiple groups (PK is composite) | Desktop | P1 | Not yet |
| BRK-04 | Submission requires a selected group | Submit blocked / "Select a group first" when no `activeGroup` | Desktop, iOS Safari, Android | P1 | Partial |
| BRK-05 | Submission requires >= 1 valid pick | Empty/normalized-empty picks → "Add at least one pick before submitting"; submit button disabled at 0 picks | Desktop, iOS Safari, Android | P1 | Partial (normalize Automated; button-state Manual) |
| BRK-06 | Editing an existing bracket | Current UI only inserts (no update path). Decide intended behavior: either expose update (RLS allows it) or document one-shot submission. Acceptance: behavior is consistent and messaged. | Desktop | P2 | Not yet (gap) |

## G. Lock windows & bracket selection/submission

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| LOCK-01 | Pre-tournament: bracket open | Before first group kickoff → phase `pre-tournament`, `bracketLocked=false` | Desktop, iOS Safari, Android | P0 | Automated |
| LOCK-02 | During group stage: bracket locked | At/after first group kickoff and within group window → `group-stage-live`, `bracketLocked=true` | Desktop, iOS Safari, Android | P0 | Automated |
| LOCK-03 | Gap window (after group, before R32): open | Between group end (+2h) and first R32 kickoff → `between-group-and-r32`, `bracketLocked=false` | Desktop, iOS Safari, Android | P0 | Automated |
| LOCK-04 | R32 live: locked | At/after first R32 kickoff → `r32-live`, `bracketLocked=true` | Desktop, iOS Safari, Android | P0 | Automated |
| LOCK-05 | Boundary: exactly at unlock moment still locked | At group-end+2h exactly → still `group-stage-live`/locked; 1ms later → unlocked | Desktop | P0 | Automated |
| LOCK-06 | Boundary: exactly at R32 kickoff locks | At R32 kickoff timestamp exactly → `r32-live`/locked | Desktop | P0 | Automated |
| LOCK-07 | Submit blocked while locked | Submitting during a locked phase → "Bracket locked (<phase>)"; submit button disabled | Desktop, iOS Safari, Android | P0 | Partial (lock logic Automated; UI gating Manual) |
| LOCK-08 | Empty/malformed schedule | No schedule data → defaults to `pre-tournament`/unlocked (no crash) | Desktop | P1 | Partial (covered by code default; explicit test Not yet) |
| LOCK-09 | Live transition refresh | If a user keeps the page open across a lock boundary, the next paint reflects the new lock state | Desktop, PWA | P2 | Not yet |
| LOCK-10 | Timezone integrity | Lock decisions use UTC `kickoff_utc`; behavior identical regardless of device timezone | Desktop, iOS Safari (TZ change) | P1 | Partial (UTC parsing Automated; device-TZ Manual) |

## H. Leaderboard & score integrity

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| SCORE-01 | Score counts only correct, de-duplicated picks | Duplicate pairs (e.g. A/B and B/A) counted once; reversed-order results matched; invalid choices dropped | Desktop | P0 | Automated |
| SCORE-02 | Draw outcomes scored correctly | `score_a == score_b` → `draw`; matches pick `choice='draw'` | Desktop | P0 | Automated |
| SCORE-03 | Reversed-key result orientation | Result stored as `B__vs__A` correctly maps winner back to user's `team_a`/`team_b` orientation | Desktop | P1 | Automated |
| SCORE-04 | Missing/incomplete results don't score | Non-finite scores or missing match → pick contributes 0 (pending) | Desktop | P1 | Automated |
| SCORE-05 | Leaderboard ordering | Sorted by score desc, then username asc; ties stable | Desktop, iOS Safari, Android | P1 | Partial (logic readable; rendered order Manual) |
| SCORE-06 | Leaderboard shows usernames not IDs | Usernames resolved via member-scoped profile lookup; unknown → "Player" | Desktop | P1 | Manual |
| SCORE-07 | Empty leaderboard state | No submissions → "No submissions yet." | Desktop, iOS Safari, Android | P2 | Manual |
| SCORE-08 | Scores recomputed from authoritative data | Leaderboard recomputes via `scoreBracket(picks, data)` rather than trusting stored `score` | Desktop | P1 | Partial (call present; e2e Manual) |

## I. Network / resilience / error handling

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| NET-01 | Supabase unreachable on init | `initCompetition` failure renders "Competition unavailable: <msg>" instead of breaking the page | Desktop, iOS Safari, Android, PWA | P0 | Manual |
| NET-02 | Join/submit network failure | Rejected promise surfaces friendly message via `setMessage`; buttons reset `aria-busy`/disabled in `finally` | Desktop, iOS Safari, Android | P1 | Manual |
| NET-03 | Offline / PWA service worker | With `sw.js` cached shell, app loads offline for static views; competition controls degrade gracefully when offline | iOS Safari (PWA), Android, Desktop | P1 | Partial (smoke verifies `sw.js` 200; offline Manual) |
| NET-04 | Slow network busy states | All async buttons set busy state and re-enable on completion/error (no double-submit) | Desktop, iOS Safari, Android | P2 | Manual |
| NET-05 | Generic error fallback | Unknown errors fall back to "Competition request failed" (never raw stack/empty) | Desktop | P2 | Partial |

## J. Platform / PWA / cross-browser specifics

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| PLAT-01 | iOS Safari standalone PWA launch | Installed PWA opens at `start_url`; manifest valid (name, start_url, icons); status bar/safe-area not clipping controls | iOS Safari (PWA) | P0 | Partial (manifest shape Automated; visual Manual) |
| PLAT-02 | Deep link opens in installed PWA | `/join/<code>` from Messages/Mail opens app and reaches join flow (or Safari fallback) | iOS Safari (PWA), Android | P1 | Manual |
| PLAT-03 | iOS Safari private mode storage | App functional with localStorage throwing; no white screen | iOS Safari | P1 | Partial |
| PLAT-04 | Desktop browser matrix | Chrome/Edge/Firefox render auth + group + bracket controls identically; no console errors | Desktop | P1 | Manual |
| PLAT-05 | Add-to-home-screen icons | 192/512/maskable icons present and load (200) | iOS Safari, Android | P2 | Automated (smoke) |
| PLAT-06 | Service worker update | New deploy invalidates stale cached shell; user gets latest `app/*.js` after refresh | Desktop, PWA | P2 | Not yet |
| PLAT-07 | Touch targets / input types | Passphrase fields use `type=password`; join/passphrase inputs have aria-labels; tap targets usable on mobile | iOS Safari, Android | P2 | Partial (markup present; UX Manual) |
| PLAT-08 | No regression in core views | Existing views (predictions, My Picks summary/export, matchup navigation) still work with competition section mounted | Desktop, iOS Safari, Android, PWA | P0 | Partial (smoke covers asset/data integrity; view-level Manual) |

## K. Regression guards (existing functionality)

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Automation status |
|----|-------|---------------------|-------------|----------|-------------------|
| REG-01 | Shipping assets load | `/`, `index.html`, manifest, sw, styles, main.js, icons all return 200 | Desktop | P0 | Automated (smoke) |
| REG-02 | Data payload shapes intact | meta/teams(48)/group_matchups(A-L,6 each)/schedule/actual_results/players + phase-2 datasets valid | Desktop | P0 | Automated (smoke) |
| REG-03 | My Picks summary + export | Accuracy stat cards compute; "Export picks (JSON)" downloads current picks | Desktop, iOS Safari, Android | P1 | Manual |
| REG-04 | Matchup navigation from picks | Clicking a pick row routes to `#/matchup/...` | Desktop, iOS Safari, Android | P2 | Manual |
| REG-05 | HTML escaping / XSS guard | Group names, usernames, codes, join URLs are HTML-escaped before injection | Desktop | P1 | Not yet (no explicit escaping test) |

## Coverage gaps to prioritize next

1. **End-to-end auth + group + bracket flow** against a live preview (currently blocked on migration apply) — covers most `Manual` P0s above.
2. **Duplicate-bracket DB enforcement** (BRK-01) and **independent brackets across groups** (BRK-03).
3. **RLS negative tests** (RLS-01..09) using two distinct authenticated users.
4. **Bracket edit/update decision** (BRK-06) — the UI inserts only; clarify product intent.
5. **XSS/escaping unit test** (REG-05) for `escapeHtml` on group/user-controlled strings.
6. **Live lock-window transition** while page is open (LOCK-09).
