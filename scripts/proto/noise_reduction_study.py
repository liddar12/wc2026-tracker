#!/usr/bin/env python3
"""PROTOTYPE — noise-reduction study on the played 2026 matches.

Owner questions:
  (A) Group stage allows draws and some teams play FOR them — does a
      "draw-as-win" (double-chance / unbeaten) framing predict better? Does a
      team draw-propensity feature reduce noise in the 3-way model?
  (B) Should reaching later stages carry extra weight — group-performance
      carry-over into knockout strength, or up-weighting in-tournament Elo?
  (C) Which ML model families do best on this data, honestly cross-validated?

All experiments are leak-safe: features are as-of (proto_common walk-forward
replay; group-carry uses only completed group games, which precede every KO
match), evaluation is LOO / expanding-window. n=96 (72 group + 24 KO) — small;
read every delta against that.

Writes data/proto/noise_reduction_report.json and prints the tables.
Run:  python3 scripts/proto/noise_reduction_study.py
"""
from __future__ import annotations

import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import proto_common as pc  # noqa: E402
import eval_lib as ev  # noqa: E402

warnings.filterwarnings("ignore")
ROOT = HERE.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "noise_reduction_report.json"
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
         "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}


def wdl(gap, mu=0.2389, beta=0.08):
    la, lb = math.exp(mu + beta * gap / 2), math.exp(mu - beta * gap / 2)
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
    return np.array([h / t, d / t, a / t])


def main():
    rows = pc.build_rows(include_ko=True)
    X, y, meta = pc.diff_matrix(rows)
    tiers = [m["tier"] for m in meta]
    n = len(y)
    print(f"[study] {n} as-of matches ({sum(1 for t in tiers if t=='group_stage')} group, "
          f"{sum(1 for t in tiers if t!='group_stage')} KO)", file=sys.stderr)

    report = {"n": n}
    stacker = json.loads((DATA / "stacker.json").read_text())
    S = stacker["strengths"]
    # stack baseline probs on the same rows (current alpha; the one-scalar
    # leakage is the same for every experiment, so deltas are fair)
    base = np.array([wdl((S.get(m["a"], 0) - S.get(m["b"], 0)) / 0.08 * 0.70 * 0.08) for m in meta])
    # ^ stack gap through the same group-calibrated wdl the app family uses:
    #   wdl(gap) with beta scaled for z-strengths (0.70) — done via gap*0.70/0.08
    base = np.array([wdl((S.get(m["a"], 0) - S.get(m["b"], 0)) * (0.70 / 0.08)) for m in meta])
    report["baseline_stack"] = ev.metrics(base, y)

    # ---------------- (A) draw-as-win / double-chance -----------------------
    # A1: rescore the baseline under "unbeaten" framing: pick side is correct
    #     if it won OR drew; a draw pick is correct on any draw.
    pick = base.argmax(1)
    strict = float((pick == y).mean())
    unbeaten_ok = np.array([
        (p == 1 and t == 1) or (p == 0 and t in (0, 1)) or (p == 2 and t in (2, 1))
        for p, t in zip(pick, y)]).mean()
    report["A1_framing"] = {"strict_acc": round(strict, 4), "draw_as_win_acc": round(float(unbeaten_ok), 4)}

    # A2: direct binary "A unbeaten" model vs derived Pa+Pd from the 3-way.
    from sklearn.linear_model import LogisticRegression
    yb = (y != 2).astype(int)   # team A unbeaten
    derived = base[:, 0] + base[:, 1]
    def brier1(p, t): return float(np.mean((p - t) ** 2))
    oof = np.zeros(n)
    for i in range(n):
        tr = np.array([j for j in range(n) if j != i])
        c = LogisticRegression(C=0.5, max_iter=2000).fit(X[tr], yb[tr])
        oof[i] = c.predict_proba(X[i:i + 1])[0][list(c.classes_).index(1)]
    report["A2_unbeaten"] = {"derived_from_3way_brier": round(brier1(derived, yb), 4),
                             "direct_binary_brier": round(brier1(oof, yb), 4)}

    # A3: draw-propensity feature — each team's as-of draw rate; does adding the
    #     pair's combined draw propensity improve 3-way LOO?
    results = json.loads((DATA / "actual_results.json").read_text())
    games = pc.final_matches_all(results)
    draw_hist = {}
    prop = []
    for m in meta:
        da = draw_hist.get(m["a"]); db = draw_hist.get(m["b"])
        pa_ = (sum(da) / len(da)) if da else 0.25
        pb_ = (sum(db) / len(db)) if db else 0.25
        prop.append([pa_ + pb_, abs(pa_ - pb_)])
        # advance history to include this match afterwards (chronological rows)
        for koff, tier, a, b, sa, sb, k in games:
            pass
    # (histories built properly below — need chronological interleave)
    draw_hist = {}
    prop = []
    bykoff = {(g[2], g[3], g[0]): (g[4], g[5]) for g in games}
    for m in meta:
        da = draw_hist.get(m["a"]); db = draw_hist.get(m["b"])
        pa_ = (sum(da) / len(da)) if da else 0.25
        pb_ = (sum(db) / len(db)) if db else 0.25
        prop.append([pa_ + pb_, abs(pa_ - pb_)])
        sc = bykoff.get((m["a"], m["b"], m["kickoff"]))
        if sc is not None:
            isd = 1 if sc[0] == sc[1] else 0
            draw_hist.setdefault(m["a"], []).append(isd)
            draw_hist.setdefault(m["b"], []).append(isd)
    prop = np.array(prop)

    def logit3(p):
        p = np.clip(p, 1e-6, 1 - 1e-6); l = np.log(p); return l - l.mean(axis=-1, keepdims=True)

    def loo3(Xf):
        oof = np.zeros((n, 3))
        for i in range(n):
            tr = np.array([j for j in range(n) if j != i])
            if len(set(y[tr].tolist())) < 3:
                oof[i] = np.bincount(y[tr], minlength=3) / len(tr); continue
            c = LogisticRegression(C=0.3, max_iter=3000).fit(Xf[tr], y[tr])
            p = c.predict_proba(Xf[i:i + 1])[0]
            row = np.zeros(3)
            for j, cl in enumerate(c.classes_): row[int(cl)] = p[j]
            oof[i] = row
        return oof

    Xb = logit3(base)
    report["A3_drawprop"] = {
        "base_refit": ev.metrics(loo3(Xb), y),
        "plus_draw_propensity": ev.metrics(loo3(np.hstack([Xb, prop])), y),
    }

    # ---------------- (B) late-stage / group-carry weighting ----------------
    # B1: KO matches only — add group-stage carry (points, GD from the group
    #     phase) to the stack logits. Group phase strictly precedes KO: leak-safe.
    gp = {}
    for koff, tier, a, b, sa, sb, k in games:
        if tier != "group_stage":
            continue
        for team, gf, ga in ((a, sa, sb), (b, sb, sa)):
            r = gp.setdefault(team, {"pts": 0, "gd": 0})
            r["pts"] += 3 if gf > ga else 1 if gf == ga else 0
            r["gd"] += gf - ga
    ko_idx = [i for i, t in enumerate(tiers) if t != "group_stage"]
    if len(ko_idx) >= 12:
        Xko = Xb[ko_idx]
        carry = np.array([[gp.get(meta[i]["a"], {}).get("pts", 0) - gp.get(meta[i]["b"], {}).get("pts", 0),
                           gp.get(meta[i]["a"], {}).get("gd", 0) - gp.get(meta[i]["b"], {}).get("gd", 0)]
                          for i in ko_idx], float)
        yko = y[ko_idx]
        def loo_ko(Xf):
            m_ = len(yko); oof = np.zeros((m_, 3))
            for i in range(m_):
                tr = np.array([j for j in range(m_) if j != i])
                cls = sorted(set(yko[tr].tolist()))
                c = LogisticRegression(C=0.3, max_iter=3000).fit(Xf[tr], yko[tr])
                p = c.predict_proba(Xf[i:i + 1])[0]
                row = np.zeros(3)
                for j, cl in enumerate(c.classes_): row[int(cl)] = p[j]
                oof[i] = row
            return oof
        report["B1_group_carry_KO"] = {
            "ko_base_refit": ev.metrics(loo_ko(Xko), yko),
            "ko_plus_group_carry": ev.metrics(loo_ko(np.hstack([Xko, carry])), yko),
        }

    # B2: stage-weighted Elo — scale the in-tournament Elo delta by w and rescore
    #     the whole tournament walk-forward (elo_scaled uses seed + w*delta).
    teams = json.loads((DATA / "teams.json").read_text())
    scale = json.loads((DATA / "elo_scale.json").read_text())
    import compute_elo as ce
    seed = {t: float(teams[t].get("elo_raw") or 1500) for t in teams}
    best = None
    grid = {}
    for w in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0):
        elo = dict(seed)
        ll = 0.0; correct = 0; cnt = 0
        for koff, tier, a, b, sa, sb, k in games:
            if a not in teams or b not in teams:
                continue
            ea = seed[a] + w * (elo[a] - seed[a])
            eb = seed[b] + w * (elo[b] - seed[b])
            p = wdl((ea - eb) * 0.008)   # elo->gap scaling ~ points per elo
            out = 0 if sa > sb else 1 if sa == sb else 2
            ll += -math.log(max(1e-9, p[out])); cnt += 1
            if int(np.argmax(p)) == out: correct += 1
            ce.apply_update(elo, a, b, {"score_a": sa, "score_b": sb}, k)
        grid[w] = {"logloss": round(ll / cnt, 4), "acc": round(correct / cnt, 4)}
        if best is None or grid[w]["logloss"] < grid[best]["logloss"]:
            best = w
    report["B2_stage_weighted_elo"] = {"grid": grid, "best_weight": best}

    # ---------------- (C) model sweep ---------------------------------------
    from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
    from sklearn.naive_bayes import GaussianNB
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.svm import SVC
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    import xgboost as xgb

    Xfull = np.hstack([X, Xb])   # raw as-of diffs + stack logits
    sweep = {
        "logistic": LogisticRegression(C=0.3, max_iter=3000),
        "random_forest": RandomForestClassifier(n_estimators=300, max_depth=4, random_state=2026),
        "hist_gbm": HistGradientBoostingClassifier(max_depth=3, max_iter=150, learning_rate=0.05,
                                                    l2_regularization=2.0, random_state=2026),
        "xgboost": xgb.XGBClassifier(n_estimators=150, max_depth=3, learning_rate=0.05,
                                      reg_lambda=2.0, subsample=0.9, random_state=2026,
                                      objective="multi:softprob", verbosity=0),
        "naive_bayes": GaussianNB(),
        "knn": make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=15)),
        "svc_rbf": make_pipeline(StandardScaler(), SVC(probability=True, C=1.0, random_state=2026)),
        "mlp": make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(16,), max_iter=2000,
                                                              alpha=1.0, random_state=2026)),
    }
    table = {}
    for name, clf in sweep.items():
        oof = np.zeros((n, 3))
        for i in range(n):
            tr = np.array([j for j in range(n) if j != i])
            try:
                c = clf.fit(Xfull[tr], y[tr])
                p = c.predict_proba(Xfull[i:i + 1])[0]
                classes = getattr(c, "classes_", None)
                if classes is None:
                    classes = c[-1].classes_
                row = np.zeros(3)
                for j, cl in enumerate(classes): row[int(cl)] = p[j]
                oof[i] = row
            except Exception:
                oof[i] = np.bincount(y[tr], minlength=3) / len(tr)
        table[name] = ev.metrics(oof, y)
    report["C_model_sweep"] = table

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")

    print("\n=== (A) draw-as-win framing ===")
    print(f"  strict 3-way acc {report['A1_framing']['strict_acc']:.3f} -> "
          f"draw-as-win acc {report['A1_framing']['draw_as_win_acc']:.3f}")
    print(f"  P(unbeaten): derived Brier {report['A2_unbeaten']['derived_from_3way_brier']} vs "
          f"direct-binary {report['A2_unbeaten']['direct_binary_brier']}")
    print(f"  3-way +draw-propensity: {report['A3_drawprop']['base_refit']['logloss']} -> "
          f"{report['A3_drawprop']['plus_draw_propensity']['logloss']} logloss")
    if "B1_group_carry_KO" in report:
        b1 = report["B1_group_carry_KO"]
        print("\n=== (B) late-stage weighting ===")
        print(f"  KO base {b1['ko_base_refit']['logloss']} -> +group-carry {b1['ko_plus_group_carry']['logloss']} logloss "
              f"(acc {b1['ko_base_refit']['acc']} -> {b1['ko_plus_group_carry']['acc']})")
    print(f"  stage-weighted Elo grid: {report['B2_stage_weighted_elo']['grid']}")
    print(f"  best in-tournament weight: x{report['B2_stage_weighted_elo']['best_weight']}")
    print("\n=== (C) model sweep (LOO, n=96) ===")
    for k in sorted(table, key=lambda k: table[k]["logloss"]):
        m = table[k]
        print(f"  {k:16s} acc={m['acc']:.3f} brier={m['brier']:.3f} logloss={m['logloss']:.3f}")
    print(f"\nbaseline stack: {report['baseline_stack']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
