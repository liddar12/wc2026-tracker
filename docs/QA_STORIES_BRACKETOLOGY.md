# QA User Stories & Acceptance Criteria — March-Madness-Style Bracketology (WC2026)

Scope: "NCAA March-Madness-style bracketology" applied to the WC2026 knockout bracket
(`app/views/bracket-view.js`: R32 → R16 → QF → SF → Final → Champion). The product goal
is a group competition where each user fills out their own bracket prediction, submits
**one bracket per group**, and is scored against actual results, with a per-group
leaderboard.

> **Non-live / planning artifact.** This document is QA specification only. It does not
> change app behavior. Where current code already constrains behavior, it is called out
> in **Notes** as `CURRENT:` vs the recommended `TARGET:` so QA can distinguish a defect
> from an unbuilt requirement.

## How to read this doc

- **ID** — stable reference for traceability (e.g. in test runners / Linear).
- **Priority** — P0 (blocker / must-ship), P1 (high), P2 (medium), P3 (nice-to-have).
- **Platform(s)** — iOS Safari (mobile web), PWA (installed standalone), Desktop (Chromium/Firefox/Safari).
- Acceptance criteria are written **Given / When / Then** so they map directly to test cases.

---

## Reference: current implementation facts (for QA grounding)

| Area | Current behavior in code |
| --- | --- |
| Bracket rendering | `bracket-view.js` is **read-only**: it seeds R32 (from `qualified_for_r32` or a projection), auto-projects later rounds via composite gap, colors correct/wrong nodes, and a node tap opens a model win-probability popup. There is **no per-node winner-picking UI** yet. |
| Where picks come from | A submitted "bracket" is built from `allPicks()` (the user's match picks) or a named draft saved in `localStorage` (`listBracketDrafts`, `createBracketDraft`). |
| Submit | `saveBracketForActiveGroup` requires ≥1 pick, computes a score, and **inserts** into `group_brackets`. Partial brackets are currently accepted. |
| One-per-group | Enforced by a unique constraint (`group_brackets_pkey` / duplicate-key) on insert. There is **no edit/update path** today — a second submit fails with "You already submitted one bracket to this group." |
| Lock | `deriveLockState`: open `pre-tournament` and in the `between-group-and-r32` gap; **locked** during `group-stage-live` and once `r32-live` (first R32 kickoff). |
| Scoring | `scoreBracket` awards **+1 per correct pick**, no round multipliers. Recomputed on read in `fetchLeaderboard`. |
| Leaderboard | Sorted by `score` desc, then `username` alphabetically (the only current tie-breaker). |

---

## User Stories

| ID | Story | Acceptance Criteria | Platform(s) | Priority | Notes |
| --- | --- | --- | --- | --- | --- |
| BKT-001 | As a player, I want to build a full bracket by picking winners round-by-round (R32 → Champion) so my prediction reflects my own calls, not the model's. | **Given** I am signed in and viewing the bracket, **when** I tap a team node in R32, **then** that team is selected as the winner of that matchup and visibly highlighted as *my pick*. **And** the winner I pick advances into the correct R16 slot, replacing any projected/auto name. **And** I can repeat this through R16, QF, SF, Final to crown a Champion. **And** my picks persist across reloads/navigation before submit. **And** picking a new winner for an already-decided upstream match invalidates/clears downstream picks that depended on the replaced team (see BKT-014). | iOS Safari, PWA, Desktop | P0 | CURRENT: bracket view is read-only (tap = model popup) and brackets are derived from `allPicks()`. TARGET: interactive per-node selection that writes bracket picks. This is the core gap to build. |
| BKT-002 | As a player, I want clear visual distinction between my picks, model projections, and actual results so I never confuse what I chose with what's predicted or what happened. | **Given** a rendered bracket, **then** my chosen winners render in a distinct "my pick" style; **and** model-projected names (where I haven't picked) render with the dashed/`projected` style; **and** completed matches color green (correct) / red (wrong) per existing logic; **and** a legend explains all states; **and** color is never the *only* signal (icon/label/aria for accessibility). | iOS Safari, PWA, Desktop | P1 | Existing legend covers projected/correct/wrong; extend it for "my pick" and ensure non-color cues. |
| BKT-003 | As a player, I want to submit exactly one bracket to a group so the competition is fair. | **Given** I have a bracket and an active group, **when** I submit, **then** it is stored against `(group_id, user_id)` and appears on the leaderboard. **And when** I attempt a second submit to the same group, **then** I get a clear message "You already submitted one bracket to this group" and no duplicate row is created. **And** the same user may submit one (separate) bracket in each *different* group they belong to. | iOS Safari, PWA, Desktop | P0 | CURRENT: enforced by unique constraint on insert; verify constraint is `(group_id, user_id)` not just PK so multi-group works. |
| BKT-004 | As a player, I want to edit my bracket freely until lock so I can refine picks before it matters. | **Given** the bracket is **open** (`pre-tournament` or `between-group-and-r32`), **when** I change picks and re-submit, **then** my stored bracket is updated in place (upsert), not rejected as a duplicate, and the leaderboard reflects the latest version. **And** the UI shows a "last saved" timestamp. **And** re-submitting an unchanged bracket is a no-op success. | iOS Safari, PWA, Desktop | P0 | CURRENT defect vs target: submit is INSERT-only, so editing after first submit fails with duplicate-key. TARGET: upsert on `(group_id,user_id)` while unlocked. Critical to reconcile. |
| BKT-005 | As a player, I want my bracket to lock at the first R32 kickoff so no one can change picks after knockout play starts. | **Given** the current time is at/after the first R32 kickoff (`phase = r32-live`) or during `group-stage-live`, **then** Submit/Edit controls are disabled with a message naming the lock phase; **and** server-side submit is rejected even if the client is bypassed; **and** a previously submitted bracket remains visible read-only. **And** while in the `between-group-and-r32` gap, editing is still allowed. | iOS Safari, PWA, Desktop | P0 | CURRENT: client disables via `lockState.bracketLocked`; verify a **server-side** (RLS/RPC) lock exists so a crafted request can't write after lock. |
| BKT-006 | As a player, I want a default/auto bracket I can adopt or override so I'm not forced to fill 31 matchups manually. | **Given** I have made no picks, **when** I open bracket setup, **then** an auto bracket (model-projected winners, or my existing `allPicks()`) is offered as a starting point clearly labeled "auto"; **and** I can submit it as-is or customize any node before submitting; **and** once I change any node, it is labeled "customized". | iOS Safari, PWA, Desktop | P1 | Builds on existing "Local default bracket" draft + composite-gap projection. |
| BKT-007 | As a player, I want named bracket drafts so I can prepare a bracket per group before submitting. | **Given** I am signed in, **when** I create a named draft, **then** it is saved to local storage, selectable in the draft dropdown, and its pick count is shown; **and** submitting uses the selected draft; **and** drafts survive reload. **And** a draft with 0 picks cannot be submitted (Submit disabled). | iOS Safari, PWA, Desktop | P2 | CURRENT behavior matches (`createBracketDraft`, `listBracketDrafts`, submit disabled when 0 picks). |
| BKT-008 | As a player, I want a leaderboard for my group so I can see my rank vs others. | **Given** a group with submissions, **then** the leaderboard lists each member's username and score, sorted highest score first; **and** my own row is identifiable; **and** scores update when new actual results arrive (see BKT-013); **and** members with no submission either are excluded or shown as "no bracket" (define one — recommend **excluded** until they submit). | iOS Safari, PWA, Desktop | P0 | CURRENT: sorted score desc then username; usernames resolved via `profiles`. |
| BKT-009 | As a player, I want fair, deterministic tie-breakers on the leaderboard so ties resolve consistently. | **Given** two brackets with equal total score, **then** they are ranked by the documented tie-break order (see Scoring Spec §Tie-breakers): (1) most correct picks in the **latest completed round**, (2) most correct Champion/Final picks, (3) earliest `updated_at` (submitted-sooner wins), (4) username alphabetical as final deterministic fallback. **And** the same inputs always produce the same order. **And** the UI may show "T-2" style tied ranks while still ordering deterministically. | iOS Safari, PWA, Desktop | P1 | CURRENT: only username alphabetical. TARGET: layered tie-breakers below. |
| BKT-010 | As a player, I want to know whether I must complete the bracket through the Champion before submitting, or whether a partial bracket is allowed. | **Two interpretations below; recommend (A).** **(A) Completeness required:** **Given** any knockout matchup is unpicked, **when** I press Submit, **then** Submit is blocked with a message listing the rounds/slots still missing, and only a bracket with a Champion picked can be submitted. **(B) Partial allowed:** **Given** at least one pick exists, **when** I submit, **then** it is accepted; unpicked matchups simply score 0 and the UI warns "X of 31 picks made". | iOS Safari, PWA, Desktop | P0 | CURRENT = (B): submit needs only ≥1 pick. **Recommendation: adopt (A) "complete-to-Champion required"** for a true March-Madness pool — it makes scores comparable, supports round multipliers cleanly, and matches user expectation. Keep (B) only as an explicit "casual mode" if product wants it. |
| BKT-011 | As a player, I want validation feedback while building so I always know how close my bracket is to submittable. | **Given** I am building, **then** a progress indicator shows picks made / total required (e.g. "27 / 31"); **and** each incomplete round is flagged; **and** Submit is enabled only when validity rules (BKT-010 chosen interpretation) are met; **and** an attempt to submit an invalid bracket scrolls to / highlights the first missing slot. | iOS Safari, PWA, Desktop | P1 | Total knockout matches = 31 (16+8+4+2+1) for R32 bracket; confirm against final 48-team format seeding. |
| BKT-012 | As a player, I want a transparent scoring model with round multipliers so later-round correct picks are worth more, like classic bracket pools. | **Given** the Scoring Spec below, **when** actual results post, **then** each correct pick earns `base × roundMultiplier`; **and** my displayed score equals the sum across all scored rounds; **and** the breakdown per round is viewable; **and** identical brackets vs identical results always produce identical scores. | iOS Safari, PWA, Desktop | P0 | CURRENT: flat +1 per correct pick. TARGET: weighted per Scoring Spec. |
| BKT-013 | As a player, I want my score to recompute automatically when new results arrive so the leaderboard stays current without resubmitting. | **Given** new `actualResults` are published for a stage, **when** the leaderboard/bracket is next loaded (or refreshed), **then** every bracket is re-scored against the latest results and ranks update; **and** no user action is required; **and** previously awarded points for earlier rounds are unchanged unless a result correction occurs (see BKT-019). | iOS Safari, PWA, Desktop | P0 | CURRENT: `fetchLeaderboard` re-scores on read via `scoreBracket`. Verify caching/refresh path on PWA. |
| BKT-014 | As a player, I want re-seeding/advancement to behave sensibly when actual results differ from my picks so scoring is unambiguous. | **Given** I picked Team X to win R32 and reach SF, **but** Team X actually lost in R32, **then** my downstream picks involving Team X in later rounds are scored as **incorrect** (the matchup I predicted never occurred); **and** scoring evaluates each of my predicted matchups against whether that exact matchup+winner occurred in actual results (per `findActualOutcome`); **and** the visual bracket may show *two layers*: actual advancement vs my predicted advancement, without overwriting my recorded picks. | iOS Safari, PWA, Desktop | P1 | This is the classic "bracket busted" case. Define scoring as "pick is correct only if that exact matchup occurred and I named the winner". Confirm `scoreBracket` semantics match (it keys on team_a/team_b pair). |
| BKT-015 | As a player, I want the bracket to be usable and legible on iOS Safari so I can play on my phone. | **Given** iOS Safari (incl. notch/safe-area and 100vh quirks), **then** the SVG bracket is horizontally scrollable without breaking layout; **and** tap targets meet ≥44×44pt; **and** pinch/zoom or fit-to-width works; **and** no text is clipped at the rightmost (Champion) column; **and** momentum scroll does not trigger pull-to-refresh accidentally. | iOS Safari | P1 | SVG width = `COL_W * 6 = 1020px`; must scroll on narrow screens. Watch `pull-to-refresh.js` interaction. |
| BKT-016 | As a player, I want the installed PWA to behave like the web app for bracket play, including offline draft editing. | **Given** the app is installed as a PWA, **then** bracket building works in standalone display mode; **and** drafts edited offline persist locally and sync/submit when back online; **and** a submit attempted offline shows a clear "you're offline" message and queues or blocks gracefully (define — recommend **block with retry**); **and** lock state is re-evaluated on reconnect before allowing submit. | PWA, iOS Safari | P1 | Drafts are localStorage-based, so offline editing is feasible; submit requires network + valid session. |
| BKT-017 | As a player on desktop, I want full keyboard and pointer support for building my bracket. | **Given** desktop with mouse and keyboard, **then** every pickable node is focusable and selectable via Enter/Space; **and** focus order follows reading order R32→Champion; **and** hover shows the model popup affordance; **and** the bracket is responsive from ~1024px up to wide screens without overlap. | Desktop | P2 | Accessibility: SVG `<g>` nodes need `role`/`tabindex`/`aria-label`. |
| BKT-018 | As a member of a group with only myself, I want bracketology to still work so a solo/practice group is valid. | **Given** a group where I am the only member, **when** I submit a bracket, **then** the leaderboard shows just me with my score; **and** ranking/tie-breakers don't error on a single row; **and** no "waiting for others" state blocks scoring. | iOS Safari, PWA, Desktop | P2 | Edge: single-row leaderboard sort + tie-break must not throw. |
| BKT-019 | As a player, I want score recompute to be correct and idempotent when results are added, corrected, or arrive out of order. | **Given** results arrive for SF before a late-posted R16 correction, **when** scoring runs, **then** the final score equals scoring against the complete corrected result set regardless of arrival order; **and** re-running scoring on unchanged data yields the same total (idempotent); **and** a corrected result (e.g. score fix) updates affected points and re-ranks; **and** users are not double-credited. | iOS Safari, PWA, Desktop | P1 | `scoreBracket` iterates picks vs all tiers each run, so it is naturally idempotent; verify against corrections and partial result sets. |
| BKT-020 | As a player who submitted an incomplete bracket before lock, I want defined behavior at lock so I'm scored predictably. | **Given** validity rule (B) partial-allowed is in effect **and** my bracket is incomplete when lock hits, **then** it locks as-is; missing matchups score 0; the UI clearly marks it "incomplete — N picks". **Given** rule (A) complete-required, **then** an incomplete bracket was never submittable, so at lock either (a) my last *complete* submission stands, or (b) I have no entry and am excluded from the leaderboard. | iOS Safari, PWA, Desktop | P0 | Tie this to the BKT-010 decision. If adopting (A), add a pre-lock reminder ("complete your bracket — locks in Xh"). |
| BKT-021 | As a player, I want only valid, de-duplicated picks stored so my bracket can't be corrupted by repeated or self-matchups. | **Given** a submission, **then** picks with empty teams, `team_a === team_b`, or invalid `choice` are rejected/stripped; **and** duplicate matchups (same pair) are de-duplicated; **and** `choice` is one of `team_a`/`team_b` (draws are not valid in knockout). | iOS Safari, PWA, Desktop | P1 | CURRENT: `normalizeBracketPicks` strips invalids and dedupes, but **allows `choice = 'draw'`** — invalid for knockout. TARGET: reject `draw` in knockout brackets. |
| BKT-022 | As a player, I want auth/group gating so brackets are tied to my account and the right group. | **Given** I am a guest (not signed in), **then** I can build/preview a local bracket but cannot submit to a group until I sign in; **and** submit requires a selected active group; **and** errors (RLS/permission, pending membership) surface readable messages. | iOS Safari, PWA, Desktop | P1 | CURRENT: `saveBracketForActiveGroup` throws "Select a group first" / "Login required"; error mapping in `toCompetitionError`. |
| BKT-023 | As a player, I want a head-to-head model reference while picking so I can make informed picks. | **Given** any matchup node, **when** I open its detail, **then** the model's win probability (composite-gap logistic) is shown for both teams; **and** this is advisory only and never auto-changes my pick. | iOS Safari, PWA, Desktop | P3 | CURRENT: `showPredictionPopup` exists; keep it non-destructive to user picks. |
| BKT-024 | As a player, I want my bracket and rank to render quickly and not jank on large brackets. | **Given** a full 31-match bracket, **then** initial render is < 500ms on a mid-tier phone; **and** re-score on results update does not block the main thread noticeably; **and** scrolling the SVG stays smooth (no layout thrash). | iOS Safari, PWA, Desktop | P2 | Perf budget; SVG node count is modest (~62 nodes) so should be achievable. |

---

## Proposed Scoring Spec

A concrete, classic-pool-style scheme with round multipliers. Designed to be deterministic,
idempotent on recompute, and a clean extension of the existing `scoreBracket`.

### Points per correct pick (per round)

| Round | Matches | Points per correct pick | Max round points |
| --- | --- | --- | --- |
| Round of 32 (R32) | 16 | 1 | 16 |
| Round of 16 (R16) | 8 | 2 | 16 |
| Quarterfinals (QF) | 4 | 4 | 16 |
| Semifinals (SF) | 2 | 8 | 16 |
| Final | 1 | 16 | 16 |
| Champion (lifting the trophy) | 1 | 16 | 16 |
| **Total** | **31 picks (+1 champion flag)** | — | **96** |

- This "balanced doubling" (1-2-4-8-16) is the standard March-Madness weighting: each round
  is worth the same in aggregate (16 pts), so depth and breadth are equally rewarded.
- **Champion** is scored separately from the Final match winner so correctly crowning the
  trophy lifter is explicitly rewarded (worth 16). Total possible = **96**.
- **Optional seed/upset bonus (defer to P3):** `+ (seedOfPickedWinner − seedOfOpponent)`
  when a lower seed is correctly picked to win, capped per round. Keep off for v1 to stay
  simple and transparent.

### Correctness rule

A pick is **correct** only if **that exact matchup occurred in actual results AND the user
named the actual winner**. If the predicted matchup never occurs (because an upstream team
lost), the pick scores 0 — there is no partial credit for "right team, wrong round". This
matches the pair-keyed lookup already in `findActualOutcome`.

- Draws are **not** valid outcomes in knockout scoring; a knockout result is the team that
  advances (after extra time/penalties). `choice = 'draw'` must be rejected at submit.

### Recompute / idempotency

- Score = Σ over the user's picks of `correct(pick) ? base × roundMultiplier(pick.round) : 0`.
- Recompute runs against the full current `actualResults` set on every leaderboard/bracket
  load, so it is idempotent and order-independent (late or corrected results converge to the
  same total). No incremental mutation of stored scores is required.
- Store `round` on each pick (or derive it from bracket position) so the multiplier is
  unambiguous; today picks are a flat list keyed only by team pair.

### Tie-breakers (applied in order)

1. **Higher total score** (primary ranking).
2. **More correct picks in the latest completed round** (rewards staying alive deep).
3. **More correct Champion + Final picks** (rewards calling the trophy).
4. **Earlier `updated_at`** (the player who committed sooner ranks higher).
5. **Username alphabetical** (final deterministic fallback — current sole tie-breaker).

Ranks are deterministic for identical inputs. Display may use "T-N" for visual ties while
still ordering rows by the full chain above.

---

## Recommended decisions (summary)

- **Validity (BKT-010): adopt interpretation (A)** — require a complete bracket through the
  Champion before submit. Cleaner scoring, comparable entries, matches user expectation.
  Offer partial (B) only as an explicit opt-in "casual" mode if product insists.
- **Editing (BKT-004): switch submit from INSERT to UPSERT** on `(group_id, user_id)` while
  unlocked, with a server-side lock check. This fixes the current duplicate-key failure on
  re-submit.
- **Scoring (BKT-012): adopt 1-2-4-8-16 round weighting + separate 16-pt Champion** (max 96),
  replacing the flat +1-per-pick model.
- **Knockout picks: reject `choice = 'draw'`** at submit (BKT-021).
- **Leaderboard membership (BKT-008): exclude non-submitters** until they submit.

---

## Traceability notes

- Core build gap: **interactive winner-picking in `bracket-view.js`** (BKT-001) — today the
  view is read-only and brackets are derived from match picks / drafts.
- Code-confirmed behaviors are marked `CURRENT:`; recommended changes are marked `TARGET:`.
- Lock semantics come from `deriveLockState` in `app/competition-rules.js`.
- Scoring/normalization come from `app/competition-scoring.js`.
- Submit / leaderboard / drafts come from `app/competition.js` and `app/views/my-picks.js`.
