"""Recompute team composite scores and group-stage match probabilities.

CONSERVATIVE BY DESIGN. The starter `sub_ratings` are curator-calibrated against
a model whose exact scaling formula we don't have a runtime spec for. This
script therefore:

  * Preserves existing sub_ratings as the canonical inputs.
  * Recomputes `composite` = weighted sum of sub_ratings + continental/host boosts.
  * Recomputes group_matchups probabilities + expected points from new composites.
  * Re-ranks power_rank.

If a scraper genuinely changes `elo_raw` or `tmv_musd`, the operator should
update `sub_ratings` consistently (the source-of-truth model is documented
in meta.json `model_version`).
"""
from __future__ import annotations

import math
import sys

from _common import load_json, log, save_json, update_meta


def composite(team: dict, weights: dict) -> float:
    sub = team.get("sub_ratings", {})
    base = (
        weights["mine"] * sub.get("mine", 0)
        + weights["elo"] * sub.get("elo_scaled", 0)
        + weights["tmv"] * sub.get("tmv_scaled", 0)
        + weights["qual"] * sub.get("qual_scaled", 0)
    )
    boosts = team.get("boosts", {})
    if team.get("continental_champion"):
        base += boosts.get("continental", 0)
    if team.get("is_host"):
        base += boosts.get("host", 0)
    return round(base, 1)


def win_probs(gap: float) -> tuple[float, float, float]:
    """Three-way model: logistic for A vs B, draw mass shrinks with |gap|."""
    p_a = 1 / (1 + math.exp(-gap / 4.5))
    p_b = 1 - p_a
    draw = max(0.05, 0.32 - abs(gap) * 0.015)
    rest = 1 - draw
    return p_a * rest, draw, p_b * rest


def rebuild() -> None:
    meta = load_json("meta.json")
    weights = meta["model_weights"]

    teams = load_json("teams.json")
    teams_changed = 0
    for name, team in teams.items():
        new = composite(team, weights)
        if new != team.get("composite"):
            team["composite"] = new
            teams_changed += 1

    ranked = sorted(teams.items(), key=lambda kv: -kv[1]["composite"])
    for i, (n, _) in enumerate(ranked, start=1):
        teams[n]["power_rank"] = i
    if teams_changed:
        save_json("teams.json", teams)

    matchups = load_json("group_matchups.json")
    matches_changed = 0
    for group_letter, group in matchups.items():
        for m in group["matches"]:
            a = teams[m["team_a"]]
            b = teams[m["team_b"]]
            new_a = a["composite"]
            new_b = b["composite"]
            gap = new_a - new_b
            pa, pd, pb = win_probs(gap)
            new = {
                "composite_a": new_a,
                "composite_b": new_b,
                "gap": round(abs(gap), 1),
                "probabilities": {
                    "team_a_wins": round(pa * 100, 1),
                    "draw": round(pd * 100, 1),
                    "team_b_wins": round(pb * 100, 1),
                },
                "expected_points": {
                    "team_a": round(pa * 3 + pd, 2),
                    "team_b": round(pb * 3 + pd, 2),
                },
            }
            if abs(gap) < 3:
                new["predicted_winner"] = "draw_likely"
                new["win_confidence_pct"] = round(max(pa, pb) * 100, 1)
            elif gap > 0:
                new["predicted_winner"] = m["team_a"]
                new["win_confidence_pct"] = round(pa * 100, 1)
            else:
                new["predicted_winner"] = m["team_b"]
                new["win_confidence_pct"] = round(pb * 100, 1)
            for k, v in new.items():
                if m.get(k) != v:
                    m[k] = v
                    matches_changed += 1
            risk = m.setdefault("upset_risk", {})
            risk["favored"] = m["team_a"] if gap >= 0 else m["team_b"]
            risk["underdog"] = m["team_b"] if gap >= 0 else m["team_a"]
            risk["gap"] = round(abs(gap), 1)
    if matches_changed:
        save_json("group_matchups.json", matchups)

    if teams_changed or matches_changed:
        update_meta()
        log(f"composite: refreshed (teams={teams_changed}, matches={matches_changed})")
    else:
        log("composite: no changes")


def main() -> int:
    rebuild()
    return 0


if __name__ == "__main__":
    sys.exit(main())
