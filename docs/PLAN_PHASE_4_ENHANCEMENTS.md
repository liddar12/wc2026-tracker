# Phase 4 — Consolidated Enhancement Plan

Source: 2026-05-31 review of two screenshots + 28-item skipped list.

## Current state vs. the 28-item list

Updating the inherited list with **what actually shipped** so we don't redo work:

| # | Item | Status |
|--|--|--|
| 1 | Bracket "Compare" mode (my picks vs model) | ❌ not built |
| 2 | UI v2 rollout to all 8 tabs | ✅ **done** — `<html data-redesign="v2">` applied globally last session |
| 3 | FIFA emblem + Trionda assets | ✅ **done** — assets/wc26/ with 5 size variants |
| 4 | team_colors.json (48 teams) | ✅ **done** — Wikipedia + curated overrides |
| 5 | Trophy-tree two-column bracket | ❌ not built |
| 6 | Status pills (LIVE / FT / PEN) | 🟡 LIVE pulse on large-cards only; not on bracket cards |
| 7 | Connector threads between rounds | ❌ not built |
| 8 | Team-color tints on match cards | 🟡 large-cards have full banner; smaller cards (Matches/Schedule) don't |
| 9 | Tap match → full-screen detail sheet | ❌ currently navigates to a `/#/matchup/...` page |
| 10 | Long-press quick actions | ❌ not built |
| 11 | Pinch-to-zoom bracket | ❌ not built |
| 12 | Animated win/loss reveals | ❌ not built |
| 13 | "We are here" tournament position indicator | ❌ not built |
| 14 | Last-update toast | ❌ not built |
| 15 | Inline group-stage standings (tap group letter → mini table) | ❌ not built |
| 16 | Schedule rebuild from mjwebmaster | ✅ **done** — 104 matches with correct dates |
| 17 | scrape_team_kits.py | ✅ **done** — Wikipedia parser; Playwright cross-check |
| 18 | Apple Sports API integration | ❌ not built (research only) |
| 19 | Group prediction stored to Supabase | 🟡 schema + RPC exist; client writes localStorage only |
| 20 | R32 cascade-clear warning | ❌ not built (silent clear today) |
| 21 | Shared element transitions | ❌ not built |
| 22 | Profile/Settings page | ❌ not built |
| 23 | Pin favorite's matches to top | ✅ **done** — large-card stack reorders favorite first |
| 24 | Fav team Kalshi delta on Home | ❌ not built |
| 25 | Fav team bracket-path projection | ❌ not built |
| 26 | Highlight favorite in match lists & bracket | 🟡 lists yes, bracket no |
| 27 | Per-feed freshness display | ❌ uses freshest across all; not surfaced per-feed |
| 28 | Apple Sports "large/zoomed-in" cards | ✅ **done on Home**; not on Matches/Schedule |

**12 of 28 done or partial. 16 fully open.**

## Two new asks from screenshots

**A. Card style across Matches + Schedule** (img 1)
The large-card layout currently lives only on Home. The user wants the same component on the Matches tab and the Schedule tab (both screens that list multiple matches). This kills item #8 (smaller cards needed team tints) by making them *all* large cards.

**B. Matchup detail layout** (img 2)
Currently the matchup-detail page renders:
```
Canada vs Bosnia and Herzegovina
Group B
[Model bar]
[Composite breakdown]
[Why this prediction]
[Upset risk]
...
[Pick]
[When + where + how to watch]      ← buried below everything
[Lineups]
[Referee]
[H2H / Form / Scorers / Weather / Travel / xG]
[Final result]
```
User wants:
```
Canada vs Bosnia and Herzegovina
Group B
[When + where + how to watch]      ← moved up under the group label
[Model bar]
...
```

## Phase plan (recommended order)

### Phase 4A — Quick wins (1 session, low risk)
1. **Move when/where/watch to under the group label** in matchup detail. ~30 min.
2. **Last-update toast** (#14). On `meta.data_version` change vs. previous load, slide a small toast in from the top. ~45 min.
3. **R32 cascade-clear warning** (#20). When user changes a group pick that has downstream R32 picks, show a small confirm: "Clear 3 R32 picks fed by this match?". ~45 min.
4. **Per-feed freshness** (#27). Tooltip on the Home "Data updated" stamp showing per-feed timestamps. ~30 min.
5. **Group prediction Supabase upsert** (#19). Wire the existing `saveGroupPredictionsForActiveGroup` call into the submit button so picks persist server-side, not just locally. ~30 min.

**Acceptance**: each works on iPhone-width preview. Tests green.

### Phase 4B — Large cards everywhere (1 session)
6. **Apply largeMatchCard to Matches tab** (matchup-list.js).
7. **Apply largeMatchCard to Schedule tab** (schedule-view.js). Probably keep the day-picker pill row at top; below it, scroll-snap stack of large cards for the selected day.
8. **Highlight favorite team in match lists** (#26 lists portion). The card already accents the banner; add a small "⭐ YOUR TEAM" eyebrow tag when matching.

### Phase 4C — Bracket Apple-Sports UI (1–2 sessions)
9. **Status pills on bracket cards** (#6). LIVE / FT / PEN pill on every `.bb-slot` row when actuals present.
10. **Connector threads** (#7). Thin lines in the left margin of each round joining each pair's winner cell to its next-round slot. SVG overlay on `.bb-round`.
11. **Inline group-stage standings** (#15). On `#/brackets`, tap any group letter (A–L) → expand a 4-row mini table inline.
12. **Animated win/loss reveals** (#12). When actual.winner appears, fade-out loser, pulse-in winner background.
13. **Highlight favorite in bracket** (#26 bracket portion). Glow ring + bold name on every node where favorite plays.
14. **"We are here" position indicator** (#13). Horizontal line between rounds marking the current point in the tournament.

### Phase 4D — Compare + advanced bracket (1 session)
15. **Bracket "Compare" mode** (#1). Sub-tab on `#/my-brackets`: "My picks" / "Model" / "Compare". Compare shows both as ghost-overlaid cells.
16. **Tap match → full-screen sheet** (#9). Currently navigates; rebuild as a modal sheet that preserves bracket scroll.
17. **Long-press quick actions** (#10). Long-press on a match card → action sheet (Favorite / Share / Set alert / Pick this team).
18. **Pinch-to-zoom bracket** (#11). `touch-action: pinch-zoom` + CSS scale transforms.
19. **Trophy-tree two-column layout** (#5). Optional alternative to vertical cards: collapsed bird's-eye view of the full bracket.

### Phase 4E — Favorite team deep integration (1 session)
20. **Fav team Kalshi delta on Home** (#24). Mini-card next to the fav team picker.
21. **Fav team bracket-path projection** (#25). Highlight the projected path through the bracket.
22. **Settings page** (#22). New `/#/settings` route with favorite team, theme override, notification opt-ins.

### Phase 4F — Polish (1 session)
23. **Shared element transitions** (#21). Animate hero countdown → matchup detail morph. Requires View Transitions API (Safari 18+).
24. **Apple Sports API integration** (#18). Research-only: map the soccer-specific endpoints. May or may not be useful.

### Phase 4G — Sequence cut (suggested defer)
- **Trophy-tree two-column layout** (#5) — high effort, low marginal value vs vertical cards we already have.
- **Apple Sports API integration** (#18) — undocumented, can break anytime.
- **Pinch-to-zoom bracket** (#11) — questionable mobile UX; vertical cards don't need it.

## Hard dependencies + conflicts

- **Large cards on Matches/Schedule (4B) before bracket status pills (4C #9)** — both need a shared `statusPill()` helper. Build it once in 4B.
- **R32 cascade warning (4A #3) BEFORE Compare mode (4D #15)** — Compare displays the bracket state; we shouldn't ship Compare if cascade can silently destroy data.
- **Per-feed freshness (4A #4) BEFORE last-update toast (4A #2)** — the toast reads from the per-feed data the freshness display introduces.
- **Settings page (4E #22) is optional** — the Home picker works; Settings only matters if we add more prefs (notifications, theme override).

## What I'll NOT do without explicit ask

- Touch the Apple Sports API endpoints (DMCA / rate-limit risk).
- Rebuild the bracket as a horizontal SVG trophy-tree (we chose vertical cards, Q9 from prior session).
- Add native-app features (push notifications, share to Instagram, etc).

## Risk register

| Risk | Mitigation |
|---|---|
| Applying large-cards to Matches tab might overwhelm dense Group view (16 matches/group × 280px = 4500px tall) | Add toggle: "Compact" vs "Large" view on Matches. Compact = existing rows. |
| Animated reveals + pulse-live + connector threads could degrade scroll perf | Use `transform`/`opacity` only; respect `prefers-reduced-motion`. |
| Compare mode UI gets crowded on phones | Sub-tabs at top; mode lives in URL params. |
| Settings page bloats nav | Make it a header-icon link (gear icon), not a tab. |

## Effort summary

| Phase | Items | Time |
|---|---|--:|
| 4A — Quick wins | 5 items | 1 session (~3h) |
| 4B — Large cards everywhere | 3 items | 1 session (~3h) |
| 4C — Bracket Apple-Sports UI | 6 items | 1–2 sessions (~5h) |
| 4D — Compare + advanced | 5 items | 1 session (~4h) |
| 4E — Fav deep integration | 3 items | 1 session (~3h) |
| 4F — Polish | 2 items | 1 session (~2h) |
| 4G — Deferred | 3 items | n/a |

Total **~21 hours / 6 sessions** to clear the full list.
