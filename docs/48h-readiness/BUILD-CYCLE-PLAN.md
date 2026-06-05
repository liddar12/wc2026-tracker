# Build-Cycle Plan & Requirements (post-R16 remediation)

Decisions locked: **scope = everything**; **OG = static branded card + dynamic
text**; **alerting = external uptime monitor (zero-code)**.

Process: review this until it's bulletproof → I Build → QA → Test → Bugfix →
Deploy (each item behind the 6-level QA gate, shipped via PR; DB changes
auto-apply on merge via the Supabase integration).

FR = functional req · NFR = non-functional · AC = acceptance criteria (testable).
Owner: 🤖 I build autonomously · 👤 needs you.

---

## Buildable this cycle

### #3 — Static branded OG share card  · 🤖 · MED
**FR-3.1** A single branded **1200×630 PNG** (`assets/og/share-card.png`) is the
`og:image`/`twitter:image` for shared brackets; the **title + description stay
dynamic** (champion + pick count, already built in `share-card.mjs`).
**FR-3.2** Card art: WC26 palette (navy `#0D1117` ground, rose `#E11D48` accent),
the trophy/ball motif, wordmark "WC26 Bracket", subtitle "2026 FIFA World Cup
Predictions". On-brand with the app header.
**Architecture:** I author the card as an HTML/CSS (or SVG) template and render
it to PNG with a one-off **Playwright screenshot** script
(`scripts/build-og-card.mjs`, chromium @ 1200×630) — no runtime renderer, no new
runtime deps. Commit the PNG. `share-card.mjs` points the two image meta tags at
`${origin}/assets/og/share-card.png`; `twitter:card` stays `summary_large_image`.
**NFR:** PNG < 300 KB; crisp at 2× (render at deviceScaleFactor 2 then size to
1200×630); served with the existing immutable `/assets/*` cache header.
**AC:** pasted link unfurls a branded image + the dynamic champion/pick-count
text; `GET /assets/og/share-card.png` → 200 `image/png`; `og:image` resolves.
**Test:** unit (share-card output references the asset, not the icon); Playwright
(`/assets/og/share-card.png` 200 + content-type); re-run the existing share-card
smoke. **Risk:** LOW (static asset + 2-line meta change).

### #5a — escapeHtml consolidation  · 🤖 · MED (mechanical)
**FR-5a.1** Each of the **48 files** with a local `function escapeHtml(...)` (and
any local `escapeAttr`) is replaced by an import from the canonical
`app/lib/escape.js`.
**FR-5a.2** Verified variation: some locals use `String(s)` (renders the literal
`"null"`/`"undefined"` for nullish input); the canonical lib is **null-safe**
(`String(s ?? '')` → `""`). Consolidating standardizes on the null-safe behavior
— effectively a tiny correctness fix. No other behavioral differences (identical
char map). Any escaped *attribute* contexts move to `escapeAttr`.
**FR-5a.3** Add a regression guard test that fails if a new local `escapeHtml`
helper is introduced anywhere except `lib/escape.js`.
**Architecture:** enumerate offenders (`grep -rn "function escapeHtml" app`),
fix per file with the correct relative import depth (`./lib/…`, `../lib/…`,
`../../lib/…`), run the full suite after each batch.
**AC:** 0 local `escapeHtml` definitions outside `lib/escape.js`; 120 feature +
24 Playwright stay green; guard test passes. **Risk:** LOW per file, broad in
count — done in small batches with the suite as the safety net.

### #5b — Picked-team recolor (coral → green)  · 🤖 · TRIVIAL · ⚠ needs shade confirm
**FR-5b.1** The picked-team highlight changes from coral (`--accent-strong
#E11D48`) to green. **Recommended shade: `#16A34A`** (green-600) for the fill,
white text — meets AA. (Confirm or override.)
**NFR:** picked chip/cell text contrast ≥ 4.5:1 in **light AND dark**. Verified:
`--accent-strong` IS shared (a component bg/border + a gradient), so I'll add a
**dedicated `--picked` token** (green, per light/dark) and point the three
`.is-picked` rules (`.pick-btn`, `.bb-slot`, `.pw-bracket-side`) at it — leaving
`--accent-strong` untouched so no unrelated UI recolors.
**AC:** picked teams render green; contrast AA both themes; no unintended recolor
elsewhere. **Test:** Playwright visual presence of `.is-picked` + a contrast spot
check. **Open question → see "Confirm before build".**

### #2b — (optional) Everyone-leaderboard freshness indicator  · 🤖 · TRIVIAL
**FR-2b.1** On the Everyone pool leaderboard, show a subtle note ("Scores update
as matches are played") so a dormant/lagging scorer isn't misread as broken.
Purely additive copy. **Include only if you want it** (low value pre-launch).

---

## Docs-only this cycle

### #4 — Alerting via external uptime monitor  · 👤 config + 🤖 docs · TRIVIAL
**No code change** (per your choice). Deliverable: a short runbook —
- Endpoint: `GET https://worldcup2026.j5lagenticstrategy.com/.netlify/functions/results-health`
- Healthy → **200** `{ok:true,…}`; degraded (stale/empty feed while live) → **503**.
- 👤 Point UptimeRobot/BetterStack at it: alert when status ≠ 200 (or on body
  keyword `"ok":false`); 5-min interval; notify your email/SMS.
**AC:** doc committed; (you) monitor configured. **Risk:** none.

---

## Plan-only this cycle (gated on you; I prep, can't fully build)

### #2a — Activate the server scorer  · 👤 · P0 before Jun 11
Already built + deployed (dormant). 👤 set `WC26_SUPABASE_SERVICE_KEY`
(service-role key) in Netlify → it activates on the next `@hourly` run. 🤖 verify
`/.netlify/functions/score-brackets` → `{ok:true}`. No build needed.

### #1 — DT talent layer + real backtest  · 👤 scrape → 🤖 rest
**Blocked on FBref (residential IP).** Sequence:
1. 👤 `python worldcup_model_data.py --fbref` on your Mac → commit
   `cache/fbref_features.csv` (+ maintain `cache/name_map.csv`).
2. 🤖 `python build_dt_model.py` → new `dt_model.json` **with** talent → I wire it
   in + drop the "Elo-anchored prior" caveat.
3. 🤖 build `worldcup_backtest.py`: log-loss DT-talent vs plain Elo over
   WC18/22+Euro24+Copa24 (needs a historical-results dataset — I'll source one);
   if DT wins, replace the estimate in `backtest.json` with **real** numbers and
   drop `is_estimate`; else keep it labeled a prior.
**This cycle I can:** scaffold `worldcup_backtest.py` + the historical-data
loader so step 3 is ready the moment the scrape lands. (Tell me if you want that
scaffolding now.)

### #6 — Anon expire-on-submit timing  · 👤 decision (no build if "keep")
**Recommended: keep next-boot** (current) — satisfies "expire after submit"
without wiping the bracket mid-review. Flip to immediate only if you prefer; that
needs an in-memory session copy so the just-submitted bracket still renders. →
see "Confirm before build".

---

## Confirm before I build (recommendations in **bold**)
1. **#5b green shade:** use **`#16A34A`** (green-600, AA) for picked teams? And if
   `--accent-strong` is shared, I'll add a dedicated `--picked` token rather than
   repurpose the accent. (Y / different shade)
2. **#6 anon timing:** **keep next-boot** (recommended) or switch to immediate wipe?
3. **#2b freshness indicator:** include it (**recommended: yes**, it's tiny) or skip?
4. **#1 backtest scaffold:** build the `worldcup_backtest.py` + data-loader
   scaffold this cycle (**recommended: yes**) so it's ready for your FBref data?

## Build order (after approval)
1. #5a escapeHtml consolidation (isolated, broad) → PR → merge.
2. #3 static OG card (render PNG + wire) → PR → merge → verify unfurl on prod.
3. #5b recolor → PR → merge.
4. (#2b if yes) → fold into #3 or its own small PR.
5. #4 runbook doc + #1 scaffold (if yes) → docs/scaffold PR.
Each: 120 feature + 24 Playwright + CI/e2e green before merge; prod-verify after.

## Out of scope / your action items
- Set `WC26_SUPABASE_SERVICE_KEY` (P0, scoring) · run the FBref scrape (DT talent)
  · configure the uptime monitor · the confirmations above.
