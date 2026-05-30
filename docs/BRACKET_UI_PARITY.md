# Bracket UI Parity — My Brackets ↔ Projected

## Today's state

| | `#/my-brackets` (picker) | `#/brackets/mode/projected` (model) |
|---|---|---|
| Layout | Vertical card stack per round | Horizontal SVG bracket (March-Madness poster) |
| Source file | `app/views/my-brackets-view.js` | `app/views/bracket-view.js` (SVG) |
| Tap targets | 48px button rows | ~30px SVG nodes |
| Scroll axis | Vertical (native page scroll) | Horizontal (inner `overflow-x: auto`) |
| Mobile usability | Designed for it | Cramped — requires pinch-zoom |
| Connector lines | None (rounds stacked) | SVG path lines between rounds |

**Why they diverged**: My Brackets was built mobile-first for tap-to-pick. The SVG bracket predates the PWA and was originally a read-only visualization.

## User's call (Q9)

**Both views use the vertical card layout.** Mobile-first wins. The SVG horizontal bracket becomes deprecated.

## Implementation plan

### Phase 1 — Make Projected use the same renderer (this session)

1. Extract `renderRoundsAsCards(rootEl, rounds, mode)` from `my-brackets-view.js` into a new shared module `app/views/bracket-cards.js`. Two modes:
   - `mode: 'picking'` — buttons toggle the user's pick (current My Brackets behavior).
   - `mode: 'projected'` — read-only; winners pre-selected from `data.teams[name].composite`; no tap interaction; muted "PROJECTED" badge per round.
   - `mode: 'live'` — read-only; winners from `data.actualResults`; busted picks crossed out (current Brackets-live behavior).
2. `brackets-live-view.js` already does mode 'live' — keep its renderer, generalize the round-card builder.
3. Delete `bracket-view.js`'s SVG renderer; replace its `renderBracketView(root, data)` export with `renderRoundsAsCards(root, projectedRounds, 'projected')`.
4. Update `brackets-live-view.js`'s toggle so "Projected (model)" now renders the same vertical cards (just with model-derived winners).

### Phase 2 — Polish (optional, after UI refresh lands)

- Add a "Compare" mode that overlays My picks (filled chip) and Model picks (outline chip) on each pair, so users see where they disagree with the model.
- Animation: when toggling between modes, fade the winner highlight without re-rendering all rounds.

## Files affected

- **New**: `app/views/bracket-cards.js` (shared round-card renderer)
- **Modified**: `app/views/my-brackets-view.js` (use shared renderer in 'picking' mode)
- **Modified**: `app/views/brackets-live-view.js` (use shared renderer in 'live' and 'projected' modes; remove call to legacy `renderBracketView`)
- **Modified**: `app/views/bracket-view.js` → either deleted entirely OR kept as a 6-line stub that imports the shared renderer
- **CSS**: `.bb-pair` / `.bb-slot` styles already in place; add modifier classes for projected (dashed border) vs live (solid green-on-winner) vs picking (filled blue-on-pick)

## Effort

~150 LOC refactor + ~30 LOC of new CSS modifier styles. One session.
