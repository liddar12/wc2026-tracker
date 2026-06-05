# Remediation Plan — outstanding items (post-R16)

Kickoff: **2026-06-11 19:00Z** (~6 days out). Today: 2026-06-05.

**Key fact (verified):** DB migrations auto-apply to prod via the **Supabase GitHub
integration on merge to `main`** (a fix migration goes live ~15s after merge).
So every DB fix below ships as a PR → merge. No manual `supabase db push`.

**Already fixed + live (this session):** Everyone-pool visibility, duplicate-pool
reconciliation. **Non-issue confirmed:** auto-join trigger is exception-guarded
(cannot break signup).

Legend — Owner: 🤖 = I can do it autonomously · 👤 = needs you (IP/secret/taste).

---

## P0 — before kickoff (live scoring depends on it)

### 2. Activate the server scorer  · 👤 then 🤖 · LOW effort · LOW risk
**Why it matters:** the `score-brackets` function is deployed but **dormant**.
During the tournament the Everyone-pool leaderboard ranks by *stored* score
(issue #2), which only stays fresh if the scorer runs. Without it, the Everyone
leaderboard freezes at 0 once matches start. (Normal pools are unaffected — they
use live client recompute.)
**Steps:**
1. 👤 Supabase dashboard → project `vodjwymxquuertmhtvuw` → Settings → API → copy
   the **`service_role`** key.
2. 👤 Netlify → site `golden-kheer-bc4402` → Site config → Environment variables
   → add `WC26_SUPABASE_SERVICE_KEY` (scope: Production) → redeploy (or it picks
   up on the next scheduled run).
3. 🤖 Verify: `GET /.netlify/functions/score-brackets` returns `{ok:true,...}`
   (not `dormant`); confirm a test row's `score` updates.
**Deadline:** set the key before June 11. Until then, harmless (scores are 0).
**Optional hardening (🤖):** add a client "scores updating…" indicator on the
Everyone leaderboard so a brief scorer lag isn't read as "broken."

---

## P1 — high value, ideally before launch

### 1. DT model: real talent layer + real backtest  · 👤 (scrape) + 🤖 (rest)
**Why deferred:** the talent layer needs FBref data, and **FBref only serves
residential IPs** (datacenter/cloud → Cloudflare 403, confirmed). My environment
is not residential, so I cannot run the scrape. The model is currently an honest
Elo-anchored prior; the backtest is a labeled Elo-baseline estimate.
**Steps:**
1. 👤 On your Mac: `python worldcup_model_data.py --fbref` → writes
   `cache/fbref_features.csv`. Review `cache/names_to_review.csv`, add confirmed
   rows to `cache/name_map.csv`, rerun `--tidy`. Commit `fbref_features.csv`.
2. 🤖/CI: `python build_dt_model.py` → regenerates `dt_model.json` **with** the
   talent layer (no longer Elo-only). I wire it in: replace `data/dt_model.json`,
   bump the model description to drop the "Elo-anchored prior" caveat.
3. 🤖 Build `worldcup_backtest.py` (doesn't exist yet): fit weights + α to actual
   WC18/22 + Euro24 + Copa24 results, report **match log-loss DT vs plain Elo**.
   - If DT beats Elo → replace the estimate in `data/backtest.json` with the
     **real** numbers and remove `is_estimate`/`dt_note`.
   - If it doesn't → keep DT labeled a prior (honest). Either way, no overselling.
   - Caveat: a real backtest needs historical match results + historical ratings;
     sourcing those is the main effort (a public football-results dataset).
**Risk:** LOW (additive; DT already shipped). **Blocker:** step 1 is yours.

### 3. Branded OG share image (1200×630)  · 🤖 · MED effort · LOW-MED risk
**Why deferred:** a per-bracket dynamic image needs an image renderer (a build
dep), so cards currently use the 512² app icon.
**Recommended approach (dynamic):** a new Netlify function
`share-image.mjs` using `satori` + `@resvg/resvg-js` to render SVG→PNG with the
user's champion (flag + name) + "N picks" on a branded 1200×630 canvas; bundled
by esbuild (already the function bundler). `share-card.mjs` points `og:image` at
`/s/<token>/image.png`.
**Steps (🤖):** add deps; build + unit-test the renderer with a fixture; wire the
route; verify the PNG renders + unfurls (Twitter/Slack/iMessage). Watch the
function bundle size (satori+resvg are a few MB — within Netlify limits, but test).
**Fallback if bundle too big:** commit one static branded 1200×630 PNG + dynamic
meta text (no renderer). I'd need a real PNG asset for this (you or a designer).

---

## P2 — operational / decisions

### 4. results-health alerting channel  · 👤 (channel) + 🤖 (wire) · LOW effort
**Why deferred:** monitor logs + returns 503 for an external uptime monitor; no
push/email wired (no channel chosen).
**Recommended:** a **Slack/Discord incoming webhook** (simplest — one env var).
**Steps:** 👤 create the webhook, give me the URL (set as `WC26_ALERT_WEBHOOK` in
Netlify). 🤖 add a POST-on-degraded to `results-health.mjs` (no-op until the env
var exists, like the scorer). Alternative channels: email via Resend, or a free
uptime monitor (UptimeRobot) pointed at the endpoint — zero code.

### 6. Anon expire-on-submit timing  · 👤 decision · TRIVIAL
**Current:** anon drafts expire on the **next boot** after a stage-3 submit (not
an immediate wipe) so the bracket stays viewable in the same session.
**Decision:** keep next-boot (recommended) **or** flip to immediate wipe.
If immediate: 🤖 change the anon branch in `play-view.js` to `clearAnonDrafts()`
right after submit, and keep an in-memory copy so the current-session review
still renders. ~15 min.

### 5b. Picked-team recolor (coral → green)  · 👤 confirm + 🤖 · TRIVIAL
**Why deferred:** a taste call. Today the picked highlight is coral
(`--accent-strong #E11D48`).
**Steps:** 👤 confirm you want green + the exact shade (e.g. `#16A34A`). 🤖 update
the `.is-picked` / accent tokens; verify contrast ≥4.5:1 in light + dark; QA.

---

## P3 — maintainability (anytime)

### 5a. escapeHtml consolidation  · 🤖 · MED effort (mechanical) · LOW risk
**Why deferred:** ~45 files each define a local `escapeHtml`; the canonical
`app/lib/escape.js` exists but isn't universally imported.
**Steps (🤖):** replace per-file helpers with `import { escapeHtml } from
'…/lib/escape.js'`, file by file; behavior is identical so the suites stay green;
add a lint/grep test that fails if a new local `escapeHtml` helper appears.
**Value:** maintainability + one audited escaper (security hygiene). Not
user-facing. Best done as one focused PR.

---

## What I can start now without you
- **3** (OG dynamic image), **5a** (escapeHtml consolidation), and the **code half
  of 4** (alerting, dormant until the webhook env is set) — all autonomous,
  ship via PR behind the usual 100% QA gate.
- **2's optional client indicator** for leaderboard freshness.

## What needs you (blockers)
- **2** service-role key (Netlify env) — *most time-sensitive; needed for live
  scoring by June 11.*
- **1** FBref scrape on your Mac (residential IP).
- **4** webhook URL · **6** keep-vs-immediate · **5b** recolor shade — quick calls.

## Suggested order
1. **Now:** you set the **service key** (P0 #2) — unblocks live scoring.
2. **This week (me):** OG image (#3) + escapeHtml (#5a) + alerting code (#4).
3. **When you can (you):** FBref scrape (#1) → I finish DT talent + backtest.
4. **Quick calls:** #6, #5b, #4 channel.
