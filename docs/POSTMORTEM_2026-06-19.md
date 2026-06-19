# Post-Mortem + Backlog — Stale Analytics & Missing Availability (2026-06-19)

**Status:** For review — no code changed. Backlog gated per CLAUDE.md; confirm before build.

---

## TRACK 1 — RCA: Pulisic "out" not reflected anywhere; availability not updating

**Symptom:** Christian Pulisic is out injured for USA, but that isn't shown on the
match update, analytics, predictions, or the Injuries page. Suspicion: starters /
available players aren't updated for injuries or red cards.

**Root cause — the entire injury/availability subsystem produces no data:**
- `data/injuries.json` = **0 entries across 0 teams** (every team empty). Pulisic
  is absent. The Injuries page therefore renders blank.
- `scripts/scrape_injuries.py` source is **dead: HTTP 404**
  (`espn.com/soccer/world-cup-2026/story/_/id/_/world-cup-2026-squad-tracker`). It
  writes 0 entries every run, masked by `continue-on-error`.
- ESPN's per-match `summary` endpoint carries **no injuries block** for live WC
  matches (verified on the live USA–Australia game), so the current pipeline has
  no working injury source at all.
- **No availability → lineup/model linkage.** `lineups.json` stores ESPN's posted
  XI when available but never marks who is OUT. The model
  (`rebuild_composite`/`build_dt_model`/`build_hybrid`) has **no notion of player
  availability** — a missing star doesn't change any prediction.
- **Red-card suspensions are computed but siloed.** `injuries-view.js`
  `suspensionsFromEvents()` derives bans from `match_events.json`, but that shows
  only on the Injuries page — it does not flow to lineups, the matchup view, or
  the model.

**Confirmed:** the user's assumption holds. Injury/suspension availability is not
propagated to match update, analytics, predictions, or lineups — partly because
the injury source is dead, and fundamentally because no availability signal is
wired into those surfaces.

---

## TRACK 2 — Post-mortem: analytics/ELO/power-rank are FROZEN, not game-to-game

**Expectation:** ELO, player power ranking, and the composite analytics should move
game-to-game as results come in, shifting predictions.

**Reality (git history of `data/`):**

| Data | Last changed | Moving? |
|---|---|---|
| `teams.json` (composite, **ELO**, power_rank, TMV, qual) | **May 28** | ❌ frozen 3 wks |
| `players.json` (player ratings) | **May 27** | ❌ frozen |
| `injuries.json` | daily, but **0 entries** | ❌ empty |
| `actual_results.json`, `match_events.json`, `scorers.json` | today | ✅ |
| `markets.json` (Kalshi), `dt_model.json`, `forecast.json` | today | ✅ (market-driven) |

**Root cause — three dead rating sources + zero results-feedback:**
1. `update_elo.py` → eloratings.net parse yields no data ("no data parsed; skipping").
2. `update_espn.py` (power rank) → **HTTP 404** (`espn.com/soccer/fifarank` is gone).
3. `scrape_injuries.py` → **HTTP 404** (see Track 1).
4. **No results→rating computation exists.** None of `rebuild_composite`,
   `build_dt_model`, `build_hybrid`, or `update_elo` read `actual_results` or
   `match_events`. ELO is scrape-only — and the scraper is dead. So a game result
   has **no path** to change team strength.

**Net effect on predictions:** `forecast = ⅓ J5L composite + ⅓ DT + ⅓ Kalshi`. The
J5L composite and DT (Elo+TMV) legs are frozen at **pre-tournament** values; only
the **Kalshi market leg moves**. ~⅔ of the model is stale. The product's headline
promise — analytics that update each game — is effectively not happening, and it
went unnoticed for 3 weeks because the failures are silent (`continue-on-error`,
no staleness alert).

---

## BACKLOG (gated; P0 = tournament-breaking, fix now · P1 = important, next)

### EPIC A — Results-driven analytics (make the model move game-to-game)
- **P0-A1 — Compute ELO from actual results.** Add a results-driven Elo
  (`compute_elo.py`): seed from the last good `teams.json` Elo, then apply
  standard Elo updates from every FINAL match in `actual_results.json` (K-factor,
  goal-difference multiplier). Becomes the authoritative in-tournament Elo, feeding
  composite → DT → hybrid. *No dependency on dead external scrapers.*
  - AC: after each FINAL, winner's Elo rises / loser's falls; composite + forecast
    shift; re-running is idempotent; group-stage results reflected within one cron.
    QA: unit tests on Elo math + a replay of group-stage results vs expected deltas (≥90%).
- **P0-A2 — Staleness watchdog.** Fire the existing `pipeline-alert` issue if
  `teams.json` (or any model input) is unchanged > 36h during the tournament window.
  *This is why a 3-week freeze went unseen.*
  - AC: a forced-stale input opens an alert; fresh inputs don't. QA: test the
    staleness predicate.

### EPIC B — Availability (injuries + suspensions) end to end
- **P0-B1 — Working injuries source.** Replace the 404 source with ESPN's
  team-level injuries endpoint (or core API athlete status); repopulate
  `injuries.json`. Surfaces Pulisic et al. on the Injuries page again.
  - AC: ≥ the teams with real injuries show entries; Pulisic appears while out;
    `__meta__` fresh. QA: parser test against a saved fixture.
- **P1-B2 — Propagate availability to lineups + matchup + model.** Mark OUT
  (injured/suspended) players in `lineups.js` and the matchup view; merge the
  already-computed `suspensionsFromEvents()` bans with injuries into one
  availability signal. Optional: down-weight a team's composite when a top-rated
  player is unavailable.
  - AC: a suspended/injured starter renders with an OUT badge across surfaces;
    availability is one source of truth. QA: render + merge tests.

### EPIC C — Secondary rating sources
- **P1-C1 — Power-rank source.** `espn.com/soccer/fifarank` is dead; either derive
  power_rank from the new results-Elo + composite, or repoint to a live FIFA
  ranking source. AC: power_rank moves post-results. QA: parser/derivation test.
- **P1-C2 — Player ratings refresh.** `players.json` frozen since May 27 (feeds
  Golden Boot + DT). Repoint or hold with a documented cadence. AC: ratings refresh
  or staleness is explicit. QA: shape test.

---

## RECOMMENDATION through the 4 gates
- **GATE 1 (architecture):** keep the stack; the durable fix is a **results-driven
  Elo computed from `actual_results`** (data we already capture reliably) rather
  than resurrecting dead scrapers — this is automation-first and self-healing.
- **GATE 2 (design):** mostly backend; the only UI is OUT/suspended badges on
  lineups + matchup (P1-B2) — iOS-first, J5L styling.
- **GATE 3 (backlog):** above; P0 = A1, A2, B1.
- **GATE 4 (deploy):** per CLAUDE.md gate — 100% regression green, race-safe merge,
  verify on prod. Each P0 ships independently behind its own tests.

**Suggested P0 fix order:** A2 (watchdog, ~30 min, stops the bleeding) → A1
(results-Elo, the headline fix) → B1 (injuries source). Then P1s.
