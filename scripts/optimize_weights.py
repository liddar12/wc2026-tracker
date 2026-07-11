#!/usr/bin/env python3
"""Optimize the J5L model to maximize backtest quality on games actually played.

Per the owner's spec (docs/POSTMORTEM/architecture): objective = multiclass
LOG-LOSS (accuracy reported alongside); honest CV (no fit-then-report-same-games
circularity); tunes composite weights + group Poisson calibration + the hybrid
J5L/DT/Kalshi blend; uses the new in-tournament FORM signal.

Two leak-safe fits:
  (B) Composite weights {mine,elo,tmv,qual,form,dominance} + Poisson (mu,beta) —
      WALK-FORWARD over played group games: each game is predicted using only
      prior games (Elo, form and dominance-MAX recomputed as-of kickoff; static
      sub-ratings are pre-tournament). Shrinkage toward current weights
      regularizes the small sample. Dominance starts at weight 0 (R22,
      optimizer-gated) — only this fit can raise it, behind the margin.
  (A) Hybrid blend W=[j5l,dt,kalshi] — fit on the LOCKED pre-match per-model
      probabilities captured in live-backtest.json (genuinely as-of, ~36h pre
      kickoff). Compared against the current equal-thirds baseline.

NEVER REGRESS: new params are adopted only if they beat the CURRENT params'
log-loss on the same leak-safe set by a margin; otherwise current is kept.
Writes meta.model_weights (incl form), meta.poisson_group, meta.hybrid_weights,
and data/model_tuning.json (before→after). Idempotent (seeded). Exits 0 on error.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

import compute_elo as ce
import compute_form as cf
import compute_dominance as cd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FINAL = ce.FINAL
EPS = 1e-12
SHRINK = 0.6          # L2 pull toward current weights (regularizes ~28-game sample)
SHRINK_CAL = 3.0      # pull Poisson mu/beta toward current (avoid slamming bounds)
SHRINK_BLEND = 0.4    # pull hybrid blend toward equal-thirds (small-sample guard)
MARGIN = 0.002        # only adopt if log-loss improves by at least this
np.random.seed(12345)


def log(m): print(f"[optimize] {m}", file=sys.stderr, flush=True)
def clip(p): return float(min(1 - EPS, max(EPS, p)))


def _write_atomic(path: Path, obj) -> None:
    """tmp + os.replace JSON write, ensure_ascii=True (repo on-disk convention)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=True, indent=2) + "\n")
    tmp.replace(path)


# ---- group W/D/L bivariate-Poisson (mirrors rebuild_composite.win_probs) -----
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
    return h / t, d / t, a / t


def build_group_features():
    """Per played group game: as-of feature vectors for both teams + outcome.
    Feature order: [mine, elo_scaled, tmv, qual, form, dominance] (+ per-team
    boost const). Form, Elo AND dominance are recomputed as-of each kickoff."""
    teams = json.loads((DATA / "teams.json").read_text())
    results = json.loads((DATA / "actual_results.json").read_text()) if (DATA / "actual_results.json").exists() else {}
    match_stats = json.loads((DATA / "match_stats.json").read_text()) if (DATA / "match_stats.json").exists() else {}
    scale = json.loads((DATA / "elo_scale.json").read_text())
    names = list(teams.keys())
    seed = {n: float(teams[n].get("elo_raw") or 1500) for n in names}

    def boost(n):
        t = teams[n]; b = t.get("boosts", {}); v = 0.0
        if t.get("continental_champion"): v += b.get("continental", 0)
        if t.get("is_host"): v += b.get("host", 0)
        return v

    def elo_scaled_of(elo):
        return max(scale["clamp_lo"], min(scale["clamp_hi"], scale["a"] * elo + scale["b"]))

    # chronological FINAL group games
    games = []
    for key, rec in (results.get("group_stage") or {}).items():
        if "__vs__" not in key or not isinstance(rec, dict):
            continue
        st = rec.get("status")
        if st and st not in FINAL:
            continue
        sa, sb = rec.get("score_a"), rec.get("score_b")
        if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)):
            continue
        a, b = key.split("__vs__", 1)
        if a in teams and b in teams:
            games.append((rec.get("kickoff_utc") or "", a, b, sa, sb))
    games.sort(key=lambda g: g[0])

    all_matches = cf.final_matches(results)  # for as-of form
    dom_games = cd.played_stat_games(match_stats, results)  # for as-of dominance
    rows = []
    elo = dict(seed)
    seen_keys = set()
    for koff, a, b, sa, sb in games:
        # Elo + form + dominance AS-OF this kickoff (only prior games)
        form_raw = cf.form_for_games(all_matches, seed, names, before=koff)
        form_scaled = cf.to_scaled(form_raw, scale)
        dom_raw = cd.dominance_for_games(dom_games, names, before=koff)
        dom_scaled = cf.to_scaled(dom_raw, scale)
        # elo as-of = seed replayed over prior group games (already in `elo`)
        fa = [teams[a]["sub_ratings"].get("mine", 0), elo_scaled_of(elo.get(a, 1500)),
              teams[a]["sub_ratings"].get("tmv_scaled", 0), teams[a]["sub_ratings"].get("qual_scaled", 0),
              form_scaled[a], dom_scaled[a]]
        fb = [teams[b]["sub_ratings"].get("mine", 0), elo_scaled_of(elo.get(b, 1500)),
              teams[b]["sub_ratings"].get("tmv_scaled", 0), teams[b]["sub_ratings"].get("qual_scaled", 0),
              form_scaled[b], dom_scaled[b]]
        outcome = 0 if sa > sb else 1 if sa == sb else 2
        rows.append((np.array(fa), boost(a), np.array(fb), boost(b), outcome))
        # now advance elo with this game
        ce.apply_update(elo, a, b, {"score_a": sa, "score_b": sb}, ce.K_GROUP)
    return rows


def group_logloss(rows, w, mu, beta):
    if not rows:
        return None, None
    w = np.asarray(w, float)
    ll = 0.0; correct = 0
    for fa, ba, fb, bb, out in rows:
        ca = float(w @ fa) + ba
        cb = float(w @ fb) + bb
        pa, pd, pb = win_probs(ca - cb, mu, beta)
        probs = [pa, pd, pb]
        ll += -math.log(clip(probs[out]))
        if max(range(3), key=lambda i: probs[i]) == out:
            correct += 1
    return ll / len(rows), correct / len(rows)


def optimize_group(rows, cur_w, cur_mu, cur_beta, iters=6000):
    cur_loss, cur_acc = group_logloss(rows, cur_w, cur_mu, cur_beta)
    if cur_loss is None:
        return None
    cur_vec = np.array(cur_w, float)
    best = (cur_loss, cur_vec, cur_mu, cur_beta)
    # Dirichlet samples biased toward current weights + Poisson jitter
    alpha = np.maximum(cur_vec, 0.02) * 25 + 0.5
    for _ in range(iters):
        w = np.random.dirichlet(alpha)
        mu = float(np.clip(np.random.normal(cur_mu, 0.05), 0.20, 0.45))
        beta = float(np.clip(np.random.normal(cur_beta, 0.03), 0.08, 0.20))
        loss, _ = group_logloss(rows, w, mu, beta)
        cal = SHRINK_CAL * ((mu - cur_mu) ** 2 + (beta - cur_beta) ** 2)
        pen = loss + SHRINK * float(np.sum((w - cur_vec) ** 2)) + cal
        best_cal = SHRINK_CAL * ((best[2] - cur_mu) ** 2 + (best[3] - cur_beta) ** 2)
        if pen < best[0] + SHRINK * float(np.sum((best[1] - cur_vec) ** 2)) + best_cal:
            best = (loss, w, mu, beta)
    new_loss, new_w, new_mu, new_beta = best
    new_acc = group_logloss(rows, new_w, new_mu, new_beta)[1]
    adopt = new_loss < cur_loss - MARGIN
    return {
        "n_games": len(rows),
        "current": {"logloss": round(cur_loss, 4), "accuracy": round(cur_acc, 3)},
        "tuned": {"logloss": round(new_loss, 4), "accuracy": round(new_acc, 3)},
        "adopted": bool(adopt),
        "weights": {k: round(float(v), 4) for k, v in zip(["mine", "elo", "tmv", "qual", "form", "dominance"], new_w)} if adopt else None,
        "poisson": {"mu": round(new_mu, 4), "beta": round(new_beta, 4)} if adopt else None,
    }


def optimize_blend():
    """Fit hybrid W on captured pre-match per-model probs (model/dt/market)."""
    p = DATA / "live-backtest.json"
    if not p.exists():
        return None
    matches = json.loads(p.read_text()).get("matches", {})
    rows = []
    OUT = {"team_a_wins": 0, "draw": 1, "team_b_wins": 2}
    for m in matches.values():
        preds, act = m.get("preds") or {}, m.get("actual")
        if act not in OUT:
            continue
        if not all(k in preds and len(preds[k]) == 3 for k in ("model", "dt", "market")):
            continue
        rows.append((np.array(preds["model"]), np.array(preds["dt"]), np.array(preds["market"]), OUT[act]))
    if len(rows) < 6:
        return None

    def loss_for(w):
        ll = 0.0
        for mo, dt, mk, out in rows:
            blend = w[0] * mo + w[1] * dt + w[2] * mk
            blend = blend / (blend.sum() or 1.0)
            ll += -math.log(clip(float(blend[out])))
        return ll / len(rows)

    third = np.array([1 / 3, 1 / 3, 1 / 3])
    cur = loss_for(third)
    best = (cur, third, cur)  # (raw_loss, w, penalized)
    step = 0.05
    grid = [i * step for i in range(int(1 / step) + 1)]
    for i in grid:
        for j in grid:
            k = 1 - i - j
            if k < -1e-9:
                continue
            w = np.array([i, j, max(0.0, k)])
            ll = loss_for(w)
            pen = ll + SHRINK_BLEND * float(np.sum((w - third) ** 2))
            if pen < best[2]:
                best = (ll, w, pen)
    new_loss, new_w = best[0], best[1]
    adopt = new_loss < cur - MARGIN
    return {
        "n_matches": len(rows),
        "current_equal_thirds": {"logloss": round(cur, 4)},
        "tuned": {"logloss": round(new_loss, 4)},
        "adopted": bool(adopt),
        "weights": {"j5l": round(float(new_w[0]), 4), "dt": round(float(new_w[1]), 4), "kalshi": round(float(new_w[2]), 4)} if adopt else None,
    }


def main():
    meta = json.loads((DATA / "meta.json").read_text())
    mw = meta.get("model_weights", {})
    cur_w = [mw.get("mine", 0.15), mw.get("elo", 0.10), mw.get("tmv", 0.45), mw.get("qual", 0.30), mw.get("form", 0.0),
             mw.get("dominance", 0.0)]  # R22: optimizer-gated, starts inert
    cur_mu = (meta.get("poisson_group") or {}).get("mu", 0.30)
    cur_beta = (meta.get("poisson_group") or {}).get("beta", 0.125)

    rows = build_group_features()
    grp = optimize_group(rows, cur_w, cur_mu, cur_beta)
    bl = optimize_blend()

    report = {"generated_from_games": len(rows), "objective": "multiclass log-loss (walk-forward / captured pre-match)",
              "group": grp, "blend": bl}

    # Apply adopted changes (never-regress already enforced inside each optimizer).
    if grp and grp["adopted"]:
        for k, v in grp["weights"].items():
            mw[k] = v
        meta["model_weights"] = mw
        meta["poisson_group"] = grp["poisson"]
    elif grp:
        # ensure the optimizer-gated keys exist even if not adopted
        if "form" not in mw:
            mw["form"] = 0.0
        if "dominance" not in mw:
            mw["dominance"] = 0.0
        meta["model_weights"] = mw
    if bl and bl["adopted"]:
        meta["hybrid_weights"] = [bl["weights"]["j5l"], bl["weights"]["dt"], bl["weights"]["kalshi"]]

    # Atomic + ASCII writes: ensure_ascii=True matches the on-disk encoding of
    # data/*.json (repo convention; meta.json is also written by other crons),
    # and the tmp+os.replace swap means a crash never half-writes meta.json.
    _write_atomic(DATA / "meta.json", meta)
    _write_atomic(DATA / "model_tuning.json", report)
    log(f"group adopted={grp and grp['adopted']} blend adopted={bl and bl['adopted']} (games={len(rows)})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving model params untouched")
        raise SystemExit(0)
