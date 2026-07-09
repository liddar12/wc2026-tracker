#!/usr/bin/env python3
"""Build data/stacker.json — the "J5L AI Enhanced" model: an ML-calibrated linear
blend of the J5L composite and the DT rating, with the blend weight LEARNED from
the 2026 matches played so far (refit every cron, so it keeps "learning from this
World Cup").

    stack_strength(team) = alpha * z(J5L composite) + (1 - alpha) * z(DT rating)

alpha is fit to MINIMISE multiclass log-loss of the bivariate-Poisson W/D/L over
all FINAL matches (same wdl() the hybrid uses, imported from build_hybrid so the
math stays identical). NEVER-REGRESS-free: it's a 1-parameter grid search on a
convex-ish objective, floored so a thin early sample can't swing it wildly.

The client (app/bracket-autofill.js `stack` source) simply compares
stack_strength[a] vs stack_strength[b] to pick a winner — exactly like the hybrid
source compares hybrid_strength — so the UI change is minimal and robust.

Reads data/{teams,dt_model,actual_results}.json (all live, cron-fed).
Run:  python3 scripts/build_stacker.py   (after build_dt_model + rebuild_composite)
"""
from __future__ import annotations

import math
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hybrid as bh  # noqa: E402  (zscore, wdl, load, dpath, save_atomic)

FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")
ALPHA_FLOOR, ALPHA_CEIL = 0.15, 0.95   # keep both models in the blend
EPS = 1e-9


def log(m):
    print(f"[stacker] {m}", file=sys.stderr, flush=True)


def played_matches(results):
    out = []
    for tier in ("group_stage",) + KO_TIERS:
        for key, rec in (results.get(tier) or {}).items():
            if "__vs__" not in key or not isinstance(rec, dict):
                continue
            st = rec.get("status")
            if st and st not in FINAL:
                continue
            sa, sb = rec.get("score_a"), rec.get("score_b")
            if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)):
                continue
            a, b = key.split("__vs__", 1)
            out.append((a, b, 0 if sa > sb else 1 if sa == sb else 2))
    return out


def logloss_acc(matches, zj, zd, alpha):
    ll = 0.0
    correct = 0
    n = 0
    for a, b, y in matches:
        if a not in zj or b not in zj:
            continue
        gap = alpha * (zj[a] - zj[b]) + (1 - alpha) * (zd[a] - zd[b])
        p = bh.wdl(gap)
        ll += -math.log(max(EPS, p[y]))
        if max(range(3), key=lambda i: p[i]) == y:
            correct += 1
        n += 1
    if not n:
        return None, None, 0
    return ll / n, correct / n, n


def main() -> int:
    teams = bh.load("teams.json")
    dt = {r["country"]: r.get("rating", 0) for r in bh.load("dt_model.json").get("team_rankings", [])}
    results = bh.load("actual_results.json") if os.path.exists(bh.dpath("actual_results.json")) else {}
    names = list(teams.keys())

    zj_arr = bh.zscore([teams[n].get("composite") or 0 for n in names])
    zd_arr = bh.zscore([dt.get(n, 0) for n in names])
    zj = {n: float(v) for n, v in zip(names, zj_arr)}
    zd = {n: float(v) for n, v in zip(names, zd_arr)}

    matches = played_matches(results)
    # 1-parameter grid search for alpha (weight on J5L). Default 0.7 when no games.
    best_alpha, best_ll, best_acc, ngames = 0.7, None, None, 0
    if matches:
        for a100 in range(int(ALPHA_FLOOR * 100), int(ALPHA_CEIL * 100) + 1):
            alpha = a100 / 100.0
            ll, acc, n = logloss_acc(matches, zj, zd, alpha)
            if ll is None:
                continue
            if best_ll is None or ll < best_ll:
                best_alpha, best_ll, best_acc, ngames = alpha, ll, acc, n

    strengths = {n: round(best_alpha * zj[n] + (1 - best_alpha) * zd[n], 4) for n in names}
    out = {
        "model": {
            "id": "stack",
            "name": "J5L AI Enhanced",
            "method": "alpha*z(J5L composite) + (1-alpha)*z(DT rating); alpha fit to minimise "
                      "bivariate-Poisson multiclass log-loss over played 2026 matches (refit each cron).",
            "version": "1.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "alpha": round(best_alpha, 3),
        "fit": {"n_matches": ngames,
                "logloss": round(best_ll, 4) if best_ll is not None else None,
                "accuracy": round(best_acc, 3) if best_acc is not None else None},
        "strengths": strengths,
    }
    bh.save_atomic("stacker.json", out)
    top = sorted(strengths.items(), key=lambda kv: -kv[1])[:3]
    log(f"alpha={best_alpha:.2f} (J5L/DT {best_alpha*100:.0f}/{(1-best_alpha)*100:.0f}) · "
        f"n={ngames} logloss={out['fit']['logloss']} acc={out['fit']['accuracy']} · "
        f"top: {', '.join(f'{n} {v:+.2f}' for n, v in top)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving stacker.json untouched")
        raise SystemExit(0)
