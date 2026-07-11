#!/usr/bin/env python3
"""Build per-match prediction rows for the KNOCKOUT bracket.

WHY: data/group_matchups.json only covers the group stage. The moment the
tournament reaches the knockouts the matchup-detail / pick views had NO
per-match prediction data for an actual R32+ fixture (RCA 2026-06-30, bugs
1-data/2-data). This produces data/knockout_matchups.json — an ARRAY of match
rows that MIRROR a group_matchups match row exactly (so the same UI + scoring
code path renders them) PLUS two knockout-only fields:

  advance_pct_a / advance_pct_b  — probability each side ADVANCES (wins the tie).
  is_knockout: true              — marks the row as a knockout fixture.

advance_pct folds the draw mass via ET/pens: a knockout cannot end level, so the
regulation draw probability is split between the two sides PROPORTIONALLY to
their regulation win shares (the stronger side is likelier to win ET/pens):

    share_a = pa / (pa + pb)
    advance_pct_a = (pa + pd * share_a) * 100
    advance_pct_b = (pb + pd * (1 - share_a)) * 100
    # advance_pct_a + advance_pct_b == 100 (within rounding)

The base W/D/L is the SAME bivariate-Poisson on the composite gap that
rebuild_composite.py writes for group matches (imported, not re-derived), so the
knockout bars are consistent with the group bars.

Inputs:  data/schedule_full.json (knockout fixtures with REAL team names),
         data/teams.json (composites), data/meta.json (poisson_group calibration).
Output:  data/knockout_matchups.json (ARRAY), via _common.save_json (ensure_ascii=True).

Placeholder fixtures (W#/L#/slot codes like "2A", "3_ABCDF") are SKIPPED until
resolve_knockouts.py fills them in. Pure stdlib + the project's own helpers; no
network. Idempotent. Run AFTER rebuild_composite (needs fresh composites):

    python3 scripts/build_knockout_matchups.py
"""
from __future__ import annotations

import sys

from _common import load_json, log, save_json
from rebuild_composite import win_probs

KNOCKOUT_STAGES = {
    "round_of_32", "round_of_16", "quarterfinals",
    "semifinals", "third_place", "final",
}
# Same placeholder grammar reconcile_schedule / resolve_knockouts use
# ("1A","2B","3 ABCDF","3_ABCDF","W73","L101","RU-A"…). Anything matching is a
# slot we can't predict yet, so we skip it.
import re

PLACEHOLDER_RE = re.compile(r"^\d[A-L]$|^[A-L]\d|^3[A-L/_]|^3 |^W\d|^L\d|^1[A-L]|^2[A-L]|^RU", re.I)


def is_placeholder(name: str | None) -> bool:
    return not name or bool(PLACEHOLDER_RE.match(str(name).strip()))


def upset_risk(team_a: str, team_b: str, gap: float) -> dict:
    """Mirror rebuild_composite's upset_risk block (favored/underdog/gap +
    a single close-gap indicator when the teams are near-even)."""
    favored = team_a if gap >= 0 else team_b
    underdog = team_b if gap >= 0 else team_a
    risk = {"favored": favored, "underdog": underdog, "gap": round(abs(gap), 1), "indicators": []}
    if abs(gap) < 3:
        risk["indicators"].append({
            "type": "close_gap",
            "severity": "high",
            "label": "Toss-up game",
            "detail": f"Composite gap only {abs(gap):.1f} points",
        })
    return risk


def build_row(m: dict, teams: dict, mu: float, beta: float,
              stack_strengths: dict | None = None) -> dict | None:
    a = m.get("team_a")
    b = m.get("team_b")
    if is_placeholder(a) or is_placeholder(b):
        return None
    ta = teams.get(a)
    tb = teams.get(b)
    if not ta or not tb:
        return None

    ca = ta.get("composite") or 0
    cb = tb.get("composite") or 0
    gap = ca - cb
    # J5L composite W/D/L — always computed; persisted under j5l_probabilities
    # so the model grid + snapshot_backtest keep a faithful J5L record.
    j5l_pa, j5l_pd, j5l_pb = win_probs(gap, mu, beta)

    # R21: the HEADLINE probabilities follow the app's default model — the
    # "J5L AI Enhanced" stack (data/stacker.json, learned alpha on z(J5L)+z(DT))
    # — so the matchup To-advance header, W/D/L bar, knockout cards, AND the
    # in-play win-probability prior (priorFromMatch prefers advance_pct) all
    # inherit the self-learning model. bh.wdl is the SAME Poisson the stacker
    # fit uses (build_hybrid MU/BETA on z-score gaps), keeping the math
    # identical to the client's stackMatchTriplet. Falls back to the composite
    # J5L probs when stacker.json is missing or a team is absent.
    pa, pd, pb = j5l_pa, j5l_pd, j5l_pb
    prob_source = "j5l_composite"
    if stack_strengths:
        sa_ = stack_strengths.get(a)
        sb_ = stack_strengths.get(b)
        if isinstance(sa_, (int, float)) and isinstance(sb_, (int, float)):
            import build_hybrid as bh
            pa, pd, pb = bh.wdl(float(sa_) - float(sb_))
            prob_source = "stack"

    # advance_pct: split the draw mass (ET/pens) proportionally to win shares.
    denom = pa + pb
    share_a = pa / denom if denom > 0 else 0.5
    adv_a = pa + pd * share_a
    adv_b = pb + pd * (1.0 - share_a)

    row: dict = {
        "team_a": a,
        "team_b": b,
        "composite_a": ca,
        "composite_b": cb,
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
    # Knockout matches cannot end in a draw — the prediction is always the side
    # FAVOURED TO ADVANCE (higher advance_pct), and the headline confidence is
    # that side's to-advance probability. (Group rows use "draw_likely"; a
    # knockout never can, so we never emit it here.)
    if adv_a >= adv_b:
        row["predicted_winner"] = a
        row["win_confidence_pct"] = round(adv_a * 100, 1)
    else:
        row["predicted_winner"] = b
        row["win_confidence_pct"] = round(adv_b * 100, 1)
    row["upset_risk"] = upset_risk(a, b, gap)
    # The faithful J5L composite probs — mirrors the group row's
    # j5l_probabilities field so the UI can show the model split (and the
    # backtest keeps a true-J5L record even now that the headline is the stack).
    row["j5l_probabilities"] = {
        "team_a_wins": round(j5l_pa * 100, 1),
        "draw": round(j5l_pd * 100, 1),
        "team_b_wins": round(j5l_pb * 100, 1),
    }
    row["hybrid_gap"] = round(abs(gap), 3)
    row["prob_source"] = prob_source
    # knockout-only fields
    row["advance_pct_a"] = round(adv_a * 100, 1)
    row["advance_pct_b"] = round(adv_b * 100, 1)
    row["is_knockout"] = True
    row["stage"] = m.get("stage")
    row["match_id"] = m.get("match_id") or f"{a}__vs__{b}"
    row["kickoff_utc"] = m.get("kickoff_utc")
    return row


def main() -> int:
    schedule = load_json("schedule_full.json") or []
    teams = load_json("teams.json") or {}
    meta = load_json("meta.json") or {}
    pg = meta.get("poisson_group") or {}
    mu = pg.get("mu", 0.30)
    beta = pg.get("beta", 0.125)
    # R21: learned stack strengths drive the headline probs (see build_row).
    stack_strengths = (load_json("stacker.json") or {}).get("strengths") or None

    rows = []
    skipped = 0
    for m in schedule:
        if m.get("stage") not in KNOCKOUT_STAGES:
            continue
        row = build_row(m, teams, mu, beta, stack_strengths)
        if row is None:
            skipped += 1
            continue
        rows.append(row)

    save_json("knockout_matchups.json", rows)
    log(f"knockout matchups: wrote {len(rows)} row(s) ({skipped} placeholder/unresolved skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
