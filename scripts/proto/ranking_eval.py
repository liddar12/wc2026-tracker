#!/usr/bin/env python3
"""PROTOTYPE — ranking / champion-tier accuracy of each model vs the actual 2026
tournament progression (the "projected winners" half of the 90% target).

For each team we compute rounds-survived from actual_results.json (0=out in
groups ... up to reaching QF), then score each model's PRE-TOURNAMENT strength
ordering against it:
  * Spearman(strength, rounds_survived)
  * precision@8 / @16  (share of the actual QF-8 / R16-16 that the model ranked
    in its own top-8 / top-16)
Models: J5L (teams.composite / power_rank), DT (dt_model rating), Hybrid
(forecast champion odds), + an extended J5L composite that folds in talent+coach.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = ROOT / "data"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
KO_TIERS = ["round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final"]
OUT = DATA / "proto" / "ranking_report.json"


def rounds_survived():
    """Deepest round each team is still alive in (reached), from FINAL games +
    scheduled-but-set knockout pairings (a team appearing in a later tier's
    fixture reached that tier)."""
    res = json.loads((DATA / "actual_results.json").read_text())
    reached = {}
    tier_level = {"group_stage": 0, "round_of_32": 1, "round_of_16": 2,
                  "quarterfinals": 3, "semifinals": 4, "third_place": 4, "final": 5}
    for tier, lvl in tier_level.items():
        for key, rec in (res.get(tier) or {}).items():
            if "__vs__" not in key:
                continue
            a, b = key.split("__vs__", 1)
            for tm in (a, b):
                reached[tm] = max(reached.get(tm, 0), lvl)
    return reached


def strengths():
    teams = json.loads((DATA / "teams.json").read_text())
    dt = {r["country"]: r for r in json.loads((DATA / "dt_model.json").read_text())["team_rankings"]}
    fc = json.loads((DATA / "forecast.json").read_text())
    tc_path = DATA / "proto" / "talent_coach.json"
    tc = json.loads(tc_path.read_text()) if tc_path.exists() else {}

    champ = {}
    for row in (fc.get("teams") or fc.get("rankings") or []):
        nm = row.get("team") or row.get("country")
        champ[nm] = row.get("champion") or row.get("title_prob") or row.get("champion_pct") or 0
    names = list(teams)
    S = {}
    S["J5L_composite"] = {n: teams[n]["composite"] for n in names}
    S["DT_rating"] = {n: dt.get(n, {}).get("rating", 0) for n in names}
    S["Hybrid_champodds"] = {n: champ.get(n, 0) for n in names}
    # extended J5L: composite + small talent/coach nudge (illustrative)
    ext = {}
    for n in names:
        base = teams[n]["composite"]
        t = tc.get(n, {})
        ts = t.get("talent_scaled"); cs = t.get("coach_scaled")
        bump = 0.0
        if isinstance(ts, (int, float)): bump += 0.05 * (ts - 74.7)
        if isinstance(cs, (int, float)): bump += 0.03 * (cs - 74.7)
        ext[n] = base + bump
    S["J5L_ext_talentcoach"] = ext
    return names, S


def precision_at(strength, reached, names, k):
    top = set(sorted(names, key=lambda n: -strength.get(n, 0))[:k])
    actual = set(sorted(names, key=lambda n: -reached.get(n, 0))[:k])
    return len(top & actual) / k


def main():
    reached = rounds_survived()
    names, S = strengths()
    surv = np.array([reached.get(n, 0) for n in names])

    report = {"note": "ranking vs actual 2026 progression (rounds reached)",
              "n_teams": len(names), "models": {}}
    print(f"\n{'model':22s} {'spearman':>9s} {'p@8':>6s} {'p@16':>7s}")
    for name, strg in S.items():
        vec = np.array([strg.get(n, 0) for n in names], float)
        rho = float(spearmanr(vec, surv).statistic)
        p8 = precision_at(strg, reached, names, 8)
        p16 = precision_at(strg, reached, names, 16)
        report["models"][name] = {"spearman": round(rho, 3), "p_at_8": round(p8, 3), "p_at_16": round(p16, 3)}
        print(f"{name:22s} {rho:>9.3f} {p8:>6.3f} {p16:>7.3f}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    # who are the QF-8, and did top models have them?
    qf8 = sorted(names, key=lambda n: -reached.get(n, 0))[:8]
    print("\nActual QF-8:", ", ".join(qf8))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
