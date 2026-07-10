#!/usr/bin/env python3
"""PROTOTYPE — validate the in-play win-probability engine (the R18 Poisson core
in app/lib/win-prob.js) by replaying every played 2026 match minute-by-minute from
its real goal/red-card timeline and scoring the live probabilities against the
final regulation result.

Mirrors the JS math exactly (remaining-time Poisson race, red-card multipliers;
no SoT tilt here — historical timelines carry no timestamped shots, so what is
validated is the score/time/red backbone). Pre-match rates come from the stack
strengths gap via exp(mu ± beta·gap/2), beta=0.70 on z-strengths — the same form
the forecast engine simulates with. (alpha in stacker.json was fit including
these matches; that one scalar's leakage is negligible for validating the
UPDATE mechanics, which is what this measures.)

Output: per-checkpoint Brier (live vs frozen-pre-match), data/proto/
inplay_validation.json. Run:  python3 scripts/proto/validate_inplay.py
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "inplay_validation.json"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
MAXG, REG = 10, 90
RED_OWN, RED_OPP = 0.65, 1.25
MU, BETA = 0.30, 0.70
CHECKPOINTS = [0, 15, 30, 45, 60, 75, 85]


def pois(k, lam):
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1))


def live_prob(la0, lb0, minute, sa, sb, red_a, red_b):
    frac = max(0.0, (REG - minute) / REG)
    la, lb = la0 * frac, lb0 * frac
    if red_a > red_b:
        la *= RED_OWN; lb *= RED_OPP
    elif red_b > red_a:
        lb *= RED_OWN; la *= RED_OPP
    a = d = b = 0.0
    for i in range(MAXG + 1):
        pi = pois(i, la)
        for j in range(MAXG + 1):
            p = pi * pois(j, lb)
            fa, fb = sa + i, sb + j
            if fa > fb: a += p
            elif fa == fb: d += p
            else: b += p
    t = a + d + b or 1.0
    return a / t, d / t, b / t


def minute_of(m):
    x = re.match(r"(\d+)", str(m or ""))
    return int(x.group(1)) if x else None


def main():
    stacker = json.loads((DATA / "stacker.json").read_text())
    S = stacker["strengths"]
    events = json.loads((DATA / "match_events.json").read_text())
    results = json.loads((DATA / "actual_results.json").read_text())

    def final_reg(key):
        """Regulation outcome. A match that reached ET/pens ended REGULATION
        level, so its outcome here is a draw (the stored score includes ET
        goals — using it raw would mislabel those matches)."""
        a, b = key.split("__vs__", 1)
        for tier in results.values():
            if not isinstance(tier, dict):
                continue
            r = tier.get(key) or tier.get(f"{b}__vs__{a}")
            if r and r.get("status") in FINAL and isinstance(r.get("score_a"), (int, float)):
                if r["status"] in ("STATUS_FINAL_AET", "STATUS_FINAL_PEN"):
                    return 1, 1  # any level score → draw label
                flip = key not in tier
                sa, sb = (r["score_b"], r["score_a"]) if flip else (r["score_a"], r["score_b"])
                return sa, sb
        return None

    briers = {cp: {"live": [], "static": []} for cp in CHECKPOINTS}
    n_matches = 0
    for key, rec in events.items():
        if key == "__meta__":
            continue
        a, b = key.split("__vs__", 1)
        if a not in S or b not in S:
            continue
        fin = final_reg(key)
        if not fin:
            continue
        sa_f, sb_f = fin
        outcome = 0 if sa_f > sb_f else 1 if sa_f == sb_f else 2

        sup = BETA * (S[a] - S[b])
        la0, lb0 = math.exp(MU + sup / 2), math.exp(MU - sup / 2)
        static = live_prob(la0, lb0, 0, 0, 0, 0, 0)

        # timeline of (minute, kind, side). The events feed's `team` is already
        # the BENEFITING team on own-goals (verified: no-flip reconstructs 94/94
        # regulation scores exactly; flipping breaks 15) — so no flip. Goals
        # past 90' are ET and excluded from regulation states.
        tl = []
        for e in rec.get("events") or []:
            mn = minute_of(e.get("minute"))
            if mn is None or e.get("team") not in (a, b):
                continue
            side = "a" if e.get("team") == a else "b"
            if e.get("type") in ("goal", "pen-goal", "own-goal") and mn <= 90:
                tl.append((mn, "goal", side))
            elif e.get("type") == "red" and mn <= 90:
                tl.append((mn, "red", side))
        tl.sort()

        n_matches += 1
        for cp in CHECKPOINTS:
            sa = sum(1 for mn, k, s in tl if k == "goal" and s == "a" and mn <= cp)
            sb = sum(1 for mn, k, s in tl if k == "goal" and s == "b" and mn <= cp)
            ra = sum(1 for mn, k, s in tl if k == "red" and s == "a" and mn <= cp)
            rb = sum(1 for mn, k, s in tl if k == "red" and s == "b" and mn <= cp)
            probs = live_prob(la0, lb0, cp, sa, sb, ra, rb)
            for name, p in (("live", probs), ("static", static)):
                onehot = [0.0, 0.0, 0.0]; onehot[outcome] = 1.0
                briers[cp][name].append(sum((pi - oi) ** 2 for pi, oi in zip(p, onehot)))

    report = {"n_matches": n_matches, "note": "score/time/red backbone; goals from real timelines",
              "checkpoints": {}}
    print(f"\n{'minute':>6s} {'live Brier':>11s} {'static Brier':>13s} {'improvement':>12s}")
    for cp in CHECKPOINTS:
        lv = sum(briers[cp]["live"]) / n_matches
        st = sum(briers[cp]["static"]) / n_matches
        report["checkpoints"][cp] = {"live_brier": round(lv, 4), "static_brier": round(st, 4)}
        print(f"{cp:>6d} {lv:>11.4f} {st:>13.4f} {100 * (st - lv) / st:>11.1f}%")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)} (n={n_matches})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
