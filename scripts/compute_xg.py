#!/usr/bin/env python3
"""Compute model xG per side for every group-stage match.

Formula (auditable):

  base_xg = 1.45                    # league-average goals per side per match
  gap = composite_a - composite_b   # composite is the model's [0..100] rating
  team_a_xg = base_xg + 0.045 * gap
  team_b_xg = base_xg - 0.045 * gap

  Then add a recent-form bump from data/form.json if available:
    let f = sum_of_results_points / 5 where W=3, D=1, L=0
    bump = (f - 7.5) * 0.04   # 7.5 is the neutral baseline (5 draws + 1 win)
    add bump to that side's xg

  Clamp each side to [0.2, 4.5] so we never produce silly numbers.

The result is conservative — it does NOT try to model who plays whom or
schedule. We only need a comparable per-team xG so the matchup-detail view
can show "Spain 1.8 xG vs Croatia 1.1 xG" alongside the existing composite
breakdown.

It also covers KNOCKOUT fixtures: schedule_full.json's resolved knockout rows
(stage != group, real team names) get the SAME per-side xG under a
"TeamA__vs__TeamB" key, so the matchup-detail view has xG for a R32+ game too.

Inputs:  data/teams.json, data/group_matchups.json, data/schedule_full.json,
         optionally data/form.json (treated as missing if empty)
Output:  data/xg.json keyed by match_id / "TeamA__vs__TeamB":
         { key: { team_a_xg, team_b_xg, formula_version } }

Pure stdlib. No network. Idempotent.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BASE_XG = 1.45
GAP_COEF = 0.045
FORM_NEUTRAL = 7.5
FORM_COEF = 0.04
XG_MIN = 0.2
XG_MAX = 4.5
FORMULA_VERSION = "v1"

KNOCKOUT_STAGES = {
    "round_of_32", "round_of_16", "quarterfinals",
    "semifinals", "third_place", "final",
}
# Bracket-slot placeholders ("1A","2B","3_ABCDF","W73","L101","RU-A"…) — these
# fixtures have no real teams yet, so skip them until resolve_knockouts fills in.
PLACEHOLDER_RE = re.compile(r"^\d[A-L]$|^[A-L]\d|^3[A-L/_]|^3 |^W\d|^L\d|^1[A-L]|^2[A-L]|^RU", re.I)


def is_placeholder(name) -> bool:
    return not name or bool(PLACEHOLDER_RE.match(str(name).strip()))


def load(name: str):
    p = DATA_DIR / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save(name: str, data) -> None:
    (DATA_DIR / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def form_points(form_entries) -> float | None:
    if not isinstance(form_entries, list) or not form_entries:
        return None
    pts = 0
    n = 0
    for entry in form_entries[:5]:
        r = (entry or {}).get("result")
        if r == "W":
            pts += 3
        elif r == "D":
            pts += 1
        elif r == "L":
            pts += 0
        else:
            continue
        n += 1
    if n == 0:
        return None
    return pts


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def side_xg(a: str, b: str, comp_a: float, comp_b: float, form: dict) -> dict:
    """Per-side xG row for teams a/b given their composites. Shared by the group
    and knockout loops so both use the identical formula (gap + recent form)."""
    gap = (comp_a or 0) - (comp_b or 0)
    xa = BASE_XG + GAP_COEF * gap
    xb = BASE_XG - GAP_COEF * gap
    fa = form_points(form.get(a))
    fb = form_points(form.get(b))
    if fa is not None:
        xa += (fa - FORM_NEUTRAL) * FORM_COEF
    if fb is not None:
        xb += (fb - FORM_NEUTRAL) * FORM_COEF
    return {
        "team_a": a,
        "team_b": b,
        "team_a_xg": round(clamp(xa, XG_MIN, XG_MAX), 2),
        "team_b_xg": round(clamp(xb, XG_MIN, XG_MAX), 2),
        "formula_version": FORMULA_VERSION,
        "used_form_a": fa is not None,
        "used_form_b": fb is not None,
    }


def main() -> int:
    gm = load("group_matchups.json") or {}
    form = load("form.json") or {}
    schedule = load("schedule_full.json") or []
    teams = load("teams.json") or {}

    out: dict[str, dict] = {}
    for group, info in gm.items():
        for m in info.get("matches", []):
            a = m["team_a"]
            b = m["team_b"]
            mid = m.get("match_id") or f"{a}__vs__{b}"
            out[mid] = side_xg(a, b, m.get("composite_a"), m.get("composite_b"), form)

    # Knockout fixtures: schedule_full's resolved (real-name) knockout rows get
    # a "TeamA__vs__TeamB" key, same format as the group keys. Composites come
    # from teams.json (the knockout schedule row carries no composite).
    knockout = 0
    for m in schedule:
        if m.get("stage") not in KNOCKOUT_STAGES:
            continue
        a = m.get("team_a")
        b = m.get("team_b")
        if is_placeholder(a) or is_placeholder(b):
            continue
        ta = teams.get(a)
        tb = teams.get(b)
        if not ta or not tb:
            continue
        key = f"{a}__vs__{b}"
        if key in out:  # already covered (shouldn't collide with group keys)
            continue
        out[key] = side_xg(a, b, ta.get("composite"), tb.get("composite"), form)
        knockout += 1

    out["__meta__"] = {
        "formula_version": FORMULA_VERSION,
        "base_xg": BASE_XG,
        "gap_coef": GAP_COEF,
        "form_neutral": FORM_NEUTRAL,
        "form_coef": FORM_COEF,
        "clamp": [XG_MIN, XG_MAX],
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    save("xg.json", out)
    print(f"compute_xg: wrote xg.json with {len(out) - 1} matches ({knockout} knockout)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
