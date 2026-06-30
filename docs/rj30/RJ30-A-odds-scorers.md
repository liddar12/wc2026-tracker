# RJ30-A — Per-match odds (Polymarket) + Live Golden-Boot scorers

Scope: two ZERO-COST data items that light up already-built UI by populating
existing JSON contracts from free sources. No new framework, no build step, no
Supabase writes. iOS-first installed PWA.

Grounding (files read):
- `app/components/parlay.js`, `app/components/market-odds.js`,
  `app/components/model-market-divergence.js`, `app/markets.js`
- `scripts/scrape_kalshi.py`, `scripts/scrape_apifootball_odds.py`,
  `scripts/polymarket_match_backtest.py` (Gamma client pattern already present)
- `app/lib/golden-boot.js`, `app/components/scorers.js`,
  `app/views/golden-boot-view.js`, `app/views/golden-awards-view.js`,
  `scripts/scrape_scorers.py`, `scripts/scrape_match_events.py` output
- `app/data-loader.js` (FILES manifest + keyFor), `scripts/validate_data.py`
  (`check_markets`, `check_consensus_odds`, `check_feed_emptiness`), workflows
  `frequent_update.yml` / `live_update.yml` / `pre_kickoff_update.yml`.

KEY ARCHITECTURAL FACTS that constrain the design (do not break these):
1. The Parlay + matchup market-odds + divergence all read **the same
   `match_outcomes` contract**: `{ "<team_a>__vs__<team_b>": { team_a, team_b,
   team_a_prob, draw_prob, team_b_prob, ... } }` keyed/oriented to the app's
   canonical `team_a`. Three readers:
   - `parlay.js#marketWDL` → precedence **liveOdds → `consensusOdds.match_outcomes`
     → `markets.match_outcomes`** (so Polymarket placed in `consensus_odds.json`
     OR `markets.json` both work; precedence matters — see Q1).
   - `markets.js#getMatchOutcome(markets, match)` → reads ONLY
     `markets.match_outcomes` (matchup detail market-odds column + divergence).
   - `model-market-divergence.js#divergenceLine` → needs `markets.match_outcomes`
     AND `match.probabilities`.
2. Orientation must match `group_matchups.json` (groups) + resolved
   `schedule_full.json` knockout rows. `scrape_apifootball_odds.py#canonical_matchups()`
   already does exactly this — **reuse that function's logic verbatim**.
3. `golden-boot.js#liveGoalsByPlayer` ALREADY derives live goals from
   `data.matchEvents` (`goal` + `pen-goal`, excludes cards) and from
   `data.scorers`, merging by accent-insensitive name taking the MAX. So
   Golden-Boot live goals **already work without scorers.json**. RJ30-2's value
   is the **per-team top-scorer card** (`scorers.js`, keyed by team with
   `{name, goals, club}`) which is still dark, plus an authoritative
   `scorers.json` so the two feeds agree and the staleness watchdog goes green.
4. `match_events.json` types observed in real data: `goal` (202), `pen-goal` (8),
   `own-goal` (12), `yellow`, `red`. **own-goal credits the OPPONENT, never the
   listed scorer** — must be excluded from a player's tally (and `golden-boot.js`
   already excludes it, so derive_scorers must match that exactly or the two
   feeds disagree). pen-goal COUNTS as a goal for the taker.
5. `validate_data.py` requires: `consensus_odds.json.source == "api-football"`;
   `markets.json.source == "kalshi"`; each `match_outcomes` record has
   `team_a, team_b, team_a_prob, draw_prob, team_b_prob`. `scorers.json` is
   `KNOWN_DARK` (warn-only). On-disk convention: `scorers.json` writes
   `ensure_ascii=True`; `markets.json`/`consensus_odds.json` write
   `ensure_ascii=False` — match each file's existing encoding.

---

## RJ30-1 — Per-match W/D/L odds via Polymarket Gamma API

### User stories
- **US-1.1** As a fan opening today's match, I want a market price (team / draw
  odds) next to the model so I can see where the market and model agree or
  disagree — so the matchup detail shows a real market bar, not the
  "tournament winner fallback".
  - **Given** a fixture today that Polymarket has priced
    **When** I open its matchup detail
    **Then** I see the market-odds bar (`marketBar`) with team_a/draw/team_b %
    **And** the "Per-match market prices not yet available" fallback is gone.
- **US-1.2** As a fan, I want the model-vs-market divergence line so I can gauge
  edge.
  - **Given** the priced fixture has model `probabilities`
    **When** detail renders **Then** a `.divergence` line reads
    `Model X% · Market Y% · ±Z pp` with the agree/warn/disagree class.
- **US-1.3** As a fan on Home, I want the Parlay of the Day's Moneyline legs
  blended with a real market price (not pure-model) so the parlay's `ev` and
  odds reflect the market.
  - **Given** today's priced fixtures exist in the data
    **When** Parlay of the Day builds **Then** Moneyline legs are NOT tagged
    `model est.` (i.e. `marketWDL` returned a price) and `ev` is computed from
    `modelP / marketP`.
- **US-1.4** As the project owner, I want this from a free, keyless, unlimited
  source so it costs nothing and never needs a secret.
  - **Given** no API key configured **When** the scraper runs **Then** it still
    produces odds (Gamma is public/keyless) and exits 0 on any failure.

### Tasks (files / functions / data flow / source)
- **NEW `scripts/scrape_polymarket_odds.py`**
  - Source (free, keyless, no documented rate limit):
    `GET https://gamma-api.polymarket.com/events?tag_id=102232&closed=false&limit=500`
    (WC2026 tag). Reuse the `get()` + `as_list()` helpers and event-parsing
    shape proven in `scripts/polymarket_match_backtest.py` (`groupItemTitle`,
    `outcomePrices`, `clobTokenIds`, `gameStartTime`). Each match event has 3
    markets whose `groupItemTitle` is teamA / "Draw" / teamB; the live price is
    `outcomePrices[0]` of each market (the YES = "this outcome happens" price).
  - Transform: for each event with exactly 3 markets incl. a "draw",
    read the 3 YES prices → de-vig (divide by their sum so the triple sums to 1).
  - Team-name mapping: a `RENAMES` dict (mirror of
    `scrape_apifootball_odds.py` RENAMES) mapping Polymarket display names →
    canonical (`United States→USA`, `South Korea→Korea Republic`,
    `Turkey→Turkiye`, `Cape Verde→Cabo Verde`, `Ivory Coast→Cote d'Ivoire`,
    `Czech Republic→Czechia`, `Congo DR→DR Congo`,
    `Bosnia & Herzegovina→Bosnia and Herzegovina`, `Curaçao→Curacao`, …).
    Drop any market whose 2 non-draw titles don't both map to valid `teams.json`
    keys (illiquid / unmapped → skip, exactly like Kalshi).
  - Orientation: copy `canonical_matchups()` from `scrape_apifootball_odds.py`
    (group_matchups + resolved schedule_full knockout rows, placeholder-filtered)
    so `team_a_prob` aligns with the app's `team_a`.
  - Validate against schedule: only emit a fixture whose `frozenset((a,b))`
    appears in `canonical_matchups()` (i.e. it is a real scheduled WC fixture).
  - **Output target (default): `data/consensus_odds.json`**, REPLACING the
    `source` to `"api-football"`? — NO. See Q1. Recommendation: write a
    **separate `data/polymarket_odds.json`** with `source: "polymarket"` and the
    identical `match_outcomes` shape, then add it to the parlay precedence and to
    `markets.js` getMatchOutcome fallback. This avoids lying about `source`
    (validate_data hard-codes `source` strings per file) and avoids a scraper
    collision with the (dark) API-Football consensus scraper on the same file.
  - Same atomic write pattern as the others (`.tmp` → `replace`),
    `ensure_ascii=False` (new file, no legacy churn), exit 0 on any error,
    keep existing file on fatal.
- **EDIT `app/data-loader.js`**: add `{ file: 'polymarket_odds.json', fallback: {} }`
  to FILES and `case 'polymarket_odds.json': return 'polymarketOdds';` to keyFor.
- **EDIT `app/components/parlay.js#marketWDL`**: insert Polymarket into the
  precedence chain after consensus, before Kalshi:
  `… || outcomeWDL(data?.polymarketOdds?.match_outcomes, a, b) || outcomeWDL(data?.markets?.match_outcomes, a, b)`.
  Also extend `liveOU` only if Polymarket carries an O/U market (it does not for
  1X2 events → leave O/U as-is).
- **EDIT `app/markets.js#getMatchOutcome`** (for matchup detail + divergence):
  fall back to `data.polymarketOdds.match_outcomes`. BUT `getMatchOutcome` is
  called as `getMatchOutcome(markets, match)` with only the `markets` object in
  scope (see `market-odds.js`). Cleanest: in
  `app/views/matchup-detail.js` (the caller of `marketOddsSection`), **merge**
  Polymarket outcomes into the `markets` object passed down, OR pass a combined
  `{ ...markets, match_outcomes: { ...polymarket, ...kalshi } }`. Recommendation:
  build a tiny `mergedMarkets(data)` helper in `app/markets.js` that returns
  `markets` with `match_outcomes = { ...polymarketOdds.match_outcomes,
  ...markets.match_outcomes }` (Kalshi wins on conflict) and have
  `marketOddsSection` receive that. Keep `updated_at` from whichever populated.
- **EDIT workflows**: add a `Scrape Polymarket odds` step (continue-on-error) to
  `frequent_update.yml` (hourly, where scrape_kalshi runs), `live_update.yml`
  (so in-play prices refresh), and `pre_kickoff_update.yml`.
- **EDIT `scripts/validate_data.py`**: add `check_polymarket_odds()` mirroring
  `check_consensus_odds` but `source == "polymarket"`; register in the run list
  and (optionally) in `check_feed_emptiness` as warn-only / KNOWN_DARK-style
  (pre-tournament it is legitimately empty).

### Edge cases
- **Empty / pre-tournament**: Gamma returns events but with no live prices, or
  `closed=false` returns nothing → write `{ source:"polymarket", updated_at,
  match_outcomes:{} }`. App fallbacks already handle empty `{}` (tournament
  winner fallback shows). Parlay legs simply become `estimated:true` again.
- **Unmapped / new team names** (Polymarket uses different spellings than ESPN):
  any name not in `RENAMES`+`teams.json` → drop that market, log it (so we can
  extend RENAMES). Never emit a record with a non-canonical team.
- **3-way market not fully priced** (one leg illiquid, price 0 or missing) →
  skip the fixture (`tot <= 0` guard), exactly like Kalshi/consensus.
- **Orientation race**: a knockout fixture priced by Polymarket before
  `schedule_full.json` resolves the slot → `canonical_matchups()` won't contain
  it → fixture dropped until the bracket resolves (acceptable; matches existing
  consensus behavior).
- **Conflict with Kalshi**: if both price the same match, `mergedMarkets` lets
  Kalshi win for the detail bar (it's the attributed source in the UI:
  `kalshiAttribution`). For the parlay, precedence is consensus → polymarket →
  kalshi (Q1). Keep these deliberate, documented.
- **iOS / data-loader cache**: `markets.json` is force-fetched (never cached) per
  data-loader; `polymarket_odds.json` defaults to the cached path — fine (hourly
  freshness via `_headers`), but if owner wants in-play freshness on the matchup
  detail, add it to the no-cache list (Q3).
- **Graceful degradation**: every new read is `data?.polymarketOdds?.…` with a
  `{}` fallback already in FILES — a missing file never throws.

### QA test scripts
1. **`tests/feature/rj30-polymarket-odds.test.mjs`** (node:test) — pure
   transform + wiring, no network:
   - *Given* a fixture in `data.polymarketOdds.match_outcomes`
     `'Brazil__vs__Japan': { team_a:'Brazil', team_b:'Japan', team_a_prob:.6,
     draw_prob:.25, team_b_prob:.15 }` and matching model rows in
     `groupMatchups`, plus today's `scheduleFull` row for Brazil v Japan,
     *When* `dailyLegs(data)` runs (import from `app/components/parlay.js`),
     *Then* the Brazil v Japan Moneyline leg is present and `leg.estimated`
     is falsy (market price was used) — asserts `marketWDL` saw Polymarket.
   - *Given* the SAME fixture only in `polymarketOdds` (no `markets`/`consensus`),
     *When* `marketWDL`-fed leg builds, *Then* `leg.ev !== 1` (EV computed from
     a real `mp`). Selector-free; assert on the returned leg object.
   - *Given* a reversed-orientation key `'Japan__vs__Brazil'`, *Then*
     `outcomeWDL` flips and `leg` probabilities orient to `team_a=Brazil`
     (assert team_a prob feeds the Brazil-to-win selection).
   - *Given* `data.polymarketOdds` absent entirely, *Then* `dailyLegs` does not
     throw and legs are `estimated:true` (regression guard).
2. **`scripts/scrape_polymarket_odds.py --selftest`** (python, mirrors
   `scrape_apifootball_odds.py` selftest; run inside `tests/smoke.sh` or a node
   wrapper test `tests/feature/rj30-polymarket-selftest.test.mjs` that
   `execFileSync('python3', [script,'--selftest'])` and asserts exit 0):
   - de-vig of `[0.6,0.3,0.2]` (sum 1.1) → `[0.545,0.273,0.182]` summing to 1.
   - RENAMES: `"United States"→"USA"`, `"Turkey"→"Turkiye"`,
     `"Curaçao"→"Curacao"`.
   - `parse_event` of a fixture with `groupItemTitle` Brazil/Draw/Japan and
     `outcomePrices ["0.60"]/["0.25"]/["0.15"]` → key `Brazil__vs__Japan`,
     team_a_prob≈0.6 (after de-vig of the YES triple).
   - canonical flip: when `canon` maps `{Brazil,Japan}→(Japan,Brazil)` the
     emitted `team_a` is `Japan` and probs swap.
   - unmapped team → event dropped, returns no record (no crash).
   - empty input → `{ match_outcomes: {} }`.
3. **`tests/feature/rj30-markets-merge.test.mjs`** (node:test): import the new
   `mergedMarkets(data)` from `app/markets.js`; *Given* Kalshi has
   `A__vs__B` and Polymarket has both `A__vs__B` (conflict) and `C__vs__D`,
   *Then* merged `match_outcomes` has both keys and `A__vs__B` === the Kalshi
   record (Kalshi wins). Then `getMatchOutcome(mergedMarkets(data), {team_a:'C',
   team_b:'D'})` returns the Polymarket record.
4. **`tests/ux/rj30-polymarket-detail.spec.mjs`** (Playwright, 390×844): seed a
   fixture into a deploy-preview/local `data/polymarket_odds.json` (or stub via
   route interception), navigate to that matchup detail, assert
   `.market-odds-section .bar-title` is NOT the "tournament winner fallback"
   note and `.market-odds-section [data-testid=market-bar]` (or `.market-bar`)
   is visible; assert a `.divergence` element exists when the model has
   probabilities. Tap-target + safe-area: assert the section sits within the
   scroll container and no horizontal overflow at 390px.

### iOS / UX notes
- Reuses `marketBar` + `.divergence` — no new components, so design language and
  safe-areas are inherited. No new tap targets.
- Keep `kalshiAttribution()` honest: when the displayed bar is Polymarket-only,
  attribution text should read "prediction markets" generically (it already
  links to "prediction markets") — acceptable; do NOT claim Kalshi for a
  Polymarket price (Q2).
- No layout shift: the bar already occupies the fallback's space.

### Files touched / new
- New: `scripts/scrape_polymarket_odds.py`, `data/polymarket_odds.json` (committed
  empty stub), `tests/feature/rj30-polymarket-odds.test.mjs`,
  `tests/feature/rj30-polymarket-selftest.test.mjs`,
  `tests/feature/rj30-markets-merge.test.mjs`,
  `tests/ux/rj30-polymarket-detail.spec.mjs`.
- Edit: `app/data-loader.js`, `app/components/parlay.js`, `app/markets.js`,
  `app/components/market-odds.js` (accept merged markets) and/or
  `app/views/matchup-detail.js`, `scripts/validate_data.py`,
  `.github/workflows/{frequent_update,live_update,pre_kickoff_update}.yml`.

---

## RJ30-2 — Live top-scorers / Golden Boot from existing match_events.json

### User stories
- **US-2.1** As a fan on a matchup detail, I want the "Top scorers (tournament)"
  card to show each team's leading scorers from goals already scored, so the
  card stops saying "No tournament goals yet" once goals exist.
  - **Given** `match_events.json` has goal events for team_a/team_b
    **When** I open the matchup **Then** `scorers.js` lists each team's top-3
    scorers with goal counts.
- **US-2.2** As a fan, I want own-goals NOT credited to the scorer and penalties
  credited to the taker, so totals are correct.
  - **Given** a match with a `pen-goal` by X and an `own-goal` by Y
    **When** scorers derive **Then** X has the goal, Y does not get a goal for
    that event (own-goals are excluded entirely from per-player tallies).
- **US-2.3** As the Golden-Boot tracker, I want a single authoritative
  `scorers.json` so the per-team card and `liveGoalsByPlayer` agree and the
  staleness watchdog goes green.
  - **Given** derived scorers exist **When** Golden Boot renders **Then** the
    same player goal counts appear in the live leaderboard and the per-team card
    (no disagreement between the two feeds).
- **US-2.4** As the owner, I want this derived from data we ALREADY have (no new
  scrape, no ESPN team-stats call that historically returns nothing), at zero
  cost.

### Tasks (files / functions / data flow)
- **NEW `scripts/derive_scorers.py`** (replaces the dark `scrape_scorers.py`):
  - Input: `data/match_events.json` (already populated by
    `scrape_match_events.py`), `data/players.json` (for canonical name + club),
    `data/teams.json` (valid team set).
  - Logic (must MIRROR `golden-boot.js#liveGoalsByPlayer` so feeds agree):
    iterate every match's `events`; count an event as a goal for `e.player` iff
    `e.type in {"goal","pen-goal"}` (NOT `own-goal`, NOT cards). Group by
    `e.team` (the scoring team on the event). For each team, aggregate by
    accent-insensitive normalized name (mirror `normPlayerName`: strip
    diacritics, drop non-alphanumerics, lowercase), keep the first-seen raw
    display name, and resolve to the `players.json` canonical name + `club`
    when a normalized match exists (else keep the event's raw name, `club:null`).
  - Output shape — **two consumers, one file**: keep the existing
    per-team contract `scorers.js` expects: `{ "<Team>": [ {name, goals, club},
    … top 3 by goals ], …, "__meta__": { updated_at } }`. This is ALSO valid for
    `golden-boot.js#liveGoalsByPlayer` (its `else if (s && typeof s==='object')`
    branch reads `v.goals` per object — but note that branch iterates
    TEAM keys, not players; verify: liveGoalsByPlayer's object branch expects
    `{ playerName: {goals} }`, NOT `{ team: [..] }`. The per-team array shape is
    NOT directly digestible by that branch.) → **Decision (Q4):** because
    `liveGoalsByPlayer` ALREADY counts goals from `match_events.json` directly,
    we do NOT need scorers.json to feed Golden Boot. Keep `scorers.json` in the
    per-team `{Team: [{name,goals,club}]}` shape purely for the `scorers.js`
    card; Golden Boot keeps using match_events. This is the lowest-risk path and
    matches existing tests (`golden-boot-scorers.test.mjs`).
  - Pre-tournament guard + no-op-bump guard: copy `scrape_scorers.py`'s
    `before/after` diff and the `today < 2026-06-11` gate so the staleness check
    behaves identically and we never bump `updated_at` on a no-op.
  - Write atomically, `ensure_ascii=True` (match `scrape_scorers.py` /
    existing `scorers.json` encoding). Exit 0 on any error.
  - `--selftest` (no I/O): feed an in-memory match_events dict with a goal,
    pen-goal, own-goal, and a card → assert tallies (own-goal/card excluded,
    pen-goal counted) and accent-merge.
- **EDIT workflows**: replace `python scripts/scrape_scorers.py` with
  `python scripts/derive_scorers.py` in `live_update.yml` (and any other cron
  that ran scrape_scorers). Keep `continue-on-error: true`. derive_scorers must
  run AFTER `scrape_match_events.py` in the same job (it consumes its output).
- **NO app changes required** for the per-team card if shape is preserved
  (`scorers.js` already reads `(scorers||{})[team]` as an array of
  `{name,goals,club}`). Confirm `data-loader` keyFor already maps
  `scorers.json → scorers` (it does).
- **Optional polish** (Q5): add a small "Tournament top scorers" overall list to
  `golden-awards-view` "Boot" tab sourced from the same derivation — but
  `liveGoalsByPlayer` already powers the live leaderboard there, so this is
  redundant; recommend SKIP.

### Edge cases
- **own-goal** (`type:"own-goal"`): excluded from the listed player's tally;
  the goal counts for the opponent on the scoreboard but we do NOT attribute it
  to any player in scorers.json (FIFA lists own-goals separately, not in a
  player's golden-boot tally). Matches `golden-boot.js` which only counts
  `goal`/`pen-goal`.
- **pen-goal**: counts for the taker (`e.player`).
- **Name normalization**: ESPN "Julián Quiñones" ↔ squad "Julian Quinones" —
  resolve to the `players.json` display name via `normPlayerName`-equivalent;
  if no squad entry, keep the raw ESPN name and `club:null` (player absent from
  players.json must still appear — owner spec: real scorers always shown).
- **Multiple players same surname / accent variants in one team** → key by full
  normalized name, not surname, to avoid collisions.
- **Empty `match_events.json`** (pre-tournament) → file stays `{__meta__}` only,
  no per-team keys; `scorers.js` shows "No tournament goals yet" (existing
  empty-state). No updated_at bump.
- **Stale `__meta__` only**: derive must not write team keys when there are zero
  goal events, and must not bump `updated_at` if the team set is unchanged
  (staleness watchdog relies on this).
- **iOS**: card is text-only, inherits `.scorers-grid` / `.sub-row` layout — no
  new styling, safe-area unaffected.

### QA test scripts
1. **`scripts/derive_scorers.py --selftest`** invoked from
   **`tests/feature/rj30-derive-scorers.test.mjs`** (node:test wrapper):
   - `execFileSync('python3',['scripts/derive_scorers.py','--selftest'])` → exit 0.
   - Selftest internal assertions (in Python): given events
     `[{type:'goal',player:'Julián Quiñones',team:'Mexico'},
      {type:'pen-goal',player:'Raúl Jiménez',team:'Mexico'},
      {type:'own-goal',player:'Foo Bar',team:'Mexico'},
      {type:'yellow',player:'Baz',team:'Mexico'}]` →
     Mexico list contains Quiñones=1 and Jiménez=1, total Mexico goals=2,
     "Foo Bar" and "Baz" absent.
   - accent-merge: a second match with `'Julian Quinones'` (unaccented) → merges
     to one Mexico entry with goals=2.
2. **`tests/feature/rj30-scorers-shape.test.mjs`** (node:test): import
   `scorersSection` from `app/components/scorers.js`; build a fake `scorers`
   object `{ Mexico: [{name:'Raúl Jiménez', goals:2, club:'Fulham'}] }` and a
   match `{team_a:'Mexico', team_b:'South Africa'}`; render via jsdom-free
   string check is hard (it uses `document`) → instead assert the DATA contract:
   load real `data/scorers.json` (after a derive run in CI) and assert every
   value (except `__meta__`) is an array of objects with numeric `goals` and
   string `name`, sorted descending by goals, length ≤ 3.
3. **`tests/feature/rj30-feeds-agree.test.mjs`** (node:test): the cross-feed
   invariant — derive_scorers and `liveGoalsByPlayer` must agree.
   - *Given* a fixture `data.matchEvents` with goal+pen-goal+own-goal,
     *When* I run `liveGoalsByPlayer(data)` AND replicate derive's per-team
     counting in JS, *Then* the per-player goal totals (excluding own-goals)
     are identical. Locks the "own-goal excluded, pen-goal counted" rule on both
     sides so they can't drift.
4. **`tests/ux/rj30-scorers-card.spec.mjs`** (Playwright 390×844): on a matchup
   detail for a played fixture, assert `.scorers-grid .scorers-col` shows at
   least one `.sub-row` with a `⚽` count (not the "No tournament goals yet"
   text) when goals exist; assert no horizontal overflow; assert the goal glyph
   renders.

### iOS / UX notes
- Zero new UI; the existing `scorers.js` card simply stops being empty.
- Goal emoji `⚽` already used; renders on iOS Safari.

### Files touched / new
- New: `scripts/derive_scorers.py`, `tests/feature/rj30-derive-scorers.test.mjs`,
  `tests/feature/rj30-scorers-shape.test.mjs`,
  `tests/feature/rj30-feeds-agree.test.mjs`,
  `tests/ux/rj30-scorers-card.spec.mjs`.
- Edit: `.github/workflows/live_update.yml` (and any cron running
  scrape_scorers) — swap to derive_scorers. `scripts/scrape_scorers.py` left in
  place (dark) or deleted (Q6).
- No app/ edits required (shape preserved).

---

## Cross-cutting / partitioning
- RJ30-1 owns: `scripts/scrape_polymarket_odds.py`, `app/markets.js`,
  `app/components/parlay.js`, `app/components/market-odds.js`,
  `app/data-loader.js` (FILES manifest), `validate_data.py` (markets section).
- RJ30-2 owns: `scripts/derive_scorers.py`, `app/components/scorers.js` (read-only
  verify), no app edits.
- **Shared-file collision risk**: BOTH touch `app/data-loader.js` (FILES + keyFor)
  and `.github/workflows/live_update.yml` and `scripts/validate_data.py`. Assign
  those three shared files to ONE owner (RJ30-1 lead) to keep disjoint ownership;
  RJ30-2 hands its one-line data-loader/workflow needs to that owner. (RJ30-2
  actually needs NO data-loader change — scorers.json already wired — so the
  only true shared file is `live_update.yml`.)

## Regression gate (must stay green)
`python3 scripts/validate_data.py` → `bash tests/smoke.sh` →
`node --test tests/feature/*.mjs tests/competition.test.mjs` →
`npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated`.
Add the new node tests to the feature glob automatically (they match
`tests/feature/*.mjs`). Existing `parlay.test.mjs`, `kalshi-match.test.mjs`,
`h2h-and-market.test.mjs`, `golden-boot-scorers.test.mjs`,
`r19-golden-boot.test.mjs` must still pass unchanged.
