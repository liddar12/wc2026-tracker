#!/usr/bin/env python3
"""PROTOTYPE — shared metrics + honest evaluators (walk-forward / LOO)."""
from __future__ import annotations

import math
import numpy as np

EPS = 1e-12


def clip(p):
    return float(min(1 - EPS, max(EPS, p)))


def metrics(probs, y):
    """probs: (n,3) rows sum~1; y: (n,) in {0,1,2}. Returns acc/brier/logloss."""
    probs = np.asarray(probs, float)
    y = np.asarray(y, int)
    n = len(y)
    if n == 0:
        return {"n": 0, "acc": None, "brier": None, "logloss": None}
    pred = probs.argmax(1)
    acc = float((pred == y).mean())
    onehot = np.zeros((n, 3))
    onehot[np.arange(n), y] = 1.0
    brier = float(((probs - onehot) ** 2).sum(1).mean())
    ll = float(np.mean([-math.log(clip(probs[i, y[i]])) for i in range(n)]))
    return {"n": n, "acc": round(acc, 4), "brier": round(brier, 4), "logloss": round(ll, 4)}


def split_metrics(probs, y, tiers):
    """Overall + knockout-only metrics (KO = tier != 'group_stage')."""
    probs = np.asarray(probs, float)
    y = np.asarray(y, int)
    ko = np.array([t != "group_stage" for t in tiers])
    out = {"all": metrics(probs, y)}
    if ko.any():
        out["knockout"] = metrics(probs[ko], y[ko])
    if (~ko).any():
        out["group"] = metrics(probs[~ko], y[~ko])
    return out


def expanding_window(X, y, fit_predict, burn_in=30):
    """One-step-ahead expanding-window OOF predictions. X time-ordered.
    fit_predict(Xtr,ytr,Xte)->(m,3) probs. Returns (oof_probs[burn_in:], idx)."""
    n = len(y)
    oof = []
    idx = []
    for i in range(burn_in, n):
        p = fit_predict(X[:i], y[:i], X[i:i + 1])
        oof.append(p[0])
        idx.append(i)
    return np.array(oof, float), np.array(idx, int)


def leave_one_out(X, y, fit_predict):
    """LOO OOF predictions (for the small locked-preds stacker set)."""
    n = len(y)
    oof = np.zeros((n, 3))
    for i in range(n):
        tr = [j for j in range(n) if j != i]
        oof[i] = fit_predict(X[np.array(tr)], y[np.array(tr)], X[i:i + 1])[0]
    return oof
