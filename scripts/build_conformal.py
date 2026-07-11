#!/usr/bin/env python3
"""Build data/conformal.json — split-conformal calibration for the default
model's ("J5L AI Enhanced") match predictions.

Conformal prediction turns point predictions into PREDICTION SETS with a
coverage target: at level 1-alpha (default 85%), the set of outcomes {A win,
draw, B win} whose predicted probability clears a data-driven threshold
contains the true outcome ~85% of the time. It never changes a pick — it is an
honesty layer over the same probabilities.

Calibration set: every SCORED pre-kickoff stack prediction in
data/live-backtest.json (grows automatically as matches finish). The
nonconformity score for match i is s_i = 1 - p_i(actual outcome); qhat is the
ceil((n+1)(1-alpha))/n empirical quantile of the scores (the split-conformal
finite-sample correction). A new match's prediction set is every outcome with
p >= 1 - qhat (the top pick is always included, so a set is never empty).

Writes only on a real change (anti-churn, same rule as tune_inplay). Exits 0 on
any error leaving conformal.json untouched.
Run:  python3 scripts/build_conformal.py   (after snapshot_backtest in the cron)
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "conformal.json"
LEVELS = (0.85, 0.70)          # shipped display level first; 70% as a sharper alt
MODEL = "stack"                # the app default ("J5L AI Enhanced")
OUTCOMES = ["team_a_wins", "draw", "team_b_wins"]
MIN_N = 25                     # below this a quantile is too noisy to publish


def log(m):
    print(f"[conformal] {m}", file=sys.stderr, flush=True)


def calibration_scores():
    lb = json.loads((DATA / "live-backtest.json").read_text())
    scores = []
    for v in (lb.get("matches") or {}).values():
        act = v.get("actual")
        p = (v.get("preds") or {}).get(MODEL)
        if act not in OUTCOMES or not p or len(p) != 3:
            continue
        scores.append(1.0 - float(p[OUTCOMES.index(act)]))
    return sorted(scores)


def qhat_for(scores, alpha):
    """Split-conformal quantile with the (n+1) finite-sample correction."""
    n = len(scores)
    k = math.ceil((n + 1) * (1 - alpha))
    if k > n:
        return 1.0   # not enough data to bound — the set becomes everything
    return round(scores[k - 1], 4)


def set_for(p, qhat):
    thr = 1.0 - qhat
    s = [i for i in range(3) if p[i] >= thr]
    return s or [max(range(3), key=lambda i: p[i])]


def coverage_and_size(qhat):
    """Empirical check of the fitted threshold on the calibration set itself
    (slightly optimistic vs the true out-of-sample guarantee; reported as-is
    with that caveat in the note)."""
    lb = json.loads((DATA / "live-backtest.json").read_text())
    hit = tot = size = 0
    for v in (lb.get("matches") or {}).values():
        act = v.get("actual")
        p = (v.get("preds") or {}).get(MODEL)
        if act not in OUTCOMES or not p or len(p) != 3:
            continue
        s = set_for([float(x) for x in p], qhat)
        tot += 1
        size += len(s)
        if OUTCOMES.index(act) in s:
            hit += 1
    if not tot:
        return None, None
    return round(hit / tot, 4), round(size / tot, 3)


def main() -> int:
    scores = calibration_scores()
    n = len(scores)
    if n < MIN_N:
        log(f"only {n} calibration matches (<{MIN_N}); leaving conformal.json untouched")
        return 0

    levels = {}
    for lv in LEVELS:
        q = qhat_for(scores, 1 - lv)
        cov, avg = coverage_and_size(q)
        levels[str(lv)] = {"qhat": q, "threshold": round(1 - q, 4),
                           "empirical_coverage": cov, "avg_set_size": avg}

    out = {
        "model": MODEL,
        "levels": levels,
        "display_level": str(LEVELS[0]),
        "n_calibration": n,
        "note": "Split-conformal over scored pre-kickoff stack predictions. A match's "
                "'safe set' = outcomes with p >= threshold (top pick always included). "
                "Coverage is checked on the calibration set itself (mildly optimistic); "
                "the finite-sample (n+1) correction backs the out-of-sample target.",
    }
    # anti-churn: write only on a real change (timestamp excluded from compare)
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text())
            prev.pop("updated_at", None)
            if prev == out:
                log(f"no change (n={n}); leaving file untouched")
                return 0
        except Exception:  # noqa: BLE001
            pass
    out["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=True, indent=2) + "\n")
    tmp.replace(OUT)
    d = levels[str(LEVELS[0])]
    log(f"n={n} · {int(LEVELS[0]*100)}% level: threshold {d['threshold']} · "
        f"coverage {d['empirical_coverage']} · avg set size {d['avg_set_size']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving conformal.json untouched")
        raise SystemExit(0)
