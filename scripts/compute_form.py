#!/usr/bin/env python3
"""In-tournament FORM signal → teams.json sub_ratings.form_scaled.

P1 of the J5L optimizer work: add the new information available mid-tournament —
how teams are actually performing vs expectation — as a weighted composite input
(optimize_weights tunes its weight; rebuild_composite reads form_scaled).

Form = per-game (actual points − Elo-expected points) + a small goal-difference
term, z-scored across teams, mapped onto the same scale as the other sub_ratings
(the elo_scaled range in data/elo_scale.json) so the weighted sum stays
commensurate. Teams with no games get the neutral midpoint (no effect).

LEAK-SAFE by construction for live use (uses only FINAL results). The optimizer
recomputes form as-of-each-game for honest walk-forward CV via form_for_games().
Idempotent. Exits 0 on error, leaving teams.json untouched.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME"}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")


def log(m): print(f"[form] {m}", file=sys.stderr, flush=True)


def _elo_expected(elo_a, elo_b):
    return 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / 400.0))


def final_matches(results):
    """[(kickoff, a, b, score_a, score_b)] for FINAL games, chronological."""
    out = []
    for tier in ("group_stage",) + KO_TIERS:
        for key, rec in (results.get(tier) or {}).items():
            if not isinstance(rec, dict) or "__vs__" not in key:
                continue
            st = rec.get("status")
            if st and st not in FINAL:
                continue
            sa, sb = rec.get("score_a"), rec.get("score_b")
            if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)):
                continue
            a, b = key.split("__vs__", 1)
            out.append((rec.get("kickoff_utc") or "", a, b, sa, sb))
    out.sort(key=lambda r: r[0])
    return out


def form_for_games(matches, elo_seed, names, before=None):
    """Form RAW per team from `matches` (optionally only those with kickoff <
    `before`, for leak-safe CV). Returns {name: raw_form_mean}."""
    agg = {n: [] for n in names}
    for koff, a, b, sa, sb in matches:
        if before is not None and koff >= before:
            continue
        if a not in agg or b not in agg:
            continue
        exp_a = _elo_expected(elo_seed.get(a, 1500), elo_seed.get(b, 1500))
        pts_a = 3 if sa > sb else 1 if sa == sb else 0
        pts_b = 3 if sb > sa else 1 if sa == sb else 0
        gd = sa - sb
        agg[a].append((pts_a - 3 * exp_a) + 0.15 * max(-3, min(3, gd)))
        agg[b].append((pts_b - 3 * (1 - exp_a)) + 0.15 * max(-3, min(3, -gd)))
    return {n: (sum(v) / len(v) if v else None) for n, v in agg.items()}


def to_scaled(raw, scale):
    """Z-score the non-None raw form across teams, map to the sub-rating scale."""
    vals = [v for v in raw.values() if v is not None]
    mid = (scale["clamp_lo"] + scale["clamp_hi"]) / 2.0
    if len(vals) < 2:
        return {n: mid for n in raw}
    mu = sum(vals) / len(vals)
    var = sum((v - mu) ** 2 for v in vals) / len(vals)
    sd = var ** 0.5 or 1.0
    spread = (scale["clamp_hi"] - scale["clamp_lo"]) / 4.0  # ±2σ spans the range
    out = {}
    for n, v in raw.items():
        if v is None:
            out[n] = round(mid, 1)
        else:
            z = (v - mu) / sd
            out[n] = round(max(scale["clamp_lo"], min(scale["clamp_hi"], mid + spread * z)), 1)
    return out


def main():
    teams = json.loads((DATA / "teams.json").read_text())
    results = json.loads((DATA / "actual_results.json").read_text()) if (DATA / "actual_results.json").exists() else {}
    scale = json.loads((DATA / "elo_scale.json").read_text()) if (DATA / "elo_scale.json").exists() else {"clamp_lo": 56.3, "clamp_hi": 93.1}
    names = list(teams.keys())
    elo_seed = {n: float(teams[n].get("elo_raw") or 1500) for n in names}

    matches = final_matches(results)
    raw = form_for_games(matches, elo_seed, names)
    scaled = to_scaled(raw, scale)

    changed = 0
    for n, t in teams.items():
        sub = t.setdefault("sub_ratings", {})
        if sub.get("form_scaled") != scaled[n]:
            sub["form_scaled"] = scaled[n]
            changed += 1
    (DATA / "teams.json").write_text(json.dumps(teams, ensure_ascii=False, indent=2) + "\n")
    played = sum(1 for v in raw.values() if v is not None)
    log(f"form: {len(matches)} FINAL games, {played} teams with form; updated {changed}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving teams.json untouched")
        raise SystemExit(0)
