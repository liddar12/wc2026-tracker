#!/usr/bin/env python3
"""PROTOTYPE — combine DT + J5L (+ market) with ML (the "AI blend").

The production hybrid is a fixed weighted average of the three models' W/D/L
vectors (equal-thirds by default; grid-tuned in optimize_weights). This asks: can
a LEARNED stacker beat that on the 2026 matches actually played?

Data: data/live-backtest.json — the LOCKED pre-kickoff W/D/L vectors for each
model (model=J5L, dt, market) + the realized outcome. Genuinely as-of, so LOO on
it is honest. We compare, LOO:
  * equal-thirds average            (current default)
  * current meta.hybrid_weights     (grid-tuned average)
  * multinomial logistic stacker    (learned; L2-regularized)
  * gradient-boosted stacker        (HistGradientBoosting; non-linear)
Features for the learned stackers: the three models' 9 probabilities +
per-model favourite-confidence, so the stacker can learn WHEN to trust each.

Run:  python3 scripts/proto/stack_models.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval_lib as ev  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "stacker_report.json"
MODELS = ("model", "dt", "market")
OUTCOMES = ["team_a_wins", "draw", "team_b_wins"]


def load_locked():
    d = json.loads((DATA / "live-backtest.json").read_text())
    rows = []
    for m in d.get("matches", {}).values():
        preds, act = m.get("preds") or {}, m.get("actual")
        if act not in OUTCOMES:
            continue
        if not all(k in preds and len(preds[k]) == 3 for k in MODELS):
            continue
        rows.append((preds, OUTCOMES.index(act), m.get("stage", "group")))
    return rows


def avg_probs(rows, w):
    w = np.asarray(w, float)
    out = []
    for preds, _, _ in rows:
        p = w[0] * np.array(preds["model"]) + w[1] * np.array(preds["dt"]) + w[2] * np.array(preds["market"])
        s = p.sum() or 1.0
        out.append(p / s)
    return np.array(out)


def feat_matrix(rows):
    X = []
    for preds, _, _ in rows:
        row = []
        for k in MODELS:
            v = np.array(preds[k], float)
            row += v.tolist()
            row.append(float(v.max()))   # favourite confidence
        X.append(row)
    return np.array(X, float)


def main():
    rows = load_locked()
    y = np.array([r[1] for r in rows])
    tiers = ["group_stage" if r[2] == "group" else r[2] for r in rows]
    print(f"[stack] {len(rows)} locked-prediction matches", file=sys.stderr)

    meta = json.loads((DATA / "meta.json").read_text())
    hw = meta.get("hybrid_weights") or [1 / 3, 1 / 3, 1 / 3]

    report = {"n_matches": len(rows), "objective": "multiclass logloss (LOO on locked pre-kickoff preds)",
              "results": {}}

    # fixed-weight baselines (no fitting -> evaluate directly)
    for name, w in (("equal_thirds", [1 / 3, 1 / 3, 1 / 3]),
                    ("current_hybrid_weights", hw)):
        report["results"][name] = ev.metrics(avg_probs(rows, w), y)

    # individual models for reference
    for k in MODELS:
        p = np.array([np.array(r[0][k]) for r in rows])
        report["results"][f"solo_{k}"] = ev.metrics(p, y)

    # learned stackers — LOO
    X = feat_matrix(rows)

    def fit_lr(Xtr, ytr, Xte):
        # guard: LOO fold might miss a class; fall back to prior if so
        if len(set(ytr.tolist())) < 3:
            pri = np.bincount(ytr, minlength=3) / len(ytr)
            return np.repeat(pri[None, :], len(Xte), 0)
        clf = LogisticRegression(C=0.5, max_iter=2000)
        clf.fit(Xtr, ytr)
        return _align(clf, Xte)

    def fit_gbm(Xtr, ytr, Xte):
        if len(set(ytr.tolist())) < 3:
            pri = np.bincount(ytr, minlength=3) / len(ytr)
            return np.repeat(pri[None, :], len(Xte), 0)
        clf = HistGradientBoostingClassifier(max_depth=3, max_iter=200,
                                              learning_rate=0.05, l2_regularization=1.0,
                                              random_state=2026)
        clf.fit(Xtr, ytr)
        return _align(clf, Xte)

    report["results"]["stacker_logistic"] = ev.metrics(ev.leave_one_out(X, y, fit_lr), y)
    report["results"]["stacker_gbm"] = ev.metrics(ev.leave_one_out(X, y, fit_gbm), y)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")

    # pretty print, sorted by logloss
    order = sorted(report["results"].items(), key=lambda kv: (kv[1]["logloss"] if kv[1]["logloss"] is not None else 9))
    print(f"\n{'model':26s} {'acc':>6s} {'brier':>7s} {'logloss':>8s}")
    for name, mm in order:
        print(f"{name:26s} {mm['acc']:>6.3f} {mm['brier']:>7.3f} {mm['logloss']:>8.3f}")
    return 0


def _align(clf, Xte):
    """Map classifier proba to fixed [0,1,2] column order (classes_ may vary)."""
    p = clf.predict_proba(Xte)
    out = np.zeros((len(Xte), 3))
    for j, c in enumerate(clf.classes_):
        out[:, int(c)] = p[:, j]
    return out


if __name__ == "__main__":
    raise SystemExit(main())
