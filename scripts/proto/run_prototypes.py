#!/usr/bin/env python3
"""PROTOTYPE — Prototype A (extended composite) + Prototype B (GBM match model),
honestly cross-validated on the 2026 matches played, with a knockout split.

A: does adding the backfilled talent + coach sub-ratings to the J5L composite
   improve match prediction vs the current 5-feature composite? Weights are
   re-fit (log-loss, simplex via softmax) INSIDE each CV train fold — never on
   the test fold — so the comparison is leak-safe.
B: can a gradient-boosted classifier on the a-minus-b feature diffs beat the
   composite+Poisson form entirely?

Evaluation: sklearn TimeSeriesSplit(5) over chronologically-ordered played
matches (group + knockout). Out-of-fold probabilities are pooled and scored
overall AND on knockout-only rows (the user's dual target: ranking + KO match
outcomes). Baseline = J5L with CURRENT production weights (no re-fit).

Run:  python3 scripts/proto/run_prototypes.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from sklearn.model_selection import TimeSeriesSplit
from sklearn.ensemble import HistGradientBoostingClassifier

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import proto_common as pc  # noqa: E402
import eval_lib as ev  # noqa: E402

ROOT = HERE.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "prototype_report.json"

# feature indices in pc.FEATURES
IDX = {name: i for i, name in enumerate(pc.FEATURES)}
FIVE = ["mine", "elo_scaled", "tmv_scaled", "qual_scaled", "form_scaled"]
SEVEN = FIVE + ["talent_scaled", "coach_scaled"]


def win_probs(gap, mu, beta):
    sup = beta * gap
    la, lb = math.exp(mu + sup / 2), math.exp(mu - sup / 2)
    pa = [math.exp(k * math.log(la) - la - math.lgamma(k + 1)) for k in range(11)]
    pb = [math.exp(k * math.log(lb) - lb - math.lgamma(k + 1)) for k in range(11)]
    h = d = a = 0.0
    for i in range(11):
        for j in range(11):
            p = pa[i] * pb[j]
            if i > j: h += p
            elif i == j: d += p
            else: a += p
    t = h + d + a
    return [h / t, d / t, a / t]


def composite_probs(rows_idx, rows, w_named, mu, beta):
    """W/D/L per row using a named-weight composite over the given feature set."""
    out = []
    for i in rows_idx:
        r = rows[i]
        ca = sum(w_named[k] * r["fa"][IDX[k]] for k in w_named) + r["ba"]
        cb = sum(w_named[k] * r["fb"][IDX[k]] for k in w_named) + r["bb"]
        out.append(win_probs(ca - cb, mu, beta))
    return np.array(out)


def fit_weights(train_idx, rows, feats, mu, beta, w0=None):
    """Fit composite weights on train rows by min multiclass log-loss.
    Softmax parameterization keeps weights on the simplex (>=0, sum=1)."""
    k = len(feats)
    theta0 = np.zeros(k) if w0 is None else np.log(np.clip(w0, 1e-3, None))

    def unpack(theta):
        e = np.exp(theta - theta.max())
        w = e / e.sum()
        return {f: float(w[j]) for j, f in enumerate(feats)}

    def loss(theta):
        wn = unpack(theta)
        probs = composite_probs(train_idx, rows, wn, mu, beta)
        y = np.array([rows[i]["outcome"] for i in train_idx])
        ll = 0.0
        for p, yi in zip(probs, y):
            ll += -math.log(ev.clip(p[yi]))
        # light L2 on theta to avoid runaway scale
        return ll / len(y) + 1e-3 * float(theta @ theta)

    res = minimize(loss, theta0, method="Nelder-Mead",
                   options={"maxiter": 4000, "xatol": 1e-4, "fatol": 1e-6})
    return _softmax_named(res.x, feats)


def _softmax_named(theta, feats):
    e = np.exp(theta - np.max(theta))
    w = e / e.sum()
    return {f: float(w[j]) for j, f in enumerate(feats)}


def eval_timeseries(rows, n_splits=5, burn_frac=None):
    n = len(rows)
    y = np.array([r["outcome"] for r in rows])
    tiers = [r["tier"] for r in rows]
    X, _, _ = pc.diff_matrix(rows)

    meta = json.loads((DATA / "meta.json").read_text())
    mw = meta.get("model_weights", {})
    pg = meta.get("poisson_group") or {}
    mu, beta = pg.get("mu", 0.30), pg.get("beta", 0.125)
    cur_w5 = {k: mw.get(k, 0.0) for k in FIVE}
    # ensure current weights renormalize over the 5 used here
    s = sum(cur_w5.values()) or 1.0
    cur_w5 = {k: v / s for k, v in cur_w5.items()}

    tss = TimeSeriesSplit(n_splits=n_splits)
    oof = {"J5L_current": np.zeros((n, 3)), "A_5feat_tuned": np.zeros((n, 3)),
           "A_7feat_tuned": np.zeros((n, 3)), "B_gbm": np.zeros((n, 3))}
    mask = np.zeros(n, bool)

    for tr, te in tss.split(np.arange(n)):
        mask[te] = True
        # baseline: current production weights, no fit
        oof["J5L_current"][te] = composite_probs(te, rows, cur_w5, mu, beta)
        # A: refit 5-feature and 7-feature composites on train fold
        w5 = fit_weights(tr, rows, FIVE, mu, beta, w0=np.array([cur_w5[k] for k in FIVE]))
        oof["A_5feat_tuned"][te] = composite_probs(te, rows, w5, mu, beta)
        w7 = fit_weights(tr, rows, SEVEN, mu, beta,
                         w0=np.array([w5.get(k, 0.05) for k in SEVEN]))
        oof["A_7feat_tuned"][te] = composite_probs(te, rows, w7, mu, beta)
        # B: GBM on diff features
        if len(set(y[tr].tolist())) == 3:
            clf = HistGradientBoostingClassifier(max_depth=3, max_iter=300,
                                                  learning_rate=0.04,
                                                  l2_regularization=2.0,
                                                  random_state=2026)
            clf.fit(X[tr], y[tr])
            p = clf.predict_proba(X[te])
            aligned = np.zeros((len(te), 3))
            for j, c in enumerate(clf.classes_):
                aligned[:, int(c)] = p[:, j]
            oof["B_gbm"][te] = aligned
        else:
            pri = np.bincount(y[tr], minlength=3) / len(tr)
            oof["B_gbm"][te] = np.repeat(pri[None, :], len(te), 0)

    idx = np.where(mask)[0]
    yy = y[idx]
    tt = [tiers[i] for i in idx]
    results = {}
    for name, probs in oof.items():
        results[name] = ev.split_metrics(probs[idx], yy, tt)

    # a final full-data weight fit (for display of learned weights)
    w5_full = fit_weights(np.arange(n), rows, FIVE, mu, beta,
                          w0=np.array([cur_w5[k] for k in FIVE]))
    w7_full = fit_weights(np.arange(n), rows, SEVEN, mu, beta,
                          w0=np.array([w5_full.get(k, 0.05) for k in SEVEN]))
    return results, {"current_5feat": cur_w5, "tuned_5feat": w5_full, "tuned_7feat": w7_full}, len(idx)


def main():
    rows = pc.build_rows(include_ko=True)
    print(f"[proto] {len(rows)} played matches (group+KO)", file=sys.stderr)
    results, weights, n_test = eval_timeseries(rows, n_splits=5)

    report = {
        "n_matches_total": len(rows),
        "n_matches_evaluated_oof": n_test,
        "cv": "TimeSeriesSplit(5), out-of-fold pooled",
        "objective": "multiclass logloss; acc/brier reported; knockout split",
        "weights": {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in weights.items()},
        "results": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")

    def line(name, mm):
        g = mm.get("all", {})
        ko = mm.get("knockout", {})
        return (f"{name:16s} | ALL n={g.get('n')} acc={g.get('acc')} brier={g.get('brier')} ll={g.get('logloss')}"
                f"  | KO n={ko.get('n')} acc={ko.get('acc')} ll={ko.get('logloss')}")
    print("\n=== Prototype A/B — out-of-fold (leak-safe) ===")
    for name in ("J5L_current", "A_5feat_tuned", "A_7feat_tuned", "B_gbm"):
        print(line(name, results[name]))
    print("\nTuned 7-feat weights:", {k: round(v, 3) for k, v in weights["tuned_7feat"].items()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
