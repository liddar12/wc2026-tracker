#!/usr/bin/env python3
"""PROTOTYPE — the "AI context layer": adjust knockout-match probabilities with
signals the statistical model doesn't see, then backtest whether it helps.

Motivation (from the prototype findings): ML on the same Elo/TMV/form features the
composite already uses can't beat it. The one place a different KIND of signal
could help is the KNOCKOUT rounds, where single-match context — rest days,
travel, head-to-head history, injuries — matters most and isn't in the composite.

Two interchangeable backends behind one interface (`adjust(base_probs, ctx)`):
  * 'rule'  — deterministic logit nudge from context deltas (rest, travel, H2H).
              Runs anywhere, fully reproducible, and is what we BACKTEST here.
  * 'llm'   — Claude reads a compact context brief and returns a bounded nudge +
              rationale. Dormant unless ANTHROPIC_API_KEY is set (mirrors
              scripts/generate_previews.py); wired and ready for the cron.

Honest evaluation: LOO on the played knockout matches (n≈24). We compare the base
J5L probabilities against base+context, on log-loss / accuracy / Brier. Context
data is partial mid-tournament (injuries dark; fatigue ~73% populated), so expect
a small, possibly within-noise effect — reported as measured, not inflated.

Run:  python3 scripts/proto/context_adjust.py [--backend rule|llm]
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import proto_common as pc  # noqa: E402
import eval_lib as ev  # noqa: E402

ROOT = HERE.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "context_report.json"
IDX = {n: i for i, n in enumerate(pc.FEATURES)}
FIVE = ["mine", "elo_scaled", "tmv_scaled", "qual_scaled", "form_scaled"]


# ---- base J5L probabilities (current production composite) -------------------
def base_probs(rows, mu, beta, mw):
    w = {k: mw.get(k, 0.0) for k in FIVE}
    s = sum(w.values()) or 1.0
    w = {k: v / s for k, v in w.items()}
    out = []
    for r in rows:
        ca = sum(w[k] * r["fa"][IDX[k]] for k in FIVE) + r["ba"]
        cb = sum(w[k] * r["fb"][IDX[k]] for k in FIVE) + r["bb"]
        out.append(_win_probs(ca - cb, mu, beta))
    return np.array(out)


def _win_probs(gap, mu, beta):
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


# ---- context signals (not in the composite) ---------------------------------
def _lookup(d, a, b):
    return d.get(f"{a}__vs__{b}") or d.get(f"{b}__vs__{a}")


def _flipped(d, a, b):
    return d.get(f"{b}__vs__{a}") is not None and d.get(f"{a}__vs__{b}") is None


def _rest_days_asof(results):
    """{match_key(a,b,kickoff) -> (rest_a, rest_b)} — days since each side's
    PREVIOUS FINAL match, derived from the real kickoff chronology. This is the
    fatigue signal fatigue.json leaves dark for knockout fixtures; deriving it
    from actual_results gives full KO coverage and is leak-safe (only prior
    games)."""
    from datetime import datetime
    games = pc.final_matches_all(results)  # chronological (kickoff, tier, a, b, ...)
    last = {}
    rest = {}
    for koff, tier, a, b, sa, sb, k in games:
        try:
            dt = datetime.fromisoformat(koff.replace("Z", "+00:00"))
        except Exception:
            dt = None
        ra = (dt - last[a]).days if dt and a in last else None
        rb = (dt - last[b]).days if dt and b in last else None
        rest[(a, b, koff)] = (ra, rb)
        if dt:
            last[a] = dt; last[b] = dt
    return rest


def context_deltas(rows):
    """Per-row [rest_diff, travel_diff, h2h_diff] from team A's perspective.
    rest_diff  = A rest days - B (more rest = fresher; DERIVED from kickoff
                 chronology since fatigue.json is dark for knockout fixtures).
    travel_diff= B km_flown - A (from fatigue.json when present; else 0).
    h2h_diff   = A win-rate - B win-rate over shared history (draws = 0.5 each)."""
    results = json.loads((DATA / "actual_results.json").read_text()) if (DATA / "actual_results.json").exists() else {}
    fatigue = json.loads((DATA / "fatigue.json").read_text()) if (DATA / "fatigue.json").exists() else {}
    h2h = json.loads((DATA / "h2h.json").read_text()) if (DATA / "h2h.json").exists() else {}
    rest_map = _rest_days_asof(results)
    out = []
    cover = {"rest": 0, "travel": 0, "h2h": 0}
    for r in rows:
        a, b = r["a"], r["b"]
        rest = travel = h2hd = 0.0
        ra, rb = rest_map.get((a, b, r["kickoff"]), (None, None))
        if isinstance(ra, (int, float)) and isinstance(rb, (int, float)):
            rest = float(ra - rb); cover["rest"] += 1
        f = _lookup(fatigue, a, b)
        if f:
            fa, fb = (f.get("team_b"), f.get("team_a")) if _flipped(fatigue, a, b) else (f.get("team_a"), f.get("team_b"))
            ka, kb = (fa or {}).get("km_flown_to_this_venue"), (fb or {}).get("km_flown_to_this_venue")
            if isinstance(ka, (int, float)) and isinstance(kb, (int, float)):
                travel = float(kb - ka) / 1000.0; cover["travel"] += 1  # per 1000km
        hh = _lookup(h2h, a, b)
        if isinstance(hh, list) and hh:
            wa = sum(1 for m in hh if m.get("winner") == a) + 0.5 * sum(1 for m in hh if m.get("winner") == "draw")
            wb = sum(1 for m in hh if m.get("winner") == b) + 0.5 * sum(1 for m in hh if m.get("winner") == "draw")
            tot = wa + wb
            if tot:
                h2hd = (wa - wb) / tot; cover["h2h"] += 1
        out.append([rest, travel, h2hd])
    return np.array(out, float), cover


# ---- rule backend: fit a tiny, regularized logit nudge (LOO) -----------------
def _logit3(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p) - np.log(p).mean()


def loo_rule(base, ctx, y):
    """LOO: map [base 3-logits + context deltas] -> outcome with a strongly
    regularized multinomial logistic. Compares base vs base+context fairly."""
    from sklearn.linear_model import LogisticRegression
    Xb = np.array([_logit3(p) for p in base])
    Xfull = np.hstack([Xb, ctx])
    n = len(y)

    def loo(X):
        oof = np.zeros((n, 3))
        for i in range(n):
            tr = [j for j in range(n) if j != i]
            ytr = y[tr]
            if len(set(ytr.tolist())) < 3:
                pri = np.bincount(ytr, minlength=3) / len(ytr)
                oof[i] = pri
                continue
            clf = LogisticRegression(C=0.3, max_iter=3000)
            clf.fit(X[tr], ytr)
            p = clf.predict_proba(X[i:i + 1])[0]
            row = np.zeros(3)
            for j, c in enumerate(clf.classes_):
                row[int(c)] = p[j]
            oof[i] = row
        return oof

    return loo(Xb), loo(Xfull)


# ---- llm backend (dormant without a key) ------------------------------------
def llm_adjust(base, rows, ctx):
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        print("[context] ANTHROPIC_API_KEY unset — LLM backend dormant; use --backend rule", file=sys.stderr)
        return None
    try:
        import anthropic
    except Exception:
        print("[context] anthropic SDK missing — LLM backend dormant", file=sys.stderr)
        return None
    client = anthropic.Anthropic(api_key=key)
    out = []
    for p, r, c in zip(base, rows, ctx):
        brief = (f"{r['a']} vs {r['b']} (knockout). Model P(win/draw/loss for {r['a']}) "
                 f"= {p[0]:.2f}/{p[1]:.2f}/{p[2]:.2f}. Context deltas (A-favouring): "
                 f"rest_days={c[0]:+.0f}, travel_advantage(1000km)={c[1]:+.1f}, h2h_edge={c[2]:+.2f}. "
                 "Return ONLY a JSON object {\"a\":x,\"d\":y,\"b\":z} of adjusted probabilities "
                 "summing to 1 — nudge modestly from the model, do not override it.")
        try:
            msg = client.messages.create(
                model="claude-sonnet-5", max_tokens=120,
                messages=[{"role": "user", "content": brief}])
            txt = msg.content[0].text
            j = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
            v = np.array([j["a"], j["d"], j["b"]], float)
            out.append(v / (v.sum() or 1.0))
        except Exception as e:  # noqa: BLE001
            print(f"[context] llm row failed ({e}); keeping base", file=sys.stderr)
            out.append(p)
    return np.array(out)


def main():
    backend = "rule"
    if "--backend" in sys.argv:
        backend = sys.argv[sys.argv.index("--backend") + 1]

    rows_all = pc.build_rows(include_ko=True)
    rows = [r for r in rows_all if r["tier"] != "group_stage"]  # knockout only
    y = np.array([r["outcome"] for r in rows])
    meta = json.loads((DATA / "meta.json").read_text())
    pg = meta.get("poisson_group") or {}
    base = base_probs(rows, pg.get("mu", 0.30), pg.get("beta", 0.125), meta.get("model_weights", {}))
    ctx, cover = context_deltas(rows)
    print(f"[context] {len(rows)} knockout matches; context coverage: {cover}", file=sys.stderr)

    report = {"n_knockout": len(rows), "context_coverage": cover, "backend": backend,
              "base": ev.metrics(base, y)}

    if backend == "llm":
        adj = llm_adjust(base, rows, ctx)
        if adj is None:
            report["status"] = "llm_dormant"
        else:
            report["adjusted"] = ev.metrics(adj, y)
    else:
        base_oof, full_oof = loo_rule(base, ctx, y)
        report["base_refit_loo"] = ev.metrics(base_oof, y)
        report["base_plus_context_loo"] = ev.metrics(full_oof, y)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")

    print("\n=== Knockout context layer (LOO) ===")
    for k in ("base", "base_refit_loo", "base_plus_context_loo", "adjusted"):
        if k in report:
            m = report[k]
            print(f"{k:24s} acc={m['acc']} brier={m['brier']} logloss={m['logloss']} (n={m['n']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
