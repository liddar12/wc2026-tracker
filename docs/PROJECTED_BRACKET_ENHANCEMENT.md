# Projected Bracket — Interaction Enhancement Plan

**Status:** Plan for review · Date: 2026-06-19 · Reference: owner screen-recording of a
zoomable FIFA bracket app.

## Goal (from the owner's answers)
Make our **Projected** tab feel like the reference video: a top **stage nav that
zooms / slides / adjusts** the bracket, while **keeping the current swipe-left/right**.
Add **confidence** (model win-odds per pick) **and what-if** (override a winner, see it
cascade). Build **incrementally**, **upgrading the Projected tab in place**. Stack is
unchanged: vanilla JS, no build, CSS transforms + touch events.

## What we already have to build on
- `bracket-view-r6.js renderProjected(data, source)` — projected bracket per model.
- `buildAutofill` / `resolveSlots` — resolve winners through every round (R32→Final), and
  can **re-cascade from an override map** (powers what-if).
- `forecast.json` (per-team round-reach + `hybrid_strength`) + the model wdl math →
  **per-matchup win %** for confidence.
- `computeGroupStandings` + `buildR32Seeding` (bracket-resolver) → standings→R32 seed
  labels (`1E`, `2A`, `3A/B/C/D/F`) for the GS view.
- Active-model selector (5 models) already wired into the Projected tab.

---

## PHASE 1 — "feels like the video" core (P0; ships fast, low risk)
1. **Connector-line bracket tree.** Replace the plain columns with a real tree
   (R32 → R16 → QF → SF → Final + Third-Place) with SVG/CSS connector lines showing
   who-plays-who as winners advance. Preserves horizontal **swipe** (the canvas scrolls).
2. **Stage selector (GS · R32 · R16 · QF · SF · F).** Pinned top nav; tapping
   **snaps/scrolls** the canvas to that round (and sets a sensible zoom for it). `GS`
   shows the **standings → R32 seeding** view (left standings feed right R32 slots).
3. **Zoom control (buttons).** −/＋/fit buttons on the top nav: "fit" zooms out to the
   whole tree, a round tap zooms in. (Button-driven zoom now; pinch gesture in Phase 2.)
4. **Confidence visualization.** Every projected pick shows the model's win % (badge +
   color intensity), so the bracket reads as a confidence map. Uses the active model.

**Why Phase 1 first:** delivers the video's *look + navigation + confidence* using CSS
transforms and our existing resolve/forecast data — no risky gesture engine. Reuses the
Projected tab; model/source selector and Live|Projected stay.

## PHASE 2 — gesture + interactivity (P1)
5. **Pinch-zoom + drag-pan canvas.** True two-finger zoom and momentum pan over the
   bracket (touch + pointer events on a transform-scaled layer). The flashiest piece;
   isolated so Phase 1 isn't blocked on it.
6. **What-if overrides.** Tap a projected winner to override it → `resolveSlots`
   re-cascades downstream → diff badges show where your scenario diverges from the model;
   one-tap "reset to model." (Persist per session; optional save.)
7. **Interactive standings→seeding.** Tap a group position in `GS` → highlight where that
   team lands in R32 and trace its projected path.

## PHASE 3 — polish (P2, optional)
8. Shared-element/zoom transitions between GS detail and full-tree overview (the video's
   smooth animation); reduced-motion safe.
9. Deep-linkable state (`#/projected?model=…&round=qf&zoom=fit`).

---

## Backlog (priority)
| ID | Item | Phase | Priority | Effort |
|----|------|-------|----------|--------|
| BR-1 | Connector-line bracket tree | 1 | **P0** | M |
| BR-2 | Stage selector + scroll/zoom-to-round | 1 | **P0** | M |
| BR-3 | Zoom buttons (−/＋/fit) | 1 | **P0** | S |
| BR-4 | Per-pick confidence (win % + color) | 1 | **P0** | S |
| BR-5 | Pinch-zoom + pan gestures | 2 | **P1** | L |
| BR-6 | What-if overrides + diff-vs-model | 2 | **P1** | M |
| BR-7 | Interactive standings→seeding | 2 | **P1** | M |
| BR-8 | Zoom transitions + deep-link state | 3 | P2 | M |

## Risks / notes
- **Pinch-zoom in a no-build PWA** is the main risk (gesture conflicts with page scroll,
  iOS Safari quirks) → isolated to Phase 2, button-zoom covers Phase 1.
- What-if overlaps the (now-hidden) Play funnel's pickable bracket — we reuse
  `resolveSlots`, not a parallel engine.
- All Phase-1 work is read-only/additive; gated by the full regression suite as usual.

## Recommendation
Build **Phase 1 (BR-1…BR-4)** first as one cohesive upgrade to the Projected tab, ship
behind 100% regression, then evaluate Phase 2 gestures/what-if with it live.
