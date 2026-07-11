#!/usr/bin/env python3
"""R22: dominance-MAX signal → teams.json sub_ratings.dominance_scaled.

Owner thesis (same family as the live Match Momentum panel): reward a team's
PEAK match dominance, not a washed-out average. Per played match we compute a
signed dominance score from the real ESPN boxscore (data/match_stats.json):

    dominance = 0.55·SoT_share_diff + 0.30·shot_share_diff + 0.15·poss_diff/100

(clamped to [-1, 1]; the SoT>shots>possession weighting mirrors
app/lib/momentum.js, where the same hierarchy proved most decisive). A team's
raw signal is the MAX of its per-match dominance values — its best statistical
performance of the tournament — z-scored across teams and mapped onto the
sub-rating scale (elo_scale.json), exactly like compute_form.

OPTIMIZER-GATED BY DESIGN: this script only writes the sub-rating. Its
composite weight starts at 0 (meta.model_weights.dominance) and can ONLY be
raised by the DAILY optimize_weights walk-forward fit, behind the same
never-regress margin as every other weight — the 2026 prototype showed
dominance-MAX beats dominance-MEAN but the edge was inside noise (Δll 0.0003
at n=67), so we let the data decide rather than hard-adopting.

Teams with no boxscore get the neutral midpoint (no effect). Leak-safe for the
optimizer via dominance_for_games(..., before=koff). Idempotent; exits 0 on
error leaving teams.json untouched.

Run:  python3 scripts/compute_dominance.py   (after scrape_match_stats)
      python3 scripts/compute_dominance.py --self-test
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")

# Mirrors app/lib/momentum.js W_SOT/W_SHOT/W_POSS — the proven signal hierarchy.
W_SOT, W_SHOT, W_POSS = 0.55, 0.30, 0.15


def log(m): print(f"[dominance] {m}", file=sys.stderr, flush=True)


def match_dominance(sa: dict, sb: dict) -> float | None:
    """Signed per-match dominance (A-positive) from two boxscore stat dicts.
    None when the record has no usable shot data (all-zero shots ⇒ no signal)."""
    sot_a, sot_b = sa.get("shotsOnTarget") or 0, sb.get("shotsOnTarget") or 0
    sh_a, sh_b = sa.get("totalShots") or 0, sb.get("totalShots") or 0
    po_a = sa.get("possessionPct")
    po_b = sb.get("possessionPct")
    if not (sh_a or sh_b or sot_a or sot_b):
        return None
    sot = (sot_a - sot_b) / max(1.0, sot_a + sot_b)
    sh = (sh_a - sh_b) / max(1.0, sh_a + sh_b)
    if isinstance(po_a, (int, float)) and isinstance(po_b, (int, float)):
        po = (po_a - po_b) / 100.0
    else:
        po = 0.0
    d = W_SOT * sot + W_SHOT * sh + W_POSS * po
    return max(-1.0, min(1.0, d))


def played_stat_games(match_stats: dict, results: dict):
    """[(kickoff, team_a, team_b, dominance)] for FINAL games that have a
    boxscore, chronological. Kickoff joined from actual_results (the durable
    record; match_stats records carry no timestamp)."""
    koff_by_pair = {}
    for tier in ("group_stage",) + KO_TIERS:
        for key, rec in (results.get(tier) or {}).items():
            if "__vs__" not in key or not isinstance(rec, dict):
                continue
            st = rec.get("status")
            if st and st not in FINAL:
                continue
            a, b = key.split("__vs__", 1)
            koff_by_pair[frozenset((a, b))] = rec.get("kickoff_utc") or ""

    out = []
    for key, rec in (match_stats or {}).items():
        if key == "__meta__" or not isinstance(rec, dict):
            continue
        a, b = rec.get("team_a"), rec.get("team_b")
        stats = rec.get("stats") or {}
        sa, sb = stats.get("a") or {}, stats.get("b") or {}
        if not a or not b:
            continue
        pair = frozenset((a, b))
        if pair not in koff_by_pair:
            continue  # not FINAL yet (live boxscore) — never a rating input
        d = match_dominance(sa, sb)
        if d is None:
            continue
        out.append((koff_by_pair[pair], a, b, d))
    out.sort(key=lambda r: r[0])
    return out


def dominance_for_games(games, names, before=None):
    """Raw dominance-MAX per team from `games` (optionally only kickoff <
    `before`, for the optimizer's leak-safe walk-forward). {name: max|None}."""
    agg = {n: [] for n in names}
    for koff, a, b, d in games:
        if before is not None and koff >= before:
            continue
        if a in agg:
            agg[a].append(d)
        if b in agg:
            agg[b].append(-d)
    return {n: (max(v) if v else None) for n, v in agg.items()}


def main():
    # Same z-score → sub-rating-scale mapping as form (commensurate weights).
    import compute_form as cf

    teams = json.loads((DATA / "teams.json").read_text())
    results = json.loads((DATA / "actual_results.json").read_text()) if (DATA / "actual_results.json").exists() else {}
    match_stats = json.loads((DATA / "match_stats.json").read_text()) if (DATA / "match_stats.json").exists() else {}
    scale = json.loads((DATA / "elo_scale.json").read_text()) if (DATA / "elo_scale.json").exists() else {"clamp_lo": 56.3, "clamp_hi": 93.1}
    names = list(teams.keys())

    games = played_stat_games(match_stats, results)
    raw = dominance_for_games(games, names)
    scaled = cf.to_scaled(raw, scale)

    changed = 0
    for n, t in teams.items():
        sub = t.setdefault("sub_ratings", {})
        if sub.get("dominance_scaled") != scaled[n]:
            sub["dominance_scaled"] = scaled[n]
            changed += 1
    if changed:
        (DATA / "teams.json").write_text(json.dumps(teams, ensure_ascii=False, indent=2) + "\n")
    covered = sum(1 for v in raw.values() if v is not None)
    log(f"dominance: {len(games)} boxscored FINAL games, {covered} teams covered; updated {changed}")
    return 0


def _self_test() -> int:
    # match_dominance: SoT-heavy side dominates; sign flips; clamped; no-shots → None.
    strong = {"shotsOnTarget": 6, "totalShots": 15, "possessionPct": 62}
    weak = {"shotsOnTarget": 1, "totalShots": 4, "possessionPct": 38}
    d = match_dominance(strong, weak)
    assert d is not None and d > 0.4, f"dominant side strongly positive (got {d})"
    assert abs(match_dominance(weak, strong) + d) < 1e-12, "antisymmetric"
    assert match_dominance({"shotsOnTarget": 0, "totalShots": 0}, {"shotsOnTarget": 0, "totalShots": 0}) is None
    assert -1.0 <= match_dominance({"shotsOnTarget": 99, "totalShots": 99, "possessionPct": 99},
                                   {"shotsOnTarget": 0, "totalShots": 0, "possessionPct": 1}) <= 1.0

    # dominance_for_games: MAX (peak), not mean — one huge game beats two mild ones.
    games = [
        ("2026-06-12T00:00:00Z", "X", "Y", 0.9),   # X peak
        ("2026-06-16T00:00:00Z", "X", "Z", -0.2),  # X mildly outplayed
        ("2026-06-20T00:00:00Z", "Y", "Z", 0.1),
    ]
    raw = dominance_for_games(games, ["X", "Y", "Z"])
    assert raw["X"] == 0.9, f"peak kept, not averaged (got {raw['X']})"
    assert raw["Y"] == max(-0.9, 0.1) == 0.1
    assert raw["Z"] == max(0.2, -0.1) == 0.2

    # leak-safe cutoff: `before` excludes later games.
    asof = dominance_for_games(games, ["X", "Y", "Z"], before="2026-06-15")
    assert asof["X"] == 0.9 and asof["Z"] is None, "cutoff honored"

    # played_stat_games: joins kickoff from FINAL results, skips live/unknown pairs.
    ms = {"A__vs__B": {"team_a": "A", "team_b": "B",
                       "stats": {"a": strong, "b": weak}},
          "C__vs__D": {"team_a": "C", "team_b": "D",
                       "stats": {"a": strong, "b": weak}}}
    res = {"group_stage": {"A__vs__B": {"status": "STATUS_FULL_TIME",
                                        "score_a": 2, "score_b": 0,
                                        "kickoff_utc": "2026-06-12T00:00:00Z"}}}
    g = played_stat_games(ms, res)
    assert len(g) == 1 and g[0][1] == "A", "only FINAL boxscores become rating inputs"

    print("selftest: PASS")
    return 0


if __name__ == "__main__":
    try:
        if "--self-test" in sys.argv or "--selftest" in sys.argv:
            raise SystemExit(_self_test())
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving teams.json untouched")
        raise SystemExit(0)
