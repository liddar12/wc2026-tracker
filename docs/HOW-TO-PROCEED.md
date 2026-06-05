# How to proceed (as of 2026-06-05 · kickoff 2026-06-11)

Everything buildable is shipped + live on prod (173 green tests). What remains
needs YOU (a secret, your Mac, or data). Prioritized by the kickoff.

## P0 — Activate live scoring (~5 min) 🔴 do first
Scorer is DORMANT → Everyone-pool leaderboard + Golden Boot live tracker show 0
once matches start until this is set.
1. Supabase → dashboard/project/vodjwymxquuertmhtvuw/settings/api → copy the
   **service_role** (secret) key — NOT anon/publishable.
2. Netlify → site golden-kheer-bc4402 → Site config → Environment variables →
   add `WC26_SUPABASE_SERVICE_KEY` = (that key), scope Production+Functions.
3. Netlify → Deploys → Trigger deploy → Deploy site.
4. Verify: GET /.netlify/functions/score-brackets → {"ok":true,...} (was dormant).
   (0 updates pre-tournament is correct.)

## P1 — Make the models real (before/around launch) 🟡
1a. DT talent layer (needs your Mac — FBref = residential IP):
    cd ~/Downloads/DT\ model
    python worldcup_model_data.py --fbref      # writes cache/fbref_features.csv
    # review cache/names_to_review.csv → cache/name_map.csv
    python build_dt_model.py                    # regenerates dt_model.json w/ talent
    Commit fbref_features.csv + dt_model.json (or hand me them) → I wire it in +
    drop the "Elo-anchored prior" label.
1b. Backtests (DT + Golden Boot): provide historical results + contemporary
    ratings (WC14/18/22, Euro16/20/24, Copa21/24) OR tell me "source the
    backtest data" and I'll pull a public dataset + run the harnesses
    (worldcup_backtest.py, golden-boot-backtest.mjs) → publish real accuracy.

## P2 — Frozen-feed alerting (~5 min) 🟢
UptimeRobot HTTP monitor → /.netlify/functions/results-health, 5-min interval,
alert when status != 200. (Runbook: docs/RESULTS-HEALTH-MONITORING.md)

## P3 — Golden Boot enrichment (optional) ⚪
Provide penalty-taker / set-piece / corner data → replaces the heuristic for
materially better Golden Boot odds.

## Recommended order
P0 now → P2 + "source the backtest data" this week → P1 FBref when you can → P3 optional.

Reference plans: docs/48h-readiness/*, docs/REMEDIATION-PLAN.md,
docs/GOLDEN-BOOT-PLAN.md, docs/RESULTS-HEALTH-MONITORING.md.
