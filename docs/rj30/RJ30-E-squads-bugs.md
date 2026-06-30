# RJ30-E — Squads refresh + deferred bug bundle

Epic owner: senior product+QA. Scope: two items — **RJ30-7** (unfreeze
`players.json` via free ESPN rosters, blend live goals without destabilizing the
Golden Boot / Awards model) and **RJ30-9** (a five-part deferred bug bundle).
Every item is **zero additional cost** (free ESPN endpoints already used by the
pipeline, existing data, pure code). iOS-first PWA, mobile 390×844.

Grounding (files read): `data/players.json` (flat list, 1197 rows, frozen
2026-05-27), `scripts/update_squads.py`, `scripts/scrape_lineups.py`,
`scripts/scrape_scorers.py`, `scripts/update_espn.py`, `scripts/_common.py`,
`app/lib/golden-boot.js`, `app/lib/golden-awards.js`, `scripts/check_staleness.py`,
`scripts/validate_data.py` (`check_players`, `--strict`),
`live-api/api/live.js`, `app/views/schedule-view.js`,
`scripts/scrape_live_results.py`, `app/components/large-match-card.js`,
`app/lib/match-status.js`, `app/views/home-view.js`, `app/views/matchup-detail.js`,
`app/components/status-pill.js`, `app/live-scores.js`,
`.github/workflows/daily_update.yml`, `tests/feature/winner-highlight.test.mjs`,
`tests/feature/live-api.test.mjs`.

---

## RJ30-7 — Unfreeze players.json / squad refresh (free ESPN rosters)

### Context (how the code actually works)

- `data/players.json` is a **flat JSON list** (not keyed by team). Each row:
  `{ name, team, group, position, club, caps, age, goals, overall, pace,
  defense, offense, scoring, efficiency }`. `position` ∈ `{GK,DEF,MID,FWD}`.
  Frozen since 2026-05-27 (`ls` mtime + `check_staleness.py` comment).
- It feeds **Golden Boot** (`app/lib/golden-boot.js`): `projectPlayer()` uses
  `player.scoring` (fallback `offense`), `player.position` (`posWeight`),
  `player.team`; live goals come from `scorers.json` + `match_events.json` via
  `liveGoalsByPlayer()` — **NOT** from `players.json.goals`. `players.json.goals`
  is the **pre-tournament career** count and is *not* read by the Boot live path.
- It feeds **Awards** (`app/lib/golden-awards.js`): Ball/Young use
  `p.overall`, `p.offense`, `p.age`, `p.position`; Glove uses `p.overall` for GKs.
  These are **z-scored across the whole field** — so changing the *set* of rows
  (roster churn) shifts every player's z-score. This is the destabilization risk.
- `update_squads.py` today only sets `injury_status` from ESPN article keyword
  matches; it never refreshes the roster or ratings.
- `scrape_scorers.py` already resolves a team→ESPN-team-id and hits
  `/teams/{tid}/statistics` and `/teams?search={team}`. The roster endpoint
  `/teams/{tid}/roster` (or `/teams/{tid}` with `?enable=roster`) is the same
  free `site.api.espn.com/.../soccer/fifa.world` family — **zero cost**.
- `check_staleness.py` **deliberately excludes** `players.json` from `WATCH`
  (age alarm) because rosters were expected to be frozen; it keeps it in
  `EMPTY_WATCH` (emptiness alarm). Once we refresh actively, revisit this.
- `validate_data.check_players()` requires: non-empty list; each row a dict with
  a truthy `name` and a `team` ∈ `teams.json` keys; `position` warned (not
  errored) if outside `VALID_POSITIONS`. **Any refresh must preserve these.**

### Design decision — preserve the model, refresh the roster

The model must NOT be destabilized. The base ratings (`overall/scoring/offense/
defense/pace/efficiency`) are derived offline from Transfermarkt/Elo blends and
have no free per-player live source. So:

- **Preserve base ratings** for every player already present (match by
  `(team, normalized-name)`). Never recompute `overall/scoring/...` from the
  roster feed.
- **Update roster membership only**: drop players ESPN no longer lists for an
  **ACTIVE** team (cut/left squad), add new call-ups with a **conservative
  default rating** (so a new name can't accidentally top the Boot/Ball),
  refresh `club`, `caps`, `age` when ESPN provides them.
- **Blend live goals into `players.json.goals`** as the *career+tournament*
  count (display only) — but the Boot live path stays on `scorers.json` /
  `match_events.json`, so this is cosmetic and cannot move odds.
- **Active-team gating**: only refresh teams still alive in the tournament
  (eliminated teams keep their last-known squad so their players stay z-scoreable
  and historical pages don't blank). "Active" = team appears in
  `forecast.json` with any remaining round-reach prob, OR has a future fixture in
  `schedule_full.json`. Eliminated → untouched.

### User stories

**US-7.1** — As the model maintainer, I want active-team squads refreshed from
free ESPN rosters so Golden Boot / Awards reflect the *current* 26-player squads,
not the May-27 snapshot, **so that** a cut player no longer projects and a
call-up appears.

- **Given** team `T` is active and ESPN lists player `P` not in `players.json`,
  **When** the refresh runs, **Then** `P` is appended with `team=T`, ESPN
  `club/age` if present, and **default ratings** (`overall=50, scoring=30,
  offense=30, defense=50, pace=40, efficiency=50, goals=0`), `position` mapped to
  `{GK,DEF,MID,FWD}`.
- **Given** existing player `Q` (team `T`) is **absent** from ESPN's current
  roster for active `T`, **When** the refresh runs, **Then** `Q` is removed from
  `players.json`.
- **Given** player `R` already in `players.json` and still on ESPN's roster,
  **When** the refresh runs, **Then** `R`'s `overall/scoring/offense/defense/
  pace/efficiency` are **byte-identical** (preserved); only `club/caps/age`/
  `goals` may update.

**US-7.2** — As the model maintainer, I want eliminated teams left untouched
**so that** the z-scored Awards field stays stable and eliminated teams' pages
don't blank.

- **Given** team `E` is eliminated, **When** the refresh runs, **Then** every
  `players.json` row with `team=E` is unchanged.

**US-7.3** — As a fan, I want live tournament goals reflected on a player's
career goal count **so that** the squad/awards displays feel current — without
moving the deterministic Boot odds.

- **Given** `match_events.json`/`scorers.json` credit `P` with N tournament
  goals, **When** the refresh runs, **Then** `players.json[P].goals` ≥ its
  pre-refresh value (max-merge, never decremented), AND
  `goldenBootProjections()` output for a fixed `{seed, sims}` is **identical**
  before/after (Boot reads live goals from events, not `players.json.goals`).

**US-7.4** — As the on-call, I want the refresh to be safe-by-default
**so that** an ESPN outage never empties or corrupts `players.json`.

- **Given** ESPN returns nothing / errors for team `T`, **When** the refresh
  runs, **Then** `T`'s existing rows are kept unchanged and the script exits 0.
- **Given** the refresh would shrink the list below a floor (e.g. < 600 rows or
  drop > 40% of any active team's prior count), **When** writing, **Then** abort
  the write for that team (keep prior) and log a warning. `--strict` validate
  still passes.

### Tasks (exact files / functions / data flow / free source)

1. **New `scripts/refresh_players.py`** (preferred over extending
   `update_squads.py`, which owns injury-status and must stay single-purpose):
   - Reuse `_common.load_json/save_json/log/update_meta` (note `save_json` writes
     `ensure_ascii=True, indent=2` — matches on-disk encoding, **no churn**).
   - Reuse `scrape_scorers.py`'s team→ESPN-id resolution
     (`/teams?search={team}` → `sports[0].leagues[0].teams[*].team.id`).
   - Free endpoint: `GET https://site.api.espn.com/apis/site/v2/sports/soccer/
     fifa.world/teams/{tid}/roster` → `athletes[*]` each
     `{ displayName, position:{abbreviation}, age }` (+ club via
     `athlete.team`/links when present). Same UA/throttle pattern as
     `scrape_lineups.py` (`MIN_INTERVAL` ≈ 0.7s).
   - `POSITION_MAP`: ESPN abbrevs → `{G→GK, D→DEF, M→MID, F→FWD}`
     (default `MID` for unknown so the Boot still considers them at MID weight).
   - **Active set**: `active = {team : team has any future fixture in
     schedule_full.json OR any remaining round prob in forecast.json}`. Build it
     once.
   - **Name normalization** to merge ESPN↔squad spellings: reuse the SAME
     accent/punct strip the app uses — `golden-boot.js normPlayerName` semantics
     (`NFD` strip diacritics, lowercase, alnum-only). Implement a Python twin
     `norm_name()` and keep a one-line comment cross-referencing
     `app/lib/golden-boot.js`.
   - **Merge algorithm** per active team:
     - Index existing rows by `norm_name`.
     - For each ESPN athlete: if matched → preserve ratings, update
       `club/age`; if unmatched → append default-rated row (`group` copied from
       any existing teammate row, else from `teams.json[team].group`).
     - Drop existing rows whose `norm_name` is absent from ESPN's roster **only
       when** the safety floor holds (see US-7.4); else keep all prior rows.
   - **Live-goal merge** (after roster merge, all teams): build
     `tournament_goals` from `match_events.json` (`events[].type ∈ {goal,
     pen-goal}` by `e.player`) + `scorers.json`, keyed by `norm_name`; set
     `row.goals = max(row.goals, career_or_prev + tournament)` — **max-merge,
     never decrement**. (Career base is the existing `goals`; we add tournament
     goals on top once, guarded by a `_goals_base` shadow field? NO — to stay
     diff-minimal and deterministic, store `goals = max(existing_goals,
     tournament_goals)` so re-runs are idempotent and never inflate.)
   - Exit 0 always (wrap `main()` like `scrape_lineups.py`).

2. **Wire into `.github/workflows/daily_update.yml`** as a `continue-on-error`
   step in the Phase-1 block, **after** `update_squads.py` (injury flags) and
   **before** `rebuild_composite.py` (composite doesn't read players.json, but
   ordering keeps roster edits grouped with the other roster step). Step name:
   `Refresh active squads (ESPN rosters)`. Crons are throttled — daily cadence is
   correct (rosters change slowly).

3. **`scripts/check_staleness.py`** — revisit the exclusion: now that
   `players.json` is actively refreshed for active teams, **add
   `data/players.json` to `WATCH`** (age alarm) but raise the comment to note it
   refreshes daily; keep it in `EMPTY_WATCH`. Guard: only alarm during the
   tournament window (already gated). This converts the old "expected-frozen"
   false-positive into a real "refresh stopped" signal.

4. **No app changes.** `golden-boot.js`/`golden-awards.js` consume the same
   shape; default-rated call-ups slot in with low z-scores. Confirm
   `VALID_POSITIONS` superset includes our mapped values.

### Edge cases

- **New call-ups** → default-rated, low z-score, cannot top Boot/Ball/Glove.
- **Cut / injured** → removed from active rosters (subject to safety floor);
  `update_squads.py` injury flags still apply on the surviving rows.
- **Name mismatches** (José ↔ Jose, Quiñones ↔ Quinones) → `norm_name` merge,
  identical to the app's normalizer, so we never duplicate a player.
- **ESPN team-id resolution miss** → skip that team (keep prior rows), log.
- **Eliminated teams** → untouched (z-score stability + page non-blanking).
- **Determinism** → Boot/Awards must produce identical output for a fixed
  `{seed, sims}` since base ratings are preserved and live goals come from
  events; `players.json.goals` is display-only for these models.
- **Idempotency** → re-running the same day produces no diff (max-merge goals,
  preserved ratings, sorted-stable append order: append new rows at the **end**
  of that team's block in first-seen ESPN order; do not re-sort the whole list).
- **`ensure_ascii=True`** on write to avoid diff churn (per `_common.save_json`).
- **iOS quirks**: none (pure data pipeline; no UI). The downstream Boot/Awards
  views already render this shape on iOS Safari.

### QA test scripts

**`tests/feature/refresh-players.test.mjs`** (node:test) — pure-logic guards on
the *output contract* (Python is exercised by a small fixture run in CI; the
node test locks the invariants the app depends on):

- *Given* current `data/players.json`, *When* loaded, *Then* it is a non-empty
  list and every row has `name` (truthy), `team` ∈ `data/teams.json` keys,
  `position` ∈ `{GK,DEF,MID,FWD}`. (Mirrors `validate_data.check_players`,
  guards the refresh output.)
  - Selectors/assertions: `JSON.parse(read('data/players.json'))`,
    `assert.ok(Array.isArray(players) && players.length > 600)`;
    `for (p of players) assert.ok(p.name); assert.ok(teamKeys.has(p.team));
    assert.ok(['GK','DEF','MID','FWD'].includes(p.position))`.
- *Given* the same data, *Then* **no duplicate** `(team, normPlayerName(name))`
  pairs exist (the merge must not double-insert).
  - `const seen=new Set(); for(p of players){const k=p.team+'|'+normPlayerName(p.name); assert.ok(!seen.has(k), 'dup '+k); seen.add(k);}`
    (import `normPlayerName` from `app/lib/golden-boot.js`).
- *Given* a synthetic `data` object with a fixed `players` field where one row's
  `goals` is bumped vs another otherwise identical, *When* `goldenBootProjections(
  data, {seed:1234567, sims:2000})` runs twice (goals bumped / not), *Then*
  `bootPct` arrays are **deeply equal** — proving `players.json.goals` does not
  move the deterministic Boot.
  - Build two `data` clones, mutate `data2.players[i].goals += 5`, assert
    `deepEqual(proj1.map(c=>[c.player,c.bootPct]), proj2.map(...))`.

**`tests/feature/refresh-players-merge.test.mjs`** (node:test) — extract the
pure merge into a tiny exported helper so it is unit-testable from JS *or* keep
it Python-only and test via the Python script's `--self-test`. **Recommend**:
add a Python `--self-test` mode to `refresh_players.py` and run it in
`tests/smoke.sh`:

- *Given* prior rows `[{name:'Old Star', team:'X', overall:88, scoring:90}]`
  and an ESPN roster `[{displayName:'Old Star'},{displayName:'New Kid'}]` for
  active team X, *When* merged, *Then* `Old Star` keeps `overall=88, scoring=90`
  and `New Kid` is appended with `overall=50, scoring=30`.
- *Given* active team X prior `[A,B,C]` and ESPN roster `[A,B]`, *Then* `C` is
  dropped (floor allows 1 drop of 3 = 33% < 40%).
- *Given* ESPN returns `[]` for X, *Then* prior `[A,B,C]` are **kept** and exit
  code 0.
- *Given* eliminated team `E`, *Then* its rows are unchanged regardless of ESPN.

**`scripts/validate_data.py --strict`** (existing gate) — must stay green after a
real refresh run. Add to smoke: run `python3 scripts/refresh_players.py` once
(network-tolerant, exits 0), then `python3 scripts/validate_data.py --strict`.

### iOS / UX notes

No UI surface. The Golden Boot and Awards views already render the flat-list
shape on iOS Safari 390px; default-rated call-ups appear low in the list (or out
of the 120-pool entirely) — no layout change, no safe-area impact.

### Files touched / new

- **New**: `scripts/refresh_players.py`,
  `tests/feature/refresh-players.test.mjs`,
  `tests/feature/refresh-players-merge.test.mjs` (or Python `--self-test`).
- **Modified**: `.github/workflows/daily_update.yml` (one step),
  `scripts/check_staleness.py` (WATCH list + comment), `tests/smoke.sh`
  (refresh + strict-validate line).
- **Data (generated)**: `data/players.json` (refreshed; not hand-edited).

---

## RJ30-9 — Deferred bug bundle (5 parts)

Each part is small and independent. Files are disjoint except both (b) and (d)
touch view-layer code (different files), so they can run as separate partitions.

### (a) `live-api/api/live.js` cache-control header vs comment

**Bug**: the file-top doc comment (line 7) says scores are *"<=15s-fresh"* but
the actual header is `cache-control: public, s-maxage=10, ...` (line 75) and the
inline comment on line 74 says *"<=10s fresh"*. The header value is **correct**
and is **locked by a test** (`tests/feature/live-api.test.mjs:90` asserts
`/s-maxage=10/`). So the **header stays**; only the stale top-comment is wrong.

**US-9a** — As a maintainer, I want the file header comment to match the actual
cache TTL **so that** the documented freshness isn't misleading.

- *Given* `live.js`, *When* read, *Then* the top comment says `<=10s-fresh` (or
  removes the number), consistent with `s-maxage=10` and the line-74 comment.

**Task**: Edit `live-api/api/live.js` line 7 comment `"<=15s-fresh"` → `"<=10s-fresh"`.
No code change. (If product instead wants 15s freshness, that's a *header*
change `s-maxage=10`→`15` + update the test — see OPEN QUESTION.)

**Edge**: none — comment only. Deploy note: `live-api/` deploys via Vercel CLI
separately (`cd live-api && vercel deploy --prod --yes --scope liddar-terminal`);
a comment-only change needs no redeploy, but redeploy is harmless.

**QA** — extend `tests/feature/live-api.test.mjs`:
- *Given* `live-api/api/live.js` source, *Then* the doc comment freshness number
  matches the header: `assert.ok(!/<=\s*15s/.test(src), 'stale 15s comment gone')`
  and `assert.match(src, /s-maxage=10/)` (existing) — i.e. the file does not
  claim a TTL the header doesn't honor.

### (b) Delete dead `schedule-view.js` `scheduleCard()` / `prettyStage()` / `formatKickoffLocal()`

**Bug**: `app/views/schedule-view.js` defines `scheduleCard()` (lines 169–218),
`prettyStage()` (220–230), `formatKickoffLocal()` (232–244) that are **never
called within the file** — the active `renderScheduleView()` uses
`largeMatchCard` + `actualForCard`. Confirmed via grep: those three names have
**no call sites** inside `schedule-view.js` (only their own defs), and they are
file-local (not exported). `prettyStage`/`formatKickoffLocal` exist elsewhere as
*separate* file-local copies (`home-view.js`, `large-match-card.js`,
`calendar-export.js`) — deleting the schedule-view copies does not affect them.

**Important — keep**: `utcDateISO`, `toLocalDateISO`, `shortLocalDate`,
`formatLocalDateISO` ARE still used by `renderScheduleView` (lines 38, 54, 190,
191). Only the three named functions (and nothing they uniquely need) get
deleted. `formatKickoffLocal` is the only user of `_tz` param — safe to drop.

**US-9b** — As a maintainer, I want dead code removed **so that** the module is
smaller and future readers aren't misled into editing an unused card renderer.

- *Given* `schedule-view.js`, *When* the three functions are deleted, *Then*
  `renderScheduleView` still renders identically and the full regression gate is
  green.

**Task**: delete lines defining `scheduleCard`, `prettyStage`,
`formatKickoffLocal` from `app/views/schedule-view.js`. Verify the four retained
date helpers remain. No CSS change (`.schedule-card` styles may stay; they're
also referenceable from other places — leave CSS untouched, scope is JS).

**Edge**: ensure no other module imports these (they're not exported — grep
confirmed zero cross-file references to `scheduleCard`; the `prettyStage`/
`formatKickoffLocal` matches in other files are independent local defs).

**QA** — `tests/feature/schedule-deadcode.test.mjs` (node:test):
- *Given* `app/views/schedule-view.js` source, *Then* it does **not** contain
  `function scheduleCard`, `function prettyStage`, or `function formatKickoffLocal`.
  - `assert.ok(!/function scheduleCard\b/.test(src))` ×3.
- *Given* the source, *Then* it **still** contains `function utcDateISO`,
  `toLocalDateISO`, `shortLocalDate`, `formatLocalDateISO` (regression: don't
  delete live helpers).
- Existing `tests/ux/*` schedule specs + `tests/integrated/happy-path.spec.mjs`
  must stay green (Playwright renders the schedule view) — no new UX test
  required, but run them as the guard.

### (c) Persist live MINUTE in `scrape_live_results.py` → `actual_results.json`

**Bug**: `scrape_live_results.py` writes `{score_a, score_b, kickoff_utc,
status, winner?, method?, shootout?}` but **never `minute`**. The in-memory
overlay path (`app/live-scores.js mergeLiveScores`, fed by the Vercel `/api/live`
edge fn) *does* set `rec.minute` from ESPN's `displayClock`. So a fan who loads
the page **before** the live poller fires sees a LIVE card with no clock. The
durable record should carry the minute too (ESPN scoreboard exposes it:
confirmed `status.type.displayClock` e.g. `"90'+8'"`, and `live.js` extracts it
as `String(rawClock).replace(/'+$/, '')`).

**US-9c** — As a fan loading the page mid-match, I want the live minute shown on
the card immediately from the committed data **so that** I don't have to wait for
the client poller to populate the clock.

- *Given* an in-progress match, *When* `scrape_live_results.py` runs, *Then* the
  `actual_results.json` record includes `minute` (e.g. `"67"`), stripped of the
  trailing `'`, mirroring `live.js`/`live-scores.js` formatting.
- *Given* a FINAL match, *Then* `minute` is **omitted** (cards show FT/method,
  not a clock) — consistent with the live overlay which only sets minute for
  LIVE.
- *Given* ESPN has no `displayClock`, *Then* the record simply has no `minute`
  field (graceful).

**Task**: in `scripts/scrape_live_results.py parse_result()`:
- Pull `display_clock` from the comp status passed in. Currently `parse_result`
  receives `status_type` only — extend the call to also pass the status block's
  `displayClock`. In `main()`, read
  `dc = (comps.get("status",{}).get("type",{}) or {}).get("displayClock")` (note:
  ESPN puts `displayClock` under `status` and/or `status.type` — match
  `live.js` which reads `comp.status?.displayClock`; use
  `comps.get("status",{}).get("displayClock")` with a `type` fallback).
- Add `minute` to `rec` **only when** `status_type` is in `STATUS_IN_PROGRESS`
  (i.e. a LIVE status — never on STATUS_COMPLETE): `rec["minute"] =
  str(dc).rstrip("'")` when `dc`.
- Keep `ensure_ascii=True`/`indent=2` write unchanged (it already uses
  `ensure_ascii=False` — **note**: this file currently writes
  `ensure_ascii=False`; leave AS-IS, do not change encoding in this bugfix to
  avoid churn — minute values are ASCII anyway).
- The app already consumes `rec.minute` (`large-match-card.js:227`,
  `status-pill.js`, `matchup-detail.js:95`), so no app change needed.

**Edge**: ET/shootout statuses are LIVE (`STATUS_OVERTIME`, `STATUS_SHOOTOUT`,
etc.) — but `scrape_live_results.STATUS_IN_PROGRESS` only lists
`{STATUS_IN_PROGRESS, STATUS_HALFTIME, STATUS_END_PERIOD}`. **Scope-guard**: only
persist minute for the statuses this scraper already treats as in-progress; do
NOT expand the live-status set here (that's a separate concern and would change
which rows are written). Halftime minute may be `"45'"` or empty — strip and
store whatever ESPN gives.

**QA** — `tests/feature/live-minute-persist.test.mjs` (node:test, pure on the
*shape*) + a Python `parse_result` self-test:
- The JS test imports nothing new; it asserts the **consumer** contract is
  intact: load `data/actual_results.json`; for any record whose `status` ∈
  LIVE set, if `minute` present it is a clock string with no trailing `'`.
  - `assert.ok(typeof rec.minute === 'string' && !rec.minute.endsWith("'"))`.
- Add `parse_result` unit assertions (Python `--self-test` in
  `scrape_live_results.py`, run from `tests/smoke.sh`):
  - *Given* `status_type='STATUS_IN_PROGRESS'`, `displayClock="67'"`, *Then*
    `rec['minute']=='67'`.
  - *Given* `status_type='STATUS_FULL_TIME'`, `displayClock="90'+5'"`, *Then*
    `'minute' not in rec` (final → no clock).
  - *Given* `displayClock=None`, *Then* `'minute' not in rec`.

### (d) Browser-verify + fix ET/pen winner highlight on Home/Schedule cards

**Bug to verify**: a knockout decided in ET/pens (e.g. Morocco/Netherlands or
Germany/Paraguay) should show the advancing team with `.is-winner` and a method
tag `pens (x–y)` on the Home and Schedule large cards.

**Analysis (from code read)**: the *logic* is already correct and unit-locked —
`winner-highlight.test.mjs` already asserts `actualForCard` returns
`winner='Morocco'`, `method.method='pens'`, `method.suffix=' (3–2)'` for a
`STATUS_FINAL_PEN` row, and `large-match-card.js` applies `is-winner` on
`aWins`/`bWins` and renders `lcard-method`. **What is NOT covered** is a
**browser DOM render** assertion — line 174 of that test is `skip`ped under node
(`typeof document === 'undefined'`). So the deferred work is: **add a Playwright
spec that renders a real ET/pen final card and asserts the visual highlight +
`pens (x–y)` tag**, and fix anything the browser run surfaces.

The method tag in the eyebrow currently renders `methodTag.label` only
(`pens`), **not** the `suffix` `(x–y)`. The task spec says the card should read
`'pens (x-y)'`. Check: `large-match-card.js:75-76` builds the tag from
`methodTag.label` and **omits `suffix`**. The matchup-detail view *does* append
`mov.suffix`. **Fix**: include `methodTag.suffix` in the large-card eyebrow tag
so the Home/Schedule card reads `pens (3–2)` (en-dash), matching the detail view
and the task's `'pens (x-y)'` requirement.

**US-9d** — As a fan, I want an ET/pen knockout card to show the advancing team
highlighted and a `pens (3–2)` tag **so that** I can see who went through and how
without opening the matchup.

- *Given* a `STATUS_FINAL_PEN` record (Netherlands 1–1 Morocco, winner Morocco,
  shootout 2–3), *When* the Home or Schedule large card renders, *Then* the
  Morocco team element has class `is-winner`, Netherlands does **not**, and the
  eyebrow shows `FINAL pens (3–2) · Round of 32` (en-dash, hi–lo).
- *Given* a `STATUS_FINAL_AET` record, *Then* the tag reads `AET` (+ no shootout
  suffix), winner = higher score or explicit winner.
- *Given* a regulation `STATUS_FULL_TIME` 2–0, *Then* tag `FT`, higher-score
  team `is-winner`.

**Task**:
- `app/components/large-match-card.js`: line ~75 — append the shootout suffix to
  the method tag: change the tag template to include `methodTag.suffix`, e.g.
  `>${escapeHtml(methodTag.label)}${escapeHtml(methodTag.suffix || '')}<`. This is
  the only code change; highlight wiring already exists.
- **Browser-verify** Home (`home-view.js`) and Schedule (`schedule-view.js`)
  both forward `winner`/`method` (confirmed: home-view:531-532,
  schedule-view:144-146) → no change needed there.

**Edge**: en-dash vs hyphen — `methodOfVictory.suffix` uses en-dash `–`; the task
text writes `x-y` informally. **Match the existing app convention (en-dash)** to
stay consistent with matchup-detail; tests assert the en-dash. Draw with no
explicit winner → no `is-winner` (correct). Live record → no tag, no highlight.

**QA** — two layers:

1. **Extend `tests/feature/winner-highlight.test.mjs`** (the existing
   browser-only block, run under Playwright/jsdom):
   - *Given* `largeMatchCard({team_a:'Netherlands', team_b:'Morocco',
     stage:'round_of_32', kickoff_utc:...}, {mode:'final', actual:{score_a:1,
     score_b:1}, winner:'Morocco', method: methodOfVictory({status:
     'STATUS_FINAL_PEN', shootout_a:2, shootout_b:3})})`, *Then*
     `card.outerHTML` matches `/lcard-team-b[^"]*is-winner/` (Morocco is side b),
     does NOT match `/lcard-team-a[^"]*is-winner/`, and matches `/pens \(3–2\)/`.

2. **New `tests/ux/rj30-winner-highlight.spec.mjs`** (Playwright, mobile 390×844):
   - Seed a fixture: inject an `actual_results.json` with a `round_of_32`
     `Netherlands__vs__Morocco` `STATUS_FINAL_PEN` record (winner Morocco,
     shootout 2–3) and a matching `schedule_full.json`/home feed via the test's
     data-stub mechanism used by existing `tests/ux/r19-golden-boot.spec.mjs`.
   - *Given* the Home view, *When* the card for that match renders, *Then*:
     - `page.locator('[data-testid="large-match-card"][data-team-a="Netherlands"]
       [data-team-b="Morocco"] .lcard-team-b.is-winner')` is visible;
     - `.lcard-team-a.is-winner` count is `0`;
     - the eyebrow text contains `pens (3–2)`.
   - Repeat on `#/schedule/date/<that date>` (Schedule view) with the same
     assertions.
   - Screenshot for the QA record (mobile viewport).

### (e) `daily_update --strict` validate passes

**Bug/risk**: the new `refresh_players.py` step (RJ30-7) and the `minute` field
(RJ30-9c) must not break `python3 scripts/validate_data.py --strict` (the cron
gate). `check_players` already tolerates extra fields; `minute` is an extra
field on a record (validate's `check_actual_results` only checks stage shape).

**US-9e** — As the on-call, I want `daily_update`'s `--strict` validate to pass
after every change in this epic **so that** the cron never goes red and never
deploys stale/invalid data.

- *Given* a full daily run including `refresh_players.py`, *When*
  `validate_data.py --strict` runs, *Then* exit code 0.

**Task**: no code change to `validate_data.py` expected — but **confirm** by
running the gate after a real `refresh_players.py` run. If `--strict` flags a
refreshed player (e.g. a new ESPN `position` abbrev not in `VALID_POSITIONS`),
fix the `POSITION_MAP` in `refresh_players.py` (not the validator). Add a smoke
line: `python3 scripts/refresh_players.py && python3 scripts/validate_data.py
--strict` (network-tolerant; refresh exits 0 even offline so smoke stays green
locally).

**Edge**: offline CI/local → `refresh_players.py` no-ops (exits 0), validate runs
against existing data → green. New position abbrev → mapped to `MID` default →
`VALID_POSITIONS` ok.

**QA** — `tests/feature/strict-validate-fields.test.mjs` (node:test) as a fast
guard mirroring the validator's player contract (so a refresh regression is
caught in `node --test`, before the Python gate):
- Load `data/players.json` + `data/teams.json`; assert every row's `team` ∈
  team keys, `name` truthy, `position` ∈ `{GK,DEF,MID,FWD}`. (Same as 7.1 — keep
  one canonical copy; reference it, don't duplicate.)
- The authoritative gate remains `python3 scripts/validate_data.py --strict` in
  `tests/smoke.sh` / the cron.

### Files touched / new (RJ30-9)

- **Modified**:
  - `live-api/api/live.js` (a — comment only)
  - `app/views/schedule-view.js` (b — delete 3 dead fns)
  - `scripts/scrape_live_results.py` (c — persist minute + `--self-test`)
  - `app/components/large-match-card.js` (d — append method suffix to eyebrow tag)
  - `tests/feature/winner-highlight.test.mjs` (d — extend)
  - `tests/feature/live-api.test.mjs` (a — extend comment guard)
  - `tests/smoke.sh` (c/e — refresh + strict + self-test lines)
- **New**:
  - `tests/feature/schedule-deadcode.test.mjs` (b)
  - `tests/feature/live-minute-persist.test.mjs` (c)
  - `tests/ux/rj30-winner-highlight.spec.mjs` (d)
  - `tests/feature/strict-validate-fields.test.mjs` (e)

---

## Disjoint-ownership partition map (for the build PM)

| Partition | Files (exclusive) |
|---|---|
| P1 RJ30-7 squads | `scripts/refresh_players.py`*, `scripts/check_staleness.py`, `tests/feature/refresh-players*.test.mjs`, `tests/feature/strict-validate-fields.test.mjs` |
| P2 RJ30-9a/c data | `live-api/api/live.js`, `scripts/scrape_live_results.py`, `tests/feature/live-api.test.mjs`, `tests/feature/live-minute-persist.test.mjs` |
| P3 RJ30-9b schedule | `app/views/schedule-view.js`, `tests/feature/schedule-deadcode.test.mjs` |
| P4 RJ30-9d cards | `app/components/large-match-card.js`, `tests/feature/winner-highlight.test.mjs`, `tests/ux/rj30-winner-highlight.spec.mjs` |
| Shared (PM merges) | `.github/workflows/daily_update.yml`, `tests/smoke.sh` |

`*` `daily_update.yml` and `tests/smoke.sh` are touched by P1 and P2 — the PM
applies those two edits last to avoid collisions.

## Regression gate (run in order; gate on exit codes)

```
python3 scripts/validate_data.py --strict
bash tests/smoke.sh
node --test tests/feature/*.mjs tests/competition.test.mjs
npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated
```
