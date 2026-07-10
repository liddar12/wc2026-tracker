#!/usr/bin/env python3
"""Self-learning loop for the IN-PLAY win-probability engine (R18).

Re-fits the in-play parameters — the red-card multipliers — from every played
match's real goal/red timeline, each cron run, and writes data/inplay_params.json
for the client (app/lib/win-prob.js configureInplay). This closes the "in-game
picks self-learn from this World Cup's data" loop the same way build_stacker
does for pre-game picks.

Method: replay each FINAL match minute-by-minute (goals + reds from
match_events.json, regulation outcome; AET/PEN = regulation draw) and score the
engine's checkpoint probabilities (15',30',45',60',75',85') by mean Brier over
matches that actually saw a red card — the only matches the parameters touch.
Grid-search (red_own, red_opp); NEVER-REGRESS: adopt only if the tuned pair
beats the CURRENT params by MARGIN on the same replay, else keep current.

The SoT tilt cap is NOT tuned here — historical timelines carry no timestamped
shots, so there is nothing to fit it against yet (the R18 live sampler is
accruing that data; revisit when it exists).

Idempotent; exits 0 on any error leaving inplay_params.json untouched.
Run:  python3 scripts/tune_inplay.py   (after scrape_match_events / results)
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "inplay_params.json"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}
MAXG, REG = 10, 90
MU, BETA = 0.30, 0.70
CHECKPOINTS = (15, 30, 45, 60, 75, 85)
DEFAULTS = {"red_own": 0.65, "red_opp": 1.25, "tilt_max": 0.25}
MARGIN = 0.002   # adopt only on a real improvement (mirrors optimize_weights)


def log(m):
    print(f"[inplay-tune] {m}", file=sys.stderr, flush=True)


def pois(k, lam):
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1))


def live_prob(la0, lb0, minute, sa, sb, ra, rb, red_own, red_opp):
    frac = max(0.0, (REG - minute) / REG)
    la, lb = la0 * frac, lb0 * frac
    if ra > rb:
        la *= red_own; lb *= red_opp
    elif rb > ra:
        lb *= red_own; la *= red_opp
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


def build_replays():
    """[(la0, lb0, timeline, outcome)] for FINAL matches WITH a red card —
    the only matches the red multipliers can influence."""
    stacker = json.loads((DATA / "stacker.json").read_text())
    S = stacker["strengths"]
    events = json.loads((DATA / "match_events.json").read_text())
    results = json.loads((DATA / "actual_results.json").read_text())

    def final_reg(key):
        a, b = key.split("__vs__", 1)
        for tier in results.values():
            if not isinstance(tier, dict):
                continue
            r = tier.get(key) or tier.get(f"{b}__vs__{a}")
            if r and r.get("status") in FINAL and isinstance(r.get("score_a"), (int, float)):
                if r["status"] in ("STATUS_FINAL_AET", "STATUS_FINAL_PEN"):
                    return 1, 1
                flip = key not in tier
                return (r["score_b"], r["score_a"]) if flip else (r["score_a"], r["score_b"])
        return None

    replays = []
    for key, rec in events.items():
        if key == "__meta__":
            continue
        a, b = key.split("__vs__", 1)
        if a not in S or b not in S:
            continue
        fin = final_reg(key)
        if not fin:
            continue
        tl = []
        has_red = False
        for e in rec.get("events") or []:
            mn = minute_of(e.get("minute"))
            if mn is None or mn > 90 or e.get("team") not in (a, b):
                continue
            side = "a" if e.get("team") == a else "b"
            t = e.get("type")
            if t in ("goal", "pen-goal", "own-goal"):
                tl.append((mn, "goal", side))
            elif t == "red":
                tl.append((mn, "red", side))
                has_red = True
        if not has_red:
            continue
        tl.sort()
        sup = BETA * (S[a] - S[b])
        la0, lb0 = math.exp(MU + sup / 2), math.exp(MU - sup / 2)
        outcome = 0 if fin[0] > fin[1] else 1 if fin[0] == fin[1] else 2
        replays.append((la0, lb0, tl, outcome))
    return replays


def brier_for(replays, red_own, red_opp):
    tot = 0.0
    cnt = 0
    for la0, lb0, tl, outcome in replays:
        for cp in CHECKPOINTS:
            sa = sum(1 for mn, k, s in tl if k == "goal" and s == "a" and mn <= cp)
            sb = sum(1 for mn, k, s in tl if k == "goal" and s == "b" and mn <= cp)
            ra = sum(1 for mn, k, s in tl if k == "red" and s == "a" and mn <= cp)
            rb = sum(1 for mn, k, s in tl if k == "red" and s == "b" and mn <= cp)
            if ra == rb:
                continue   # params inert at this checkpoint
            p = live_prob(la0, lb0, cp, sa, sb, ra, rb, red_own, red_opp)
            onehot = [0.0, 0.0, 0.0]; onehot[outcome] = 1.0
            tot += sum((pi - oi) ** 2 for pi, oi in zip(p, onehot))
            cnt += 1
    return (tot / cnt, cnt) if cnt else (None, 0)


def main() -> int:
    cur = DEFAULTS.copy()
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text())
            for k in ("red_own", "red_opp", "tilt_max"):
                if isinstance(prev.get(k), (int, float)):
                    cur[k] = float(prev[k])
        except Exception:  # noqa: BLE001
            pass

    replays = build_replays()
    cur_brier, n_pts = brier_for(replays, cur["red_own"], cur["red_opp"])
    if cur_brier is None:
        log(f"no red-card checkpoints yet ({len(replays)} matches); leaving params untouched")
        return 0

    best = (cur_brier, cur["red_own"], cur["red_opp"])
    for own10 in range(40, 96, 5):        # 0.40 .. 0.95
        for opp10 in range(100, 161, 5):  # 1.00 .. 1.60
            own, opp = own10 / 100, opp10 / 100
            br, _ = brier_for(replays, own, opp)
            if br is not None and br < best[0]:
                best = (br, own, opp)

    adopted = best[0] < cur_brier - MARGIN
    out = {
        "red_own": round(best[1] if adopted else cur["red_own"], 3),
        "red_opp": round(best[2] if adopted else cur["red_opp"], 3),
        "tilt_max": cur["tilt_max"],   # not tunable yet (no historical SoT timelines)
        "fit": {
            "n_red_matches": len(replays), "n_checkpoints": n_pts,
            "current_brier": round(cur_brier, 4), "tuned_brier": round(best[0], 4),
            "adopted": bool(adopted),
        },
        "note": "Self-tuned each cron from played goal/red timelines; never-regress "
                f"(margin {MARGIN}). Tilt cap static pending live SoT history (R18 sampler).",
    }
    # Write ONLY on a real change (updated_at excluded from the comparison) so a
    # no-op hourly run commits nothing — same anti-churn rule as the previews.
    if OUT.exists():
        try:
            prev_cmp = json.loads(OUT.read_text())
            prev_cmp.pop("updated_at", None)
            if prev_cmp == out:
                log(f"no change (red matches={len(replays)}, brier={cur_brier:.4f}); leaving file untouched")
                return 0
        except Exception:  # noqa: BLE001
            pass
    out["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=True, indent=2) + "\n")
    tmp.replace(OUT)
    log(f"red matches={len(replays)} pts={n_pts} current={cur_brier:.4f} "
        f"tuned={best[0]:.4f} (own={best[1]:.2f}, opp={best[2]:.2f}) adopted={adopted}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving inplay_params.json untouched")
        raise SystemExit(0)
