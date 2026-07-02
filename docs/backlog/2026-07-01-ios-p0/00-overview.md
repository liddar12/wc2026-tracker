# iOS P0 Release — Gate-3 Overview (PM master doc)

**Release:** 2026-07-01 iOS design overhaul — Track A P0 (A1–A7) + FLAG P0 + circular bracket wheel (A19), shipped as **ONE batched deploy**.
**Spec:** `docs/superpowers/specs/2026-07-01-ios-design-overhaul-design.md`
**HARD CONSTRAINT (owner's approval condition):** no existing data or feature is removed. Everything is presentation-refinement or additive. Every epic carries no-regression acceptance criteria; the decided-match rework re-frames the same model numbers, the wheel is an additive toggle, empty states add honesty without deleting fallbacks.
**Pipeline authorization (owner, 2026-07-01):** fully autonomous — the only gate anywhere is the 4-step regression suite at 100% green (gated on exit codes). Auto-deploy at green, prod-verify, rollback stated.

## Epics

| Epic | File | Stories | Tasks | AC automation |
|---|---|---|---|---|
| E1 Typography reset (A1) | [E1-typography.md](E1-typography.md) | 3 | 12 | ≥90% |
| E2 Names + enum leaks (A2+A3) | [E2-names-enums.md](E2-names-enums.md) | 2 | 6 | ~90% (27/30) |
| E3 Decided/live match state (A4+A5) | [E3-match-state.md](E3-match-state.md) | 3 | 8 | ~95% (37/39) |
| E4 Dark-hero contrast + empty states (A6+A7) | [E4-contrast-empty.md](E4-contrast-empty.md) | 4 | 7 | ~93% (25/27) |
| E5 Crafted flags, no emoji (FLAG P0) | [E5-flags.md](E5-flags.md) | 4 | 6 | ~95% |
| E6 Bracket wheel (A19) | [E6-wheel.md](E6-wheel.md) | 4 | 8 | ~93% |
| **Total** | | **20** | **47** | **≥90% overall** |

Review: 2 adversarial critics (QA coverage; constraints/conflicts) found 17 issues, 7 blocking — all 7 fixed into the epic files above.

## Canonical merge order (single source of truth, mirrored in every epic)

**E4 → E3 → E1 → E2 → E5 → E6**

Documented exceptions (additive lib exports, explicitly sequenced in the files):
- `app/lib/team-names.js`: **E2 T1 (`fifaCode`) → E4 T3.1 (`slotLabel`)**; E6 is a read-only consumer, never edits it.
- `app/components/projected-bracket-tree.js`: **E2 T3 → E6 T1.2/T3.1** (E6 rebases on E2's slot-name text change).
- Unresolved-slot chain: **E4 T3.1 `slotLabel()` (pure lib) → E5 T6 `flagPlaceholder()` badge + venue-detail flag wiring → E4 T3.2 (adjacent human copy)**. One badge (`.flag-tbd`, owned by E5), one slot regex (`isSlotPlaceholder` in `app/bracket-resolver.js`).

## Sprint plan (build on integration branch `release/ios-p0`; NOTHING merges to main until the final batched release)

Each sprint exits only when the full 4-step gate is 100% green on the integration branch; red → bug-fix loop (fix agents separate from build agents), never a merge.

**Sprint 1 — Foundations & correctness (4 build agents, isolated worktrees):**
- Agent `libs`: E2 T1 (`fifaCode`) + E2 T4 (`stage-labels.js`) + E4 T3.1 (`slotLabel`) — pure lib + tests.
- Agent `E4`: T1.1/T1.2 (hero tokens), T2.1/T2.2 (position-ratings), T4.1/T4.2 (today section).
- Agent `E3`: all 8 tasks (matchup-detail + `result-vs-model.js` + `model-verdict.js` + status matrix).
- Agent `E6-geo`: T1.1 pure wheel geometry (new files only).
- Merge order into `release/ios-p0`: libs → E4 → E3 → E6-geo.

**Sprint 2 — Typography sweep (E1, up to 6 agents):**
- Phase a (1 agent, owns `app/styles.css`): T1.1→T1.2→T1.4→T1.3 + T2.1, then styles.css freezes.
- Phase b (5 parallel agents, disjoint views): T2.2 Home/Schedule · T2.3 brackets · T2.4 matches/matchup · T2.5 venues/team/group · T2.6 boot/accuracy/status/settings.
- Phase c: T3.1/T3.2 QA lockfiles.

**Sprint 3 — Names, enums & flags (sequenced on venue-detail/large-match-card):**
- E2 T2→T3 (hero card codes + wrap sweep), E2 T5→T6 (stage-label rollout + leak net), E5 T1→T2 (GB fix) → E5 T3/T4 (audit + roster lock) → E5 T5 (`flagCircle`) → E5 T6 (`flagPlaceholder` + venue-detail) → E4 T3.2 (venue-detail human copy).

**Sprint 4 — Bracket wheel (E6):**
- T1.2 (toggle) → T2.1 (populate; imports `fifaCode` + `flagCircle`) → T2.2/T3.1 → T3.2 (re-render resilience) → T4.1/T4.2 (themes + a11y).

**Release:** end-to-end QA + smoke with 6+ agents on `release/ios-p0` (every acceptance criterion; must be 100%) → batched merge to main race-safe (`git pull --ff-only`, merge, push) → Netlify auto-deploy → prod verify in Chrome on worldcup2026.j5lagenticstrategy.com (typography, decided/live matchup, dark hero, flags, wheel toggle) → rollback ready.

**Rollback:** one line — `git revert -m 1 <release-merge-sha>` and push.

## QA integration map (all new tests ride existing gate globs; `tests/playwright.config.mjs` untouched — webServer stays ThreadingHTTPServer)

- **Step 3 (`node --test tests/feature/*.mjs`):** NEW `typography-scale`, `e2-stage-labels`, `matchup-decided-state`, `e4-contrast-empty`, `e5-crafted-flags`, `bracket-wheel-geometry`; EXTENDED `r13-team-names`, `rj30-winprob-render`, `bracket-third-place`.
- **Step 4 (Playwright `tests/ux`):** NEW `typography.spec` (16-route audit, light+dark), `e2-names-enums.spec`, `matchup-state.spec`, `e4-dark-hero.spec`, `e4-empty-states.spec`, `e5-flags.spec`, `bracket-wheel.spec`; EXTENDED `projected-bracket.spec` (tree-default lock).
- **Steps 1–2** (validate_data, smoke) untouched by this release; must stay green.
- Regression sentinels that must stay green unmodified: `knockout-matchup.spec`, `rj30-winner-highlight.spec`, `knockout-detail-finals.test`, `home-order.test`, `hidden-features.test`, `live-minute-persist.test`.

Build-agent rule: worktree agents run gate steps 1+3 locally plus `npx playwright test --list` (syntax check only — parallel Playwright runs would collide on the webServer port); the integration agent runs the FULL 4-step gate single-instance.

## Risks (from critics, minors folded in)

1. `app/styles.css` is touched by every epic — the canonical order + per-sprint single ownership is the mitigation; E1's de-caps allowlist re-verified against post-E4/E3 css.
2. E1 T1.4 font swap (Barlow → SF stack) is the largest visual delta — isolated as its own revertable task.
3. E2 T6's leak net is red until E2 T5 lands — same merge, ordered.
4. `large-match-card.js` copy changes slightly (canonical short stage labels) — presentation-only, noted for the owner.
5. E6 taps during `renderView()` innerHTML rebuilds — module-state OVERRIDES + `toPass` retry pattern per BR-6 precedent.
