#!/usr/bin/env python3
"""PROTOTYPE shared library — leak-safe as-of feature builder for EVERY played
match (group + knockout), reused by the backtest harness, the GBM match model,
and the ML stacker so all three measure on identical rows.

For each FINAL match we replay Elo game-by-game up to that kickoff and recompute
FORM as-of (only prior games) — exactly the walk-forward discipline in
scripts/optimize_weights.py, generalized to all six knockout tiers. Static
sub-ratings (mine / tmv / qual / talent / coach) are pre-tournament curator
inputs, so using them is not leakage. The label is the REGULATION result
(a KO decided on penalties after a level regulation score is a DRAW outcome —
matching how data/backtest.json scores live2026).

Feature order (per team) is fixed and shared:
    FEATURES = [mine, elo_scaled, tmv_scaled, qual_scaled, form_scaled,
                talent_scaled, coach_scaled]
plus a per-team additive boost constant (continental/host).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))  # so `compute_elo` / `compute_form` resolve

import compute_elo as ce   # noqa: E402
import compute_form as cf   # noqa: E402

FEATURES = ["mine", "elo_scaled", "tmv_scaled", "qual_scaled", "form_scaled",
            "talent_scaled", "coach_scaled"]
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")
OUTCOMES = ["team_a_wins", "draw", "team_b_wins"]


def load_all():
    teams = json.loads((DATA / "teams.json").read_text())
    results = json.loads((DATA / "actual_results.json").read_text()) if (DATA / "actual_results.json").exists() else {}
    scale = json.loads((DATA / "elo_scale.json").read_text())
    tc_path = DATA / "proto" / "talent_coach.json"
    tc = json.loads(tc_path.read_text()) if tc_path.exists() else {}
    return teams, results, scale, tc


def _elo_scaled_of(elo, scale):
    return max(scale["clamp_lo"], min(scale["clamp_hi"], scale["a"] * elo + scale["b"]))


def final_matches_all(results):
    """[(kickoff, tier, a, b, sa, sb, k)] for FINAL games across ALL tiers, chrono."""
    out = []
    for tier in ("group_stage",) + KO_TIERS:
        k = ce.K_GROUP if tier == "group_stage" else ce.K_KO
        for key, rec in (results.get(tier) or {}).items():
            if "__vs__" not in key or not isinstance(rec, dict):
                continue
            st = rec.get("status")
            if st and st not in ce.FINAL:
                continue
            sa, sb = rec.get("score_a"), rec.get("score_b")
            if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)):
                continue
            a, b = key.split("__vs__", 1)
            out.append((rec.get("kickoff_utc") or "", tier, a, b, sa, sb, k))
    out.sort(key=lambda g: g[0])
    return out


def build_rows(include_ko=True):
    """As-of feature rows for every played match.
    Returns list of dicts: {tier, a, b, fa, fb, ba, bb, outcome, kickoff}
    where fa/fb are FEATURES-ordered vectors and ba/bb are boost constants."""
    teams, results, scale, tc = load_all()
    names = list(teams.keys())
    seed = {n: float(teams[n].get("elo_raw") or 1500) for n in names}

    def boost(n):
        t = teams[n]; b = t.get("boosts", {}); v = 0.0
        if t.get("continental_champion"): v += b.get("continental", 0)
        if t.get("is_host"): v += b.get("host", 0)
        return v

    def static_feat(n, key):
        if key in ("talent_scaled", "coach_scaled"):
            rec = tc.get(n) or {}
            v = rec.get(key)
            return float(v) if isinstance(v, (int, float)) else (scale["clamp_lo"] + scale["clamp_hi"]) / 2.0
        return float(teams[n]["sub_ratings"].get(key, 0.0))

    all_matches_cf = cf.final_matches(results)  # for as-of form (group+KO)
    games = final_matches_all(results)
    if not include_ko:
        games = [g for g in games if g[1] == "group_stage"]

    rows = []
    elo = dict(seed)
    for koff, tier, a, b, sa, sb, k in games:
        if a not in teams or b not in teams:
            continue
        form_raw = cf.form_for_games(all_matches_cf, seed, names, before=koff)
        form_scaled = cf.to_scaled(form_raw, scale)

        def vec(n):
            return np.array([
                static_feat(n, "mine"),
                _elo_scaled_of(elo.get(n, 1500), scale),
                static_feat(n, "tmv_scaled"),
                static_feat(n, "qual_scaled"),
                form_scaled[n],
                static_feat(n, "talent_scaled"),
                static_feat(n, "coach_scaled"),
            ], dtype=float)

        outcome = 0 if sa > sb else 1 if sa == sb else 2
        rows.append({
            "tier": tier, "a": a, "b": b, "kickoff": koff,
            "fa": vec(a), "fb": vec(b), "ba": boost(a), "bb": boost(b),
            "outcome": outcome,
        })
        ce.apply_update(elo, a, b, {"score_a": sa, "score_b": sb}, k)
    return rows


def diff_matrix(rows):
    """X = per-match a-minus-b feature diffs (+ boost diff), y = outcome. Shared
    design matrix for the GBM. Columns: FEATURES diffs + 'boost'."""
    X, y, meta = [], [], []
    for r in rows:
        d = (r["fa"] - r["fb"]).tolist() + [r["ba"] - r["bb"]]
        X.append(d)
        y.append(r["outcome"])
        meta.append({"tier": r["tier"], "a": r["a"], "b": r["b"], "kickoff": r["kickoff"]})
    return np.array(X, float), np.array(y, int), meta


DIFF_COLS = FEATURES + ["boost"]
