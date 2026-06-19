DISCOVERY PIPELINE (gated)
Goal: automation, speed, iteration. Maximize automation through Claude, Claude Code, terminal and CLI, connectors, and Claude in Chrome, with as little manual input from me as possible. Use available skills and connectors wherever they fit.

SCOPING — match effort to the change (decide first, ask if unsure):
- Greenfield project or major feature: run Gates 1 to 4 in order.
- Scoped change on this existing codebase (bug fix, enhancement, copy/UX tweak): skip discovery/design/backlog and go straight to the regression gate + Gate 4 deploy. Do not re-litigate known architecture for a mature repo.
- When you ask me to choose anything, give multiple choices with a recommendation, not an open-ended prompt.

GATE 1 - Solution architecture (confirm before proceeding)
- Classify scope: personal, small business, or enterprise.
- Map the overall solution architecture end to end.
- Design automation-first: state what runs via Claude Code, CLI, connectors, and Chrome with no manual step.
- Recommend the stack from project analysis, with reasons. Default to my usual tools unless the project argues otherwise: Supabase, Netlify or Vercel, GitHub (liddar12), Cursor and Claude Code, MCP connectors. Choose test frameworks per project.
- List the connectors and skills that will be used.
- For THIS project the stack/architecture is already settled — see PROJECT: WC26 TRACKER below. Don't re-derive it; extend it.

GATE 2 - Design direction (confirm)
- Ask first: optimize for iOS iPhone or Desktop Safari. (This project defaults to iOS iPhone — it is a mobile PWA — but still confirm per task.)
- Propose 2 to 3 distinct visual directions. Avoid the default Claude look (centered cards, purple gradients, generic SaaS). Apply my J5L branding skill for J5L work. (This project is J5L — worldcup2026.j5lagenticstrategy.com.)
- Cover layout, color, and type for each option.

GATE 3 - Backlog (confirm)
- Produce epics, user stories, and tasks.
- Every item has acceptance criteria and at least 90% QA coverage.
- Deliver as markdown files (under docs/), summarized in chat with paths.

GATE 4 - Deploy (confirm before any deploy)
- Precondition: regression is 100% green (the full gate, see PROJECT gate commands). Never deploy red.
- Deploy = push to main → Netlify auto-deploys the PWA. The live-score API deploys separately via the Vercel CLI (see PROJECT).
- Merge to main race-safe (crons push concurrently): git pull --ff-only, merge branch, push; on data conflict prefer freshly generated files.
- After deploy, verify on prod (curl the deployed file/endpoint or load it in Chrome) — do not assume it shipped.
- State the rollback (one-line revert / one command) before deploying. Outward-facing or hard-to-reverse actions: confirm with me first.

BUILD MODEL
Orchestrate the team with the Workflow tool (deterministic fan-out; its ~16 concurrency cap matches the hard cap below). Through the gates, work sequentially: take each role in order (architect, designer, planner) so nothing is skipped. At build, form the team:
- PM / orchestrator agent: owns the backlog, partitions the work, manages the bug-fix agents.
- Solution architect and tech lead agents: own architecture and the final build and deploy.
- Epic / feature build agents: one per independent epic.
- QA: 3 QA agents plus smoke-test agents that verify every acceptance criterion.
- Bug-fix agents: separate from build, managed by the PM agent.

CONCURRENCY RULE
- Hard cap: 16 concurrent agents.
- The real limit is partitioning, not count. Concurrency equals the number of genuinely independent partitions (disjoint file ownership) so agents do not collide on shared files.
- Default 4 to 6 concurrent. Scale toward 16 only when the architecture has that many independent modules. Adding agents to coupled work raises merge and coordination cost without adding speed.

ITERATE
Build, test in sandbox (local: npm run serve, and Netlify deploy previews), then production, looping until 100% of regression passes. Add or extend a regression test for every fix and lock the exact behavior changed.

MANUAL HANDOFFS
When a step requires me to do something by hand (a UI action, an auth step, a value to fetch, a console command, anything outside Claude's reach), stop and give me:
1. Numbered, copy-paste-ready steps. One action per line. Exact menu paths, exact commands, exact field names.
2. The exact place to click or paste, and what I should see when it works.
3. A confirmation block I can copy and paste back to report status. Pre-fill it so I only edit values. Example:
   - Step done: yes / no
   - Output or value I got: ______
   - Error or anything unexpected: ______
Wait for my paste-back before continuing. If my report shows it worked, proceed. If not, diagnose from what I pasted and give corrected steps the same way. Do not advance the build past a manual step until I confirm it. Prefer the `! <command>` prompt prefix when I need to run something locally so the output lands in this session. Minimize handoffs: the Vercel CLI and connectors are already authenticated.

================================================================
PROJECT: WC26 TRACKER (GATE 1 pre-answered — this is the settled architecture)

World Cup 2026 prediction + live-tracker PWA. Vanilla JS, NO build step:
index.html shell + ~140 ES modules under app/ (hash router, no framework).
Do not introduce a bundler/framework/build pipeline for the app.

Hosting topology (non-obvious — get this right):
- PWA → Netlify (worldcup2026.j5lagenticstrategy.com). Publish dir "."; build is just `node scripts/write-runtime-config.mjs`. Deploy = push to main → auto-deploy.
- Live-score API → Vercel project `live-api` (team liddar-terminal): live-api/api/live.js Edge Function at https://live-api-liart.vercel.app/api/live. Redeploy: `cd live-api && vercel deploy --prod --yes --scope liddar-terminal`. Netlify ignores live-api/.
- Data pipeline → GitHub Actions crons commit JSON to data/ on main.
- Auth/pools → Supabase, username/password with synthetic @wc26.app emails (NOT Google OAuth). Prod project vodjwymxquuertmhtvuw. NEVER write to the deploy-preview project; never apply migrations to prod without an explicit OK in chat.

Regression gate (run in order; 100% green before any deploy; gate on EXIT CODES, not by grepping ANSI-colored summaries):
  python3 scripts/validate_data.py
  bash tests/smoke.sh
  node --test tests/feature/*.mjs tests/competition.test.mjs
  npx playwright test --config tests/playwright.config.mjs tests/ux tests/integrated

Live data — hard-won rules:
- GitHub `schedule:` crons are heavily throttled (a */15 cron fires ~every few hours). Do NOT rely on cron cadence for real-time.
- Real-time scores come from ESPN via the Vercel /api/live endpoint (app/live-scores.js → app/live-poller.js), with direct-ESPN fallback on error. The git pipeline (data/actual_results.json) is the durable record for scoring/leaderboards.
- STATUS-GATING IS CRITICAL: only FINAL records (STATUS_FINAL / STATUS_FULL_TIME / STATUS_END_OF_FULL_TIME) award points or advance the bracket. Live/half (STATUS_FIRST_HALF etc.) and 0-0 STATUS_SCHEDULED stubs display only — never as results.
- Team-name normalization: ESPN names differ from canonical (Bosnia-Herzegovina→Bosnia and Herzegovina, Türkiye→Turkiye, United States→USA). The RENAMES map is mirrored in app/live-scores.js, live-api/api/live.js, and the Python scrapers — keep them in sync.
- Kickoffs: data/schedule_full.json is the only source of kickoff_utc; scripts/reconcile_schedule.py (ESPN-authoritative) corrects date drift in the crons. scrape_schedule.py (FIFA) is robots-blocked.

Scoring (client-computed + netlify/functions/score-brackets.mjs): knockout R32=1, R16=2, QF=4, SF=8, Final=16, +16 champion; group 3/2/1. `score` column is service-role-only writable. Everyone-pool RPC uses EVERYONE_GROUP_ID = '00000000-0000-0000-0000-0000000e1e7e'.

Conventions:
- Match data/*.json on-disk encoding when writing from scripts (ensure_ascii=True) — keep diffs minimal, no cosmetic churn.
- sw.js does NOT cache (pure cache-purger); _headers controls app-code freshness (short max-age + stale-while-revalidate).
- Fix only what's scoped; no opportunistic refactors or new abstractions.
- Design/architecture notes live in docs/ (see docs/REALTIME_ARCHITECTURE.md). QA login: liddar@gmail.com.
