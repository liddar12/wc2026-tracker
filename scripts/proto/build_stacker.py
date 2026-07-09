#!/usr/bin/env python3
"""PROTOTYPE (ship-ready) — fit the logistic stacker and export a portable
artifact the app/cron can consume.

This is the one measured ML win from the prototype sweep: a multinomial-logistic
blend of the J5L / DT / market W/D/L vectors beats the fixed hybrid on the played
2026 group matches (LOO log-loss 0.844 -> 0.821). build_stacker.py fits that model
on ALL locked pre-kickoff predictions and writes data/proto/stacker.json:

    { coef: [[...],[...],[...]], intercept: [...], feature_order: [...],
      classes: ["team_a_wins","draw","team_b_wins"], loo_metrics: {...}, ... }

The coefficients are small and stable, so the blend can be applied client-side in
the vanilla-JS app with a ~15-line pure function (see app/stack-model.js in the
prototype) — no Python at request time. WIRING TO PRODUCTION IS A GATE-4 STEP
(add as a model source + cron refresh + deploy) and is intentionally NOT done
here; this only produces the artifact + records honest LOO metrics.

Run:  python3 scripts/proto/build_stacker.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import eval_lib as ev  # noqa: E402
import stack_models as sm  # noqa: E402

DATA = HERE.parent.parent / "data"
OUT = DATA / "proto" / "stacker.json"
FEATURE_ORDER = [
    "j5l_a", "j5l_d", "j5l_b", "j5l_conf",
    "dt_a", "dt_d", "dt_b", "dt_conf",
    "market_a", "market_d", "market_b", "market_conf",
]


def main():
    rows = sm.load_locked()
    y = np.array([r[1] for r in rows])
    X = sm.feat_matrix(rows)

    # honest out-of-fold metrics (reuse the LOO evaluator from stack_models)
    def fit_lr(Xtr, ytr, Xte):
        if len(set(ytr.tolist())) < 3:
            pri = np.bincount(ytr, minlength=3) / len(ytr)
            return np.repeat(pri[None, :], len(Xte), 0)
        clf = LogisticRegression(C=0.5, max_iter=2000)
        clf.fit(Xtr, ytr)
        return sm._align(clf, Xte)

    loo = ev.leave_one_out(X, y, fit_lr)
    loo_metrics = ev.metrics(loo, y)

    # final fit on all data for the deployable coefficients
    clf = LogisticRegression(C=0.5, max_iter=4000)
    clf.fit(X, y)
    # reorder coef rows to canonical [a, d, b]
    coef = np.zeros((3, X.shape[1]))
    inter = np.zeros(3)
    for j, c in enumerate(clf.classes_):
        coef[int(c)] = clf.coef_[j]
        inter[int(c)] = clf.intercept_[j]

    baseline_thirds = ev.metrics(sm.avg_probs(rows, [1 / 3, 1 / 3, 1 / 3]), y)

    out = {
        "model": {
            "id": "stacker_logistic",
            "name": "Learned Stacker (J5L+DT+Market)",
            "method": "multinomial logistic over the three models' W/D/L vectors + "
                      "per-model favourite confidence",
            "note": "Ship-ready artifact. WIRING IS A GATE-4 STEP (model source + cron + deploy).",
        },
        "feature_order": FEATURE_ORDER,
        "classes": sm.OUTCOMES,
        "coef": coef.tolist(),
        "intercept": inter.tolist(),
        "n_train": len(rows),
        "loo_metrics": loo_metrics,
        "baseline_equal_thirds_loo": baseline_thirds,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"[stacker] wrote {OUT.name}: n={len(rows)} "
          f"LOO logloss={loo_metrics['logloss']} (equal-thirds {baseline_thirds['logloss']})",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
