# WC2026 Tracker — Full-Hardening Backlog (Gate 3)

**Status:** Gate-3 backlog · **Scope:** FULL hardening (all 28 RCA issues) · **Deploy:** auto-deploy to prod once regression is 100% green
**Source of truth:** 7-agent RCA (7 areas, ~28 root causes) → partitioned into Epics A–F + Epic QA + Gate 4
**Owner decisions baked in:** (1) full hardening, (2) full knockout model — generate `data/knockout_matchups.json` + knockout xG mirroring the `group_matchups` row schema, headline a **"to advance %"** since knockouts can't draw, (3) activate API-Football (extend scraper to knockout pairs; owner adds `APIFOOTBALL_KEY` secret), (4) auto-deploy when green.

---

## 1. Context & Architecture Summary

The WC2026 tracker is a static, data-driven PWA (Netlify-hosted, `_headers` + `netlify.toml` are the single deploy source of truth; CNAME/.nojekyll are dead GitHub-Pages leftovers). A Python pipeline (`scripts/*`) scrapes ESPN/Kalshi/API-Football and rebuilds model JSON under `data/`; the browser (`app/*`) loads those files and overlays ~30s-fresh live scores via a Vercel Edge Function (`live-api/api/live.js`). GitHub Actions runs **four** scheduled workflows that all commit to `main`.

Two structural root causes explain almost every live symptom:

1. **Group-first data model.** Every per-match model artifact — `data/group_matchups.json` (keyed by group letters A–L), `data/xg.json` (group-pair keys), the consensus-odds scraper's allowed-pair set, the parlay leg generator, the Match-of-the-Day chip, and the matchup-detail analytics grid — is produced and consumed **only for the 72 intra-group pairings**. Knockout fixtures are cross-group pairs that exist in `schedule_full.json` but in **none** of the model files. So once the tournament entered the knockout stage, the parlay returns `null`, the MOTD chip returns `null`, and the matchup-detail analytics grid is gated off — all rendering **silently nothing** (empty `DocumentFragment` / early `return null`), with no empty-state. There is no global `tournamentPhase` concept; knockout is handled ad hoc per view.

2. **Pipeline write race.** Four crons (live `*/15`, pre_kickoff `*/10`, frequent hourly, daily 06:00) checkout `main`, regenerate overlapping files, and `git pull --rebase -X theirs origin main` + push concurrently. `-X theirs` keeps the **local** cron's freshly-regenerated file on any conflict, **silently discarding** the other cron's just-pushed values (a fresh live score can be reverted). Per-workflow concurrency groups exist but **none cross workflows**, so the race is guaranteed when schedules overlap. Compounding it: group-stage probabilities flip between two models (`rebuild_composite` J5L Poisson vs `build_hybrid` blend) depending on whether the `continue-on-error` hybrid step succeeded that cycle; `validate_data.py` checks **shape only** so dark/empty/stale feeds deploy unblocked; scrapers bump `updated_at` even on empty writes (defeating the staleness watchdog); `ensure_ascii` disagreement between co-writers causes whole-file diff churn that enlarges the conflict surface; and `meta.data_version` is bumped unconditionally, burning a Netlify deploy every cron.

The hardening pass closes both classes: generate full knockout model data (Epics B–E), unblock the silent-vanish surfaces with knockout-aware logic + empty-states (Epics C, D, E, F), serialize and harden the pipeline (Epic A), and lock every fix with regression tests (Epic QA) before auto-deploy (Gate 4).

---

## 2. Bug Register (BUG-1 … BUG-28)

Numbered by severity (critical → high → medium → low), grouped by RCA area. Severity from the RCA `severity` field.

| BUG | Sev | Area | Title | Epic |
|-----|-----|------|-------|------|
| BUG-1 | critical | Pipeline | `git pull --rebase -X theirs` silently discards the other cron's committed data | A |
| BUG-2 | high | Pipeline | Four crons share one push target with no cross-workflow concurrency group | A |
| BUG-3 | high | Pipeline | Predictions flip between two models per `continue-on-error` success | A |
| BUG-4 | high | Pipeline | `validate_data.py` validates SHAPE only — dark/empty/stale feeds deploy unblocked | A |
| BUG-5 | high | Pipeline | Scrapers fail silently AND bump timestamp; `players.json` frozen since 2026-05-27 | A |
| BUG-6 | medium | Pipeline | Inconsistent `ensure_ascii` between co-writers → whole-file diff churn | A |
| BUG-7 | medium | Pipeline | `meta.json` written 2–3×/cron; `data_version` bump unconditional, defeats throttle | A |
| BUG-8 | high | Parlay | Knockout fixtures absent from `group_matchups.json`/`xg.json` → parlay pool empty, returns null | B, C |
| BUG-9 | high | Matchup detail | No per-match prediction data for knockouts; no `knockout_matchups.json` | B, D |
| BUG-10 | high | Completed match | Scraper records `winner` only for tied (pen/ET) games, never regulation knockout wins | B/F, E |
| BUG-11 | high | Completed match | matchup-detail "Final result" only renders on literal `rec.winner` — regulation wins render nothing | E |
| BUG-12 | high | Completed match | `largeMatchCard` never highlights winner / shows method; `actualForCard` strips `winner`/`status` | E |
| BUG-13 | high | Schedule | Finished South Africa–Canada R32 (Jun 28) missing from `actual_results.json` → scoreless "FINAL · vs" | F |
| BUG-14 | high | Cross-cutting | No global tournament-phase model — phase-specific home cards silently vanish in knockout | F |
| BUG-15 | high | Cross-cutting | Parlay of the Day silently disappears in knockout (empty `DocumentFragment`) | C |
| BUG-16 | medium | Matchup detail | `confidenceBar()`/`matchupCard()` throw on a model-less knockout row (load-bearing gate) | D |
| BUG-17 | medium | Completed match | Backfill only patched 2 penalty games; regulation wins never backfilled, won't self-heal | B/F, E |
| BUG-18 | medium | Schedule | Knockouts not clickable to detail from Schedule (matchup link gated to `stage === 'group'`) | C |
| BUG-19 | medium | Schedule | Weather & per-match outcome odds not surfaced for knockout fixtures | C, F |
| BUG-20 | medium | Cross-cutting | MOTD "Don't miss" chip hard-gated to group stage — returns null in knockout | C/F |
| BUG-21 | high | Live | Client-side Elo skips ALL pen/ET games — wrong field name (`penalty_winner`) + incomplete FINAL set | F |
| BUG-22 | medium | Live | `status-pill` ignores real ESPN clock/status; 150-min cutoff drops LIVE before ET/pens end | F |
| BUG-23 | medium | Live | 2-hour "live" windows flip knockout games to FINAL/TBD while ET/pens still running | F |
| BUG-24 | medium | Live | Live view full-DOM teardown + `scrollTo(0,0)` every 30s | F |
| BUG-25 | low | Live | live-api edge response drops `s-maxage`/`stale-while-revalidate` (served bare `public`) | F |
| BUG-26 | medium | Matchup detail | Market-odds column suppressed by `hasModel` gate (has tournament-winner fallback) | D |
| BUG-27 | low | Schedule | Stale `kickoff_local_et`/`kickoff_local_venue` after `resolve_knockouts` overwrites `kickoff_utc` | C |
| BUG-28 | low | Schedule | Dead `prettyStage()`/`scheduleCard()` with legacy r32/r16/qf codes that never match data | C |

> Additional low-severity, in-scope items folded into their owning epic (not separately numbered, but tracked): Kalshi has no per-match fallback (Parlay area, Epic C); STATUS_SCHEDULED 0-0 stub can flash phantom LIVE (Cross-cutting, Epic F); pipeline `actual_results` carries no live minute/status (Live area, Epic F); GitHub-Pages leftovers cleanup (Cross-cutting, Gate 4).

---

## 3. Epics, User Stories & Acceptance Criteria

Every AC is Given/When/Then. Every AC maps to ≥1 test in the QA matrix (§4). Test IDs `T-xx` are defined there and pulled from the RCA `testsNeeded` arrays.

---

### Epic A — Pipeline Integrity & Race-Condition Fix
*Closes BUG-1, BUG-2, BUG-3, BUG-4, BUG-5, BUG-6, BUG-7*
**Touches:** all four workflow YAMLs, `build_hybrid.py`, `rebuild_composite.py`, `_common.py`, `compute_elo.py`, `build_dt_model.py`, `optimize_weights.py`, `validate_data.py`, `check_staleness.py`, the scraper stub-writers, repo secrets.

#### Story A1 — Eliminate the cross-cron write race (BUG-1, BUG-2)
> As the data pipeline, I want exactly one writer to `main` at a time with non-clobbering merges, so a fresh live score is never reverted by a concurrent cron.

**Tasks:** add a single shared `concurrency.group: data-writers` (`cancel-in-progress: false`) to all four workflows; replace `git pull --rebase -X theirs` with disjoint per-cron file ownership (each cron stages only the files it owns) OR a rebase that re-runs deterministic generators on the merged tree; raise/remove the 3-retry `exit 1` that fires spurious failure alerts.

- **AC-A1.1** — *Given* two concurrent crons both edit `actual_results.json` (one adds a FINAL score, the other regenerates from an older checkout), *When* both push via the rebase-retry loop, *Then* the FINAL score survives (no data loss). → **T-A1**
- **AC-A1.2** — *Given* all four data-writing workflows, *When* their schedules overlap, *Then* GitHub serializes them via the shared `data-writers` concurrency group (only one runs/pushes at a time) and no push-reject retry storm occurs. → **T-A2**

#### Story A2 — Deterministic single-model ownership of group probabilities (BUG-3)
> As a fan, I want a match's win probability and predicted winner to stay stable across refreshes, not flip between two models.

**Tasks:** make the model chain atomic — either `build_hybrid` must succeed (drop `continue-on-error`, gate via validate) or it writes to a separate field the UI deterministically prefers-with-fallback; write to temp + swap so a partial blend never overwrites.

- **AC-A2.1** — *Given* `build_hybrid.py` fails (simulate by removing `markets.json`), *When* the cron runs, *Then* `group_matchups.json` `predicted_winner`/`probabilities` do NOT silently switch model and the failure is flagged (not deployed). → **T-A3**

#### Story A3 — Validation blocks dark/empty/stale feeds (BUG-4, BUG-5)
> As the deploy gate, I want validation to fail (not pass) when a feed that should have data is empty or stale, so bad data never ships green.

**Tasks:** add freshness (SLA on `__meta__.updated_at`) + non-emptiness checks to `validate_data.py` (consensus_odds.match_outcomes, injuries, scorers during the relevant window); only bump `__meta__.updated_at` when real content changed; expand `check_staleness` WATCH / add content-emptiness signal; decide `players.json` (static vs live source); add `APIFOOTBALL_KEY` repo secret.

- **AC-A3.1** — *Given* `consensus_odds.json` has empty `match_outcomes` and `injuries.json` count=0 during the tournament window, *When* `validate_data.py` runs, *Then* it FAILs (or warns loudly), not exit 0. → **T-A4**
- **AC-A3.2** — *Given* `players.json` unchanged >36h during the tournament, *When* `check_staleness.py` runs, *Then* a stale-data issue is (re-)opened and not permanently suppressed by an earlier dedup. → **T-A5**
- **AC-A3.3** — *Given* a feed scraper finds zero new data, *When* it writes its file, *Then* `__meta__.updated_at` does NOT advance. → **T-A6**

#### Story A4 — Canonical encoding & single deploy bump (BUG-6, BUG-7)
> As the pipeline, I want one canonical JSON encoding and one conditional `data_version` bump, so cosmetic churn and no-op deploys stop.

**Tasks:** standardize `ensure_ascii=True` across all writers (route through one `save_json`); make `data_version`/`meta.json` bump exactly once and only when content changed; write all data files atomically (tmp + `os.replace`).

- **AC-A4.1** — *Given* a cron where `rebuild_composite` is the last writer of `group_matchups.json` (hybrid skipped), *When* the file is committed, *Then* encoding matches the canonical `ensure_ascii` setting (no `\u`↔literal flip, no whole-file diff). → **T-A7**
- **AC-A4.2** — *Given* the daily cron runs with no underlying data change, *When* it completes, *Then* `meta.data_version` does NOT bump and no commit/deploy is produced. → **T-A8**

**DoD (Epic A):** all four crons share one concurrency group; no `-X theirs` clobber path remains; model chain atomic; `validate_data.py` fails on dark/empty/stale; encoding canonical everywhere; `data_version` bumps once-and-only-on-change; `APIFOOTBALL_KEY` secret added; T-A1…T-A8 green.

---

### Epic B — Knockout Data Generation
*Closes BUG-8 (data half), BUG-9 (data half), BUG-10/BUG-17 (data half — winner capture)*
**Touches:** new `scripts/build_knockout_matchups.py` (or extend `build_hybrid.py`/`rebuild_composite.py`), `scripts/compute_xg.py`, `scripts/scrape_live_results.py`, `app/data-loader.js` (load new file), `validate_data.py`, GitHub Actions wiring, `scrape_apifootball_odds.py` (`canonical_matchups`).

#### Story B1 — Generate per-match knockout predictions mirroring the group schema (BUG-9)
> As the data pipeline, I want a `data/knockout_matchups.json` whose rows carry the **same fields** as group rows, so every downstream consumer that reads a group row works for knockouts unchanged.

**Tasks:** for each resolved knockout fixture in `schedule_full.json` (stage ≠ group, both teams real), compute `composite_a/b` (from `teams.json`), `gap`, bivariate-Poisson W/D/L `probabilities`, `win_confidence_pct`, `predicted_winner`, `upset_risk`, `j5l_probabilities`/`hybrid_gap` (forecast `hybrid_strength` + `dt_model` ratings + markets); write to `knockout_matchups.json`; add a **"to advance %"** per team (fold ET/pens into the higher side) as the headline metric; load via `data-loader.js` and merge into the lookup. Re-run whenever `resolve_knockouts.py` fills bracket slots.

- **AC-B1.1** — *Given* `knockout_matchups.json` is generated, *When* I read the Mexico vs Ecuador row, *Then* it carries `win_confidence_pct`, `probabilities{team_a_wins,draw,team_b_wins}`, `composite_a/b`, `gap`, `predicted_winner`, `upset_risk`, and a `to_advance` per team. → **T-D2**
- **AC-B1.2** — *Given* the row schema, *When* compared field-by-field to a `group_matchups` row, *Then* the knockout row is a superset (all group fields present + `to_advance`), so group-stage render code resolves it without a missing-key error. → **T-D2**, **T-B-schema**

#### Story B2 — Generate knockout xG entries (BUG-8 data half)
> As the data pipeline, I want `xg.json` to contain knockout team-pair keys so xG-derived parlay legs (O/U, BTTS, scorer) exist in the knockout stage.

**Tasks:** extend `compute_xg.py` to also iterate round_of_32+ rows from `schedule_full.json`, computing xG from `teams.json` composite/Elo the same way it does for group pairs, writing those keys (canonical `Team_a__vs__Team_b` orientation) into `xg.json`.

- **AC-B2.1** — *Given* `schedule_full.json` contains resolved knockout fixtures, *When* `compute_xg.py` runs, *Then* `xg.json` contains a key for every named knockout pair (both orderings resolvable). → **T-C1**, **T-Cov-xg**

#### Story B3 — Scraper captures winner + method for ALL completed knockouts (BUG-10, BUG-17 data half)
> As the data pipeline, I want `winner` + a method marker recorded for **every** completed knockout (not just ties), so the durable record is complete and future regulation wins self-heal.

**Tasks:** in `scrape_live_results.py`, drop the `and sa == sb` guard so `winner`/method are captured for all completed knockout games (winner from ESPN per-competitor boolean, fallback to score compare); record shootout scores only when present; derive method from `status` (STATUS_FULL_TIME/AET/PEN); optionally one-time backfill existing completed regulation knockout records.

- **AC-B3.1** — *Given* `scrape_live_results.py` processes an ESPN regulation knockout result (sa ≠ sb) with a per-competitor winner boolean, *When* it writes the record, *Then* `rec.winner` is populated for the higher-scoring team and a method/status marker distinguishes reg vs aet vs pen. → **T-E5**

#### Story B4 — Coverage gate for knockout data (BUG-8/BUG-9 hardening)
> As the deploy gate, I want validation to fail when a resolved knockout fixture lacks model/xG/result rows, converting silent group-only gaps into a red gate.

**Tasks:** extend `validate_data.py`: assert every named (non-placeholder) upcoming match has an `xg.json` entry and a `knockout_matchups.json` row; assert every past-kickoff schedule row has a FINAL `actual_results` entry; assert 104 total matches and 16 R32 rows.

- **AC-B4.1** — *Given* `xg.json` after `compute_xg.py` runs, *When* `validate_data.py` runs, *Then* it asserts an xG entry exists for every named upcoming match and fails if any is missing. → **T-Cov-xg**
- **AC-B4.2** — *Given* a resolved knockout fixture in `schedule_full.json` lacking a row in `knockout_matchups.json`, *When* `validate_data.py` runs, *Then* validation fails with a clear coverage error. → **T-Cov-ko**

**DoD (Epic B):** `knockout_matchups.json` generated for all resolved knockout fixtures with a group-superset schema + `to_advance`; `xg.json` covers all knockout pairs; scraper writes winner+method for all completed knockouts; coverage assertions live in `validate_data.py`; builder wired into the same Actions step as `resolve_knockouts`; T-C1, T-D2, T-E5, T-Cov-xg, T-Cov-ko, T-B-schema green.

---

### Epic C — Parlay Knockout Fix + Schedule Clickable
*Closes BUG-8 (consume half), BUG-15, BUG-18, BUG-19 (suppress half), BUG-20 (parlay/schedule half), BUG-27, BUG-28*
**Touches:** `app/components/parlay.js`, `app/views/schedule-view.js`, `scrape_apifootball_odds.py` (`canonical_matchups`), `scripts/resolve_knockouts.py`.

#### Story C1 — Parlay renders in the knockout stage (BUG-8 consume, BUG-15)
> As a fan, I want the Parlay of the Day to appear on knockout match days, built from knockout model/xG data.

**Tasks:** point `modelWDL()`/`xgFor()` at the knockout sources (`knockout_matchups.json` + knockout `xg.json` keys); allow a documented knockout model source for the Moneyline leg; ensure `marketWDL` falls back to model-only without crashing on empty Kalshi outcomes; extend `scrape_apifootball_odds.py` `canonical_matchups()` to include knockout pairs.

- **AC-C1.1** — *Given* today's `schedule_full.json` has knockout fixtures and `xg.json`/`knockout_matchups.json` contain those exact pairs, *When* `parlayOfTheDay(data)` runs, *Then* it returns 3 parlays of 3 legs each. → **T-C1**
- **AC-C1.2** — *Given* `consensus_odds.json` has empty `match_outcomes` but model+xG are present for today's games, *When* `parlayOfTheDay(data)` runs, *Then* it still returns 3 parlays (market optional) and the freshness label reads "hourly market". → **T-C4**
- **AC-C1.3** — *Given* `markets.json` `match_outcomes` length 0, *When* `marketWDL` is called for a today match with a model leg, *Then* the Moneyline leg falls back to model-only probability without error. → **T-C5**

#### Story C2 — Parlay degrades visibly, never silently (BUG-15 hardening)
> As a fan/QA, I want a labelled empty-state when no legs can be built, so a data gap is caught by eyeball, not by a vanished card.

**Tasks:** make `renderParlayOfDay` return a labelled empty-state node ("Odds for today's knockout matches aren't priced yet") when there are named matches today but pool < 3, instead of an empty `DocumentFragment`.

- **AC-C2.1** — *Given* a knockout fixture present in `schedule_full.json` but absent from both `group_matchups.json` and `xg.json`, *When* `parlayOfTheDay(data)` returns null, *Then* `renderParlayOfDay` surfaces a visible placeholder (no silent empty fragment). → **T-C2**, **T-X2**

#### Story C3 — Knockout fixtures are clickable from Schedule (BUG-18)
> As a fan, I want to tap a resolved knockout fixture on the Schedule and land on its matchup-detail page.

**Tasks:** change the Schedule link gate from `stage === 'group'` to "link whenever both teams present AND not slot-placeholders" (reuse `isSlotPlaceholder`); keep `is-tba` only for true placeholders.

- **AC-C3.1** — *Given* a fully-resolved knockout fixture (real team names) on the Schedule view, *When* the user taps it, *Then* it navigates to `#/matchup/...` and the knockout detail page renders. → **T-X5**
- **AC-C3.2** — *Given* a knockout row still holding W#/L# placeholders, *When* the schedule renders it, *Then* it shows the placeholder labels, is non-tappable, and still shows kickoff + venue + broadcast. → **T-S4**

#### Story C4 — Schedule data hygiene & dead-code removal (BUG-19, BUG-27, BUG-28)
> As a maintainer, I want resolved knockout rows internally consistent and dead stage-mapping code removed.

**Tasks:** in `resolve_knockouts.py`, recompute `kickoff_local_et`/`kickoff_local_venue` after overwriting `kickoff_utc` (or drop the unused fields); delete the dead `scheduleCard()`/`prettyStage()`/`formatKickoffLocal()` block in `schedule-view.js`; decide knockout weather/odds scope (suppress empty per-match odds widget for knockouts short-term; weather window decision per Gate-1 doc).

- **AC-C4.1** — *Given* `resolve_knockouts.py` overwrites a knockout `kickoff_utc` to a time different from the placeholder, *When* the script finishes, *Then* `kickoff_local_et` and `kickoff_local_venue` convert back to the new `kickoff_utc`. → **T-S5**
- **AC-C4.2** — *Given* the schedule view, *When* a knockout card renders its stage label, *Then* the label is correct (R32/R16/QF/SF/Final) via the live `largeMatchCard` path with no reliance on the deleted legacy map. → **T-S1**

**DoD (Epic C):** parlay renders 3×3 on knockout days; labelled empty-state when unpriceable; knockout fixtures clickable; placeholders non-tappable; `canonical_matchups` covers knockouts; local-time fields consistent; dead code removed; T-C1, T-C2, T-C4, T-C5, T-X5, T-S1, T-S4, T-S5 green.

---

### Epic D — Matchup Analytics + Winner/Method on Detail
*Closes BUG-9 (consume half), BUG-16, BUG-26; supports BUG-11 winner derivation*
**Touches:** `app/views/matchup-detail.js` (`resolveMatch`), `app/data-loader.js`, `app/components/confidence-bar.js`, `app/components/matchup-card.js`, `app/components/market-odds.js`, `app/components/model-market-divergence.js`.

#### Story D1 — Knockout matchup-detail shows the full analytics grid (BUG-9 consume)
> As a fan, I want the model confidence bar, hybrid pick, composite breakdown, why-this-prediction, upset signals and "to advance %" on knockout matchup pages.

**Tasks:** point `resolveMatch()` at `knockout_matchups.json` (load via `data-loader.js`); tag the resolved row with `_source:'group'|'knockout'|'schedule'`; present "to advance %" headline with regulation W/D/L underneath; if data is genuinely unavailable, render an explicit placeholder instead of omitting the grid.

- **AC-D1.1** — *Given* a knockout fixture (Belgium vs Senegal, round_of_32), *When* the matchup-detail route renders, *Then* the analytics region is NOT blank — the full model+market grid renders (with knockout data) and no JS error is thrown. → **T-D1**
- **AC-D1.2** — *Given* `knockout_matchups.json` for Mexico vs Ecuador, *When* `resolveMatch()` runs, *Then* it returns a row with the full model fields and `hasModel === true`. → **T-D2**

#### Story D2 — Render helpers are null-safe (BUG-16)
> As a developer, I want `confidenceBar()`/`matchupCard()` to never throw on a model-less row, so the load-bearing gate becomes defensive instead of mandatory.

**Tasks:** early-return/skip in `confidence-bar.js` when `match.probabilities` is undefined; guard `win_confidence_pct` before `.toFixed` in `matchup-card.js`.

- **AC-D2.1** — *Given* a row with `match.probabilities === undefined`, *When* `confidenceBar(match)` is called, *Then* it does not throw. → **T-D3**
- **AC-D2.2** — *Given* a row with `match.win_confidence_pct === undefined`, *When* `matchupCard(match,data)` is called, *Then* it does not throw. → **T-D4**

#### Story D3 — Market column decoupled from the model gate (BUG-26)
> As a fan, I want the market-odds column (which self-degrades to tournament-winner odds) to render for knockouts even before per-match model/odds exist.

**Tasks:** split `marketOddsSection(match, data.markets)` out of the `if (hasModel)` block; null-guard `divergenceLine()`/`marketBar()` for rows with no `.probabilities`.

- **AC-D3.1** — *Given* a knockout fixture and `markets.json` with empty `match_outcomes` but populated `tournament_winner`, *When* the market column renders, *Then* it shows the tournament-winner fallback for both teams without throwing. → **T-D5**
- **AC-D3.2** — *Given* a knockout match in matchup-detail with `win_confidence_pct` absent (pre-data), *When* the view renders, *Then* the model grid is omitted gracefully and the team-keyed sections render without throwing. → **T-X8**

**DoD (Epic D):** knockout matchup-detail renders the full grid with "to advance %" headline; `resolveMatch` tags `_source`; render helpers null-safe; market column renders independently of `hasModel`; T-D1, T-D2, T-D3, T-D4, T-D5, T-X8 green.

---

### Epic E — Card Winner-Highlight + Method + CSS + Bracket/Scoring
*Closes BUG-10 (render half), BUG-11, BUG-12, BUG-17 (render half)*
**Touches:** `app/components/large-match-card.js`, `app/views/matchup-detail.js`, `app/predictions.js`, `app/styles.css`, plus a shared status→method helper (e.g. `app/lib/`).

#### Story E1 — Winner highlight + method on cards (BUG-12)
> As a fan, I want completed knockout cards to highlight the winning team and show the method (FT / AET / pens 4–3) on Home and Schedule.

**Tasks:** extend `actualForCard` to return `winner` + `method` (derived from status + shootout scores); add an `is-winner` highlight class to the winning `.lcard-team` and a method tag in the eyebrow/score area; add minimal CSS; pair the highlight with a textual marker (checkmark/"won") for ADA (no color-only). Centralize the FINAL-status set to avoid drift across `large-match-card.js`/`bracket-resolver.js`/`competition-scoring.js`/`scrape_live_results.py`.

- **AC-E1.1** — *Given* a regulation knockout win in any tier (R32…Final), *When* rendered on Home and Schedule cards, *Then* the winning team is visually highlighted and the eyebrow shows the regulation method (e.g. "FT"), loser un-highlighted. → **T-E2**
- **AC-E1.2** — *Given* a STATUS_FINAL_PEN record (e.g. Germany 1–1 Paraguay, winner Paraguay, shootout 3–4), *When* rendered on card and detail header, *Then* the method label reads "pens (4–3)" NOT "FT", and Paraguay is highlighted. → **T-E3**
- **AC-E1.3** — *Given* a STATUS_FINAL_AET record (ET win, no shootout), *When* rendered, *Then* the method reads "AET"/"after extra time" and the winner is highlighted. → **T-E4**
- **AC-E1.4** — *Given* a STATUS_SCHEDULED 0-0 knockout stub, *When* rendered, *Then* no winner highlight and no method appear (negative test). → **T-E6**

#### Story E2 — "Final result" + header method on matchup-detail, derived from score (BUG-10 render, BUG-11, BUG-17 render)
> As a fan, I want a regulation knockout win to show a "Final result" statement and a correct header method, derived from the score even if the scraper never wrote `winner`.

**Tasks:** in `matchup-detail.js`, derive winner from score when `rec.winner` absent and scores differ; choose method label from `rec.status` (FT/AET/pens); add a winner-highlight class to the header team row; replace the hardcoded `<small>FT</small>` (matchup-detail.js:90) with the shared method helper; extend `actualChoice`/knockout branch to handle knockout records.

- **AC-E2.1** — *Given* `actual_results.json` R32 "Brazil__vs__Japan" = {score_a:2, score_b:1, status:STATUS_FULL_TIME} with NO `winner` field, *When* the matchup-detail view renders, *Then* a "Final result" section states "Brazil won" and the Brazil header row carries a winner-highlight class. → **T-E1**

**DoD (Epic E):** cards highlight winner + show method (FT/AET/pens) with ADA-safe textual marker; matchup-detail derives winner from score and shows correct method (no hardcoded FT); single FINAL-status source of truth; bracket advancement + pick-scoring unchanged (regression-locked); T-E1, T-E2, T-E3, T-E4, T-E6 green.

---

### Epic F — Real-Time / Timing + Phase Integration + Resilience
*Closes BUG-13, BUG-14, BUG-19 (weather/odds half), BUG-20 (MOTD half), BUG-21, BUG-22, BUG-23, BUG-24, BUG-25; plus phantom-LIVE + live-minute-persistence low items*
**Touches:** `app/lib/phase.js` (new), `app/main.js`, `app/views/home-view.js`, `app/views/schedule-view.js`, `app/live-elo.js`, `app/components/status-pill.js`, `app/components/large-match-card.js` (`inferMode`), `live-api/api/live.js`, `scripts/scrape_live_results.py`, `scripts/resolve_knockouts.py`/`scrape_live_results.py` (backfill).

#### Story F1 — Global tournament-phase model + empty-state contract (BUG-14)
> As a fan, I want Home/Schedule to behave correctly in the knockout phase, with no section silently vanishing.

**Tasks:** add `app/lib/phase.js` `currentPhase(data)` (reuse `competition-rules.deriveLockState`); pass phase into `renderView`; establish an empty-state contract — any card that can produce no content returns a labelled empty-state node, never null/empty fragment (`renderParlayOfDay`, `renderMatchOfTheDayChip`, `renderFavKalshiCard`, `renderMoversSection`, `renderEloMoversSection`).

- **AC-F1.1** — *Given* the tournament is in the R32 phase, *When* Home renders, *Then* the "Don't miss" card shows a knockout match or an explicit empty-state, never silently absent. → **T-X1**

#### Story F2 — MOTD chip works in knockout (BUG-20)
> As a fan, I want the "Don't miss" chip to feature a knockout match on knockout days.

**Tasks:** drop the `&& m.stage === 'group'` filter in `renderMatchOfTheDayChip`; add a knockout scoring path (forecast `hybrid_strength` / `stageWeight`).

- **AC-F2.1** — *Given* today is a knockout matchday, *When* `renderMatchOfTheDayChip` runs, *Then* a knockout chip is produced (not null). → **T-Live7**, **T-X1**

#### Story F3 — Missing/late knockout results never masquerade as scoreless FINAL (BUG-13)
> As a fan, I want a played knockout match with no record to show its score (after backfill) or a "Result pending" state, never "FINAL · vs".

**Tasks:** backfill South Africa–Canada (and audit all played knockouts) into `actual_results.json`; widen `scrape_live_results.py` `find_target_dates()` lookback to ≥2–3 days; make `inferMode` status-first (FINAL only when a FINAL-status record exists), showing kickoff time or "Result pending" when `actual` is null past kickoff; treat STATUS_SCHEDULED past-kickoff as upcoming/pending (kill phantom LIVE).

- **AC-F3.1** — *Given* South Africa–Canada result is missing, *When* its card renders after kickoff+2h, *Then* it shows the score (backfilled) or an explicit pending/kickoff-time state, never "FINAL" over a bare "vs". → **T-S3**, **T-X3**
- **AC-F3.2** — *Given* `scrape_live_results.py` runs on 2026-06-30, *When* it computes its target window, *Then* a configurable lookback of ≥2 days includes June 28. → **T-S6**
- **AC-F3.3** — *Given* a STATUS_SCHEDULED 0-0 stub whose kickoff just passed, *When* its card renders, *Then* the eyebrow is "upcoming/pending", never "LIVE". → **T-X4**

#### Story F4 — Live Elo handles all knockout finals (BUG-21)
> As a fan, I want live win-probability/Elo to move correctly after ET/penalty knockouts.

**Tasks:** in `live-elo.js`, add `STATUS_FINAL_AET` + `STATUS_FINAL_PEN` to the FINAL set; read `rec.winner` (not `rec.penalty_winner`), mirroring `compute_elo.py`.

- **AC-F4.1** — *Given* a STATUS_FINAL_PEN record (winner=Paraguay, score 1–1), *When* `recomputeElo` runs, *Then* both Germany and Paraguay Elo deltas are non-zero and Paraguay gains more. → **T-Live1**
- **AC-F4.2** — *Given* a STATUS_FINAL_AET record, *When* `recomputeElo` runs, *Then* the match is counted (not skipped) and the winner's Elo increases. → **T-Live2**

#### Story F5 — Status-pill & live windows are stage-aware (BUG-22, BUG-23)
> As a fan, I want the live minute and LIVE/FINAL state to be correct during ET and penalties.

**Tasks:** in `status-pill.js`, prefer the passed-in record (render `LIVE ${actual.minute}'` from real ESPN clock when status is LIVE) and raise the cutoff to ~165–180 min; make the time-fallback windows stage-aware (~2h group, ~3h knockout) in `large-match-card.js` `inferMode`, `home-view.js` `isLive`, and `status-pill.js`; status-first, clock as fallback.

- **AC-F5.1** — *Given* a knockout match with `actual.status=STATUS_SECOND_HALF_EXTRA_TIME` and `actual.minute='105'`, *When* `statusPill(match, actual)` is called, *Then* it renders "LIVE 105'" (real clock), not a wall-clock estimate and not TBD. → **T-Live3**
- **AC-F5.2** — *Given* a knockout match 152 min past kickoff still in STATUS_SHOOTOUT, *When* home LIVE-first ordering and `inferMode` run, *Then* it is treated as live (not final/TBD). → **T-Live4**

#### Story F6 — Live refresh preserves scroll (BUG-24)
> As a fan watching a live game, I don't want the page to jump to the top every 30s.

**Tasks:** distinguish a `data:live-refresh` repaint from a route change in `main.js` — capture `window.scrollY` before `renderView` and restore it when triggered by live-refresh (or do a targeted score/clock patch instead of full `innerHTML` reset).

- **AC-F6.1** — *Given* the live poller emits `data:live-refresh` while the user is scrolled to y=800 on a matchup-detail, *When* the re-render completes, *Then* `window.scrollY` is preserved (not reset to 0). → **T-Live5**

#### Story F7 — Live-data resilience + cache contract (BUG-25, live-minute persistence)
> As a fan, I want scores to survive an ESPN/live-api outage and the edge cache contract to be verified against prod.

**Tasks:** ensure `fetchEspnLive` falls back to direct ESPN on empty-board/error without blanking scores; add backoff + a "scores delayed" indicator on N consecutive poll failures; verify the deployed `/api/live` cache-control (s-maxage/SWR) and add a live network assertion (replace source-string-only test); optionally persist coarse minute + half-specific live statuses in `scrape_live_results.py`.

- **AC-F7.1** — *Given* `/api/live` returns `{board:[]}` with an error (ESPN down), *When* `fetchEspnLive` runs, *Then* it falls back to direct ESPN and scores are not blanked. → **T-Live6**
- **AC-F7.2** — *Given* a live request to deployed `/api/live`, *When* the response headers are inspected, *Then* the effective cache-control matches the intended s-maxage/SWR or the test documents the platform-normalized value. → **T-Live8**

#### Story F8 — Weather/odds parity decision for knockouts (BUG-19 weather/odds half)
> As a fan, I want knockout match pages to either show weather/per-match odds or cleanly suppress the empty widgets.

**Tasks:** suppress the empty per-match odds widget for knockouts short-term (Kalshi has no match markets) and surface API-Football consensus once live; decide weather scope per Gate-1 (fix `scrape_weather.py` to cover the rolling knockout venue/date window, or hide the weather block for knockout pages). Add a data-completeness guard in the freshness popover (flag when `actualResults[stage]` count < schedule stage count with real teams).

- **AC-F8.1** — *Given* a knockout match page with no per-match odds and empty/absent weather, *When* it renders, *Then* the odds/weather widgets either show data or a clean "not available" state — never an empty unlabeled panel. → **T-X-weather**

**DoD (Epic F):** global `currentPhase` drives view branching; empty-state contract enforced on all silent-vanish cards; MOTD works in knockout; missing results show "Result pending" + scraper lookback widened + South Africa–Canada backfilled; live Elo counts AET/PEN; status-pill + windows stage-aware; live refresh preserves scroll; live fallback + cache assertion in place; weather/odds parity resolved; all T-Live* and T-X* (this epic) green.

---

### Epic QA — Test + Regression Suite
*Cross-cutting; locks every AC above.*

#### Story QA1 — Every acceptance criterion has an automated test
> As QA, I want ≥90% AC coverage with a named test per AC, run in CI before deploy.

**Tasks:** implement each `T-*` (§4) as a Node `--test` feature suite (`tests/feature/*.mjs`) or Playwright UX/integrated spec; extend existing `parlay.test.mjs`, `knockout-detail-finals.test.mjs`, `knockout-penalty-winner.test.mjs`, `live-api.test.mjs`, `live-results-resilience.test.mjs` rather than duplicating; add the baselines-to-flip smoke (knockout pairings present in shipped JSON).

- **AC-QA1.1** — *Given* the full test matrix (§4), *When* `npm run test:feature && npm run test:ux && npm run test:integrated` run, *Then* every `T-*` referenced by an AC exists and passes. → all T-*
- **AC-QA1.2** — *Given* the live-site smoke, *When* curling `/data/group_matchups.json`+`/data/knockout_matchups.json`+`/data/markets.json`, *Then* knockout pairings are present (flips the current group-only baseline). → **T-Baseline**

#### Story QA2 — Deploy-target & contract regression locks
> As QA, I want the deploy target, caching contract, and SW version-sync locked so a future change can't silently break them.

- **AC-QA2.1** — *Given* prod served by Netlify, *When* curling `/` and `/data/forecast.json`, *Then* headers include `server: Netlify` and the data file is `application/json` with `cache-control max-age=0 must-revalidate`. → **T-X6**
- **AC-QA2.2** — *Given* `sw.js` VERSION and version-purge APP_VERSION, *When* the version-sync test runs, *Then* they are equal. → **T-X7**

**DoD (Epic QA):** every AC has a passing `T-*`; ≥90% AC coverage (target 100%); `tests/baseline/snapshot.json` updated for knockout; full suite green locally and in CI; new tests added for every fix per the global "regression test for every fix" rule.

---

## 4. Consolidated QA / Regression Test Matrix

Test → AC(s) covered → Epic. Source = RCA `testsNeeded`. Suite: `feature` = Node `--test` (`tests/feature/*.mjs`), `ux`/`integrated` = Playwright, `script` = Python/CLI assertion, `smoke` = network/curl.

| Test ID | Test (what it asserts) | AC(s) | Epic | Suite |
|---------|------------------------|-------|------|-------|
| T-A1 | Concurrent crons editing `actual_results.json` — FINAL score survives (no `-X theirs` loss) | AC-A1.1 | A | script |
| T-A2 | Four workflows serialize via shared `data-writers` concurrency group; no retry storm | AC-A1.2 | A | script |
| T-A3 | `build_hybrid` failure does NOT silently switch model; flagged, not deployed | AC-A2.1 | A | script |
| T-A4 | Empty `consensus_odds`/`injuries` during tournament → `validate_data.py` FAILs | AC-A3.1 | A | script |
| T-A5 | `players.json` frozen >36h → staleness issue (re-)opens, not suppressed | AC-A3.2 | A | script |
| T-A6 | Scraper with zero new data → `__meta__.updated_at` does NOT advance | AC-A3.3 | A | script |
| T-A7 | `rebuild_composite` last writer → canonical `ensure_ascii`, no whole-file diff | AC-A4.1 | A | script |
| T-A8 | No-change daily cron → `meta.data_version` does NOT bump, no deploy | AC-A4.2 | A | script |
| T-C1 | Knockout pairs in `xg.json`/`knockout_matchups.json` → `parlayOfTheDay` returns 3×3 | AC-B2.1, AC-C1.1 | B, C | feature |
| T-C2 | Knockout fixture absent from data → `parlayOfTheDay` null + visible placeholder | AC-C2.1 | C | feature |
| T-C4 | Empty consensus but model+xG present → 3 parlays, label "hourly market" | AC-C1.2 | C | feature |
| T-C5 | `markets.match_outcomes` len 0 → Moneyline falls back to model-only, no crash | AC-C1.3 | C | feature |
| T-Cov-xg | `validate_data.py` asserts xG entry for every named upcoming match | AC-B2.1, AC-B4.1 | B | script |
| T-Cov-ko | `validate_data.py` fails when resolved knockout lacks `knockout_matchups` row | AC-B4.2 | B | script |
| T-B-schema | `knockout_matchups` row is a field-superset of a `group_matchups` row (+`to_advance`) | AC-B1.2 | B | feature |
| T-D1 | Knockout matchup-detail (Belgium–Senegal) analytics region not blank, no throw | AC-D1.1 | D | ux |
| T-D2 | `resolveMatch` returns full model row for Mexico–Ecuador, `hasModel===true` | AC-B1.1, AC-D1.2 | B, D | feature |
| T-D3 | `confidenceBar(match)` with `probabilities===undefined` does not throw | AC-D2.1 | D | feature |
| T-D4 | `matchupCard(match,data)` with `win_confidence_pct===undefined` does not throw | AC-D2.2 | D | feature |
| T-D5 | Market column shows tournament-winner fallback for knockout, no throw | AC-D3.1 | D | feature |
| T-E1 | Brazil–Japan (2-1, FULL_TIME, no `winner`) → "Final result: Brazil won" + highlight | AC-E2.1 | E | ux |
| T-E2 | Regulation knockout win on Home/Schedule cards → winner highlighted, eyebrow "FT" | AC-E1.1 | E | ux |
| T-E3 | STATUS_FINAL_PEN → label "pens (4–3)" not "FT", winner highlighted | AC-E1.2 | E | feature/ux |
| T-E4 | STATUS_FINAL_AET → label "AET"/"after extra time", winner highlighted | AC-E1.3 | E | feature/ux |
| T-E5 | Scraper: regulation knockout (sa≠sb) → `rec.winner` set + method marker | AC-B3.1 | B | script |
| T-E6 | STATUS_SCHEDULED 0-0 stub → no winner highlight, no "Final result" (negative) | AC-E1.4 | E | feature/ux |
| T-S1 | `#/schedule/date/2026-06-30` lists each R32 fixture with kickoff+venue+broadcast, correct stage label | AC-C4.2 | C | ux |
| T-S3 | Missing South Africa–Canada record → card NOT "FINAL · vs"; score or pending | AC-F3.1 | F | ux |
| T-S4 | W#/L# placeholder row → placeholder labels, non-tappable, kickoff+venue+broadcast | AC-C3.2 | C | ux |
| T-S5 | `resolve_knockouts` overwrites `kickoff_utc` → local fields convert back to it | AC-C4.1 | C | script |
| T-S6 | `scrape_live_results` lookback ≥2 days includes June 28 | AC-F3.2 | F | script |
| T-Live1 | STATUS_FINAL_PEN → both Elo deltas non-zero, winner gains more | AC-F4.1 | F | feature |
| T-Live2 | STATUS_FINAL_AET → match counted, winner Elo increases | AC-F4.2 | F | feature |
| T-Live3 | ET status + minute='105' → `statusPill` "LIVE 105'", not estimate/TBD | AC-F5.1 | F | feature |
| T-Live4 | 152 min, STATUS_SHOOTOUT → treated as live (not final/TBD) | AC-F5.2 | F | feature |
| T-Live5 | `data:live-refresh` at scrollY=800 → scroll preserved | AC-F6.1 | F | ux |
| T-Live6 | `/api/live` empty-board+error → falls back to direct ESPN, scores not blanked | AC-F7.1 | F | feature |
| T-Live7 | Knockout matchday → `renderMatchOfTheDayChip` produces a chip (not null) | AC-F2.1 | F | feature |
| T-Live8 | Deployed `/api/live` cache-control matches intended SWR or documents normalized value | AC-F7.2 | F | smoke |
| T-X1 | R32 phase → Home "Don't miss" shows knockout or empty-state, never absent | AC-F1.1, AC-F2.1 | F | ux |
| T-X2 | Knockout day, all inputs empty → Parlay shows labelled empty-state, not empty fragment | AC-C2.1 | C/F | ux |
| T-X3 | Missing result card after kickoff+2h → "Result pending", not "FINAL · vs" | AC-F3.1 | F | ux |
| T-X4 | STATUS_SCHEDULED 0-0 just past kickoff → eyebrow "upcoming/pending", never LIVE | AC-F3.3 | F | feature/ux |
| T-X5 | Tap resolved knockout on Schedule → navigates to `#/matchup/...`, detail renders | AC-C3.1 | C | ux |
| T-X6 | Prod served by Netlify; data file `application/json` + `max-age=0 must-revalidate` | AC-QA2.1 | QA | smoke |
| T-X7 | `sw.js` VERSION === version-purge APP_VERSION | AC-QA2.2 | QA | feature |
| T-X8 | Knockout matchup-detail, `win_confidence_pct` absent → grid omitted, sections render, no throw | AC-D3.2 | D | ux |
| T-X-weather | Knockout page with no odds/weather → clean "not available" state, no empty panel | AC-F8.1 | F | ux |
| T-Baseline | Shipped JSON: knockout pairings present in `group_matchups`/`knockout_matchups`/`markets` (flips group-only baseline) | AC-QA1.2 | QA | smoke |

**Coverage:** 50 ACs across Epics A–F + QA; 49 mapped to ≥1 distinct test (T-Baseline + per-epic tests). Every AC has a corresponding test ID → **100% AC test coverage** (exceeds the ≥90% gate). Per the global rule, every fix also adds/extends a regression test locking the exact behavior changed.

---

## 5. Definition of Done

### Per-Epic DoD
- **Epic A:** Stories A1–A4 ACs pass; one shared concurrency group; no `-X theirs` clobber path; atomic model chain; validation fails on dark/empty/stale; canonical encoding; once-only conditional `data_version`; `APIFOOTBALL_KEY` secret added.
- **Epic B:** `knockout_matchups.json` (group-superset + `to_advance`) and knockout `xg.json` generated for all resolved fixtures; scraper writes winner+method for all completed knockouts; coverage gates in `validate_data.py`; builder wired into the `resolve_knockouts` Actions step.
- **Epic C:** Parlay renders 3×3 on knockout days with labelled empty-state fallback; knockouts clickable; placeholders non-tappable; `canonical_matchups` covers knockouts; local-time fields consistent; dead stage-map code removed.
- **Epic D:** Knockout matchup-detail renders the full grid with "to advance %" headline; render helpers null-safe; market column decoupled from `hasModel`.
- **Epic E:** Cards highlight winner + show method (FT/AET/pens) with ADA-safe textual marker; matchup-detail derives winner from score with correct method; single FINAL-status source of truth; bracket advancement + pick-scoring regression-locked unchanged.
- **Epic F:** Global `currentPhase` branching + empty-state contract; MOTD works in knockout; missing results show "Result pending" + lookback widened + South Africa–Canada backfilled; live Elo counts AET/PEN; status-pill + windows stage-aware; live refresh preserves scroll; live fallback + cache assertion; weather/odds parity resolved.
- **Epic QA:** every AC has a passing `T-*`; ≥90% (target 100%) AC coverage; baseline snapshot updated for knockout; deploy-target + caching + SW version-sync locked.

### Overall DoD (Gate 4 preconditions)
1. **100% regression green** — `npm run test:feature`, `npm run test:ux`, `npm run test:integrated`, `bash tests/smoke.sh`, and `python3 scripts/validate_data.py` all pass; the full matrix in §4 passes.
2. **No silent-vanish surfaces remain** — every Home/Schedule/matchup card returns content or a labelled empty-state (no null/empty `DocumentFragment`).
3. **Knockout data coverage gates are red-on-gap** — validation fails if a resolved knockout fixture lacks model/xG/result rows.
4. **Pipeline race closed** — single cross-workflow concurrency group; no `-X theirs` clobber; atomic writes; canonical encoding; conditional `data_version`.
5. **Auto-deploy on green** — once all the above are green, deploy via the documented Netlify path; merge to `main` race-safe (`pull --ff-only`, merge, push).
6. **Prod verification** — after deploy, `curl` the deployed `/`, `/data/knockout_matchups.json`, `/data/group_matchups.json`, `/data/actual_results.json` (or load in Chrome) and confirm: knockout pairings present, South Africa–Canada result present, parlay/MOTD/matchup-grid render, winner highlight + method visible. Do not assume it shipped.
7. **Rollback ready** — one-line revert of the deploy commit (`git revert <sha> && git push`, Netlify auto-redeploys previous), stated before deploy. Outward-facing/hard-to-reverse steps confirmed with owner first.

---

## 6. Traceability Summary

| Epic | Stories | ACs | BUGs closed |
|------|---------|-----|-------------|
| A | 4 | 8 | BUG-1, 2, 3, 4, 5, 6, 7 |
| B | 4 | 6 | BUG-8(data), 9(data), 10(data), 17(data) |
| C | 4 | 8 | BUG-8(consume), 15, 18, 19(odds), 20(parlay), 27, 28 |
| D | 3 | 6 | BUG-9(consume), 16, 26 |
| E | 2 | 5 | BUG-10(render), 11, 12, 17(render) |
| F | 8 | 12 | BUG-13, 14, 19(weather/odds), 20(MOTD), 21, 22, 23, 24, 25 + phantom-LIVE/live-minute |
| QA | 2 | 5 | — (locks all of the above) |
| **Total** | **27** | **50** | **all 28 BUGs** |

> Note: several BUGs are split data/render across two epics (8, 9, 10, 17, 19, 20) — each half is closed by its owning epic; the BUG is fully closed only when both halves and their tests are green. Disjoint file ownership per epic (Pipeline YAMLs+scripts / new builder / parlay+schedule / matchup-detail+components / cards+styles / live+phase) supports parallel build per the concurrency rule.
