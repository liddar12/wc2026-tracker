#!/usr/bin/env python3
"""Per-match backtest of the MARKET leg using Polymarket history on resolved tournaments.

This is the decision-relevant test for "would Polymarket improve the hybrid": the
hybrid predicts per-match W/D/L, and data/backtest.json scores per-match accuracy
(its "market"/"hybrid" rows are admitted estimates because Kalshi has no history).

For each resolved 3-way moneyline (home / Draw / away) we take the last
pre-resolution market price (de-vigged) and score it against the actual result.
Gives a real per-match accuracy / multiclass Brier / log-loss for the market —
something Kalshi cannot provide. Public Gamma+CLOB, no auth, read-only.
Writes data/polymarket-match-backtest.json.
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
UA = {"User-Agent": "wc26-tracker/1.0 (match-backtest)", "Accept": "application/json"}
MIN_INTERVAL = 0.2
EPS = 1e-6
PREKICK_CUT = 1800   # take the last price ≥30 min before kickoff (no outcome leakage)
WINDOW_DAYS = 21     # how far back to pull hourly history before kickoff

# {name, tag_id, prefix}. WC2022 omitted: those markets predate Polymarket's
# price-history retention (winner + matches return empty history).
TOURNAMENTS = [
    {"name": "Euro 2024", "tag": "100268", "prefix": "euro-2024-"},
    {"name": "Copa América 2024", "tag": "100278", "prefix": "copa-america-2024-"},
]

_last = 0.0


def log(msg: str) -> None:
    print(f"[pm-match] {msg}", file=sys.stderr, flush=True)


def get(url: str) -> Any:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                _last = time.monotonic()
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                log(f"  GET fail {url[:70]}…: {e}")
                return None
            time.sleep(1.0 + attempt)
    return None


def as_list(v: Any) -> list:
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa: BLE001
            return []
    return []


def parse_ts(s: Any) -> int | None:
    """Parse Polymarket timestamps (handles 'Z', '+00', space-separated) → epoch s."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip().replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    elif s.endswith("+00"):
        s = s[:-3] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return int(d.timestamp())
    except Exception:  # noqa: BLE001
        return None


def history_window(token: str, start_ts: int, end_ts: int) -> list:
    """Hourly history in [start, end]. fidelity=60 needs an explicit window for old
    markets (interval=max returns nothing hourly), so we always pass startTs/endTs."""
    h = get(f"{CLOB}/prices-history?market={token}&startTs={start_ts}&endTs={end_ts}&fidelity=60")
    return (h or {}).get("history") or []


def is_match_event(e: dict, prefix: str) -> bool:
    slug = e.get("slug") or ""
    if not slug.startswith(prefix) or "-vs-" not in slug:
        return False
    mkts = e.get("markets", [])
    if len(mkts) != 3:
        return False
    gits = [(m.get("groupItemTitle") or "").strip().lower() for m in mkts]
    return "draw" in gits


def score_match(e: dict) -> dict | None:
    mkts = e.get("markets", [])
    legs, kicks, creates = [], [], []
    for m in mkts:
        git = (m.get("groupItemTitle") or "").strip()
        toks = as_list(m.get("clobTokenIds"))
        op = as_list(m.get("outcomePrices"))
        if not git or not toks:
            return None
        legs.append({"label": git, "token": toks[0], "won": 1 if (op and str(op[0]) == "1") else 0})
        kicks.append(parse_ts(m.get("gameStartTime")))
        creates.append(parse_ts(m.get("createdAt")))
    if sum(l["won"] for l in legs) != 1:
        return None  # not cleanly resolved
    kickoff = next((k for k in kicks if k), None)
    if not kickoff:
        return None  # no kickoff timestamp — can't isolate a pre-match price
    start = min((c for c in creates if c), default=kickoff - WINDOW_DAYS * 86400)
    cut = kickoff - PREKICK_CUT  # last price strictly before kickoff

    raw = {}
    for l in legs:
        hist = history_window(l["token"], start, kickoff)
        cands = [pt["p"] for pt in hist if pt.get("t", 0) <= cut and pt.get("p") is not None]
        if not cands:
            return None  # no genuine pre-kickoff price
        raw[l["label"]] = float(cands[-1])
    tot = sum(raw.values())
    if tot <= 0:
        return None
    probs = {k: v / tot for k, v in raw.items()}  # de-vig

    pred = max(probs, key=probs.get)
    actual = next(l["label"] for l in legs if l["won"])
    correct = int(pred == actual)
    brier = sum((probs[l["label"]] - l["won"]) ** 2 for l in legs)  # multiclass Brier
    logloss = -math.log(min(max(probs[actual], EPS), 1 - EPS))
    return {
        "match": e.get("title", e.get("slug")),
        "probs": {k: round(v, 3) for k, v in probs.items()},
        "predicted": pred,
        "actual": actual,
        "correct": bool(correct),
        "brier": brier,
        "logloss": logloss,
    }


def score_tournament(t: dict) -> dict | None:
    log(f"{t['name']} (tag {t['tag']})")
    evs = get(f"{GAMMA}/events?tag_id={t['tag']}&closed=true&limit=500") or []
    matches = [e for e in evs if is_match_event(e, t["prefix"])]
    log(f"  {len(matches)} candidate match events")
    scored = [s for e in matches if (s := score_match(e))]
    if not scored:
        log("  none scored")
        return None
    n = len(scored)
    acc = sum(s["correct"] for s in scored) / n
    brier = sum(s["brier"] for s in scored) / n
    logloss = sum(s["logloss"] for s in scored) / n
    # outcome distribution + how often each result type occurred
    draws = sum(1 for s in scored if s["actual"].lower() == "draw")
    return {
        "tournament": t["name"],
        "matches_scored": n,
        "candidates": len(matches),
        "accuracy": round(acc, 4),
        "correct": f"{sum(s['correct'] for s in scored)}/{n}",
        "brier": round(brier, 5),
        "logloss": round(logloss, 5),
        "draw_rate_actual": round(draws / n, 3),
        "examples": scored[:4],
    }


def main() -> int:
    results = [r for t in TOURNAMENTS if (r := score_tournament(t))]
    if not results:
        log("nothing scored")
        return 1
    tot = sum(r["matches_scored"] for r in results)
    pooled_acc = sum(r["accuracy"] * r["matches_scored"] for r in results) / tot
    pooled_brier = sum(r["brier"] * r["matches_scored"] for r in results) / tot
    pooled_logloss = sum(r["logloss"] * r["matches_scored"] for r in results) / tot
    # baselines on a 3-way: uniform (1/3) and always-favorite is the market itself
    uniform_brier = 3 * (1 / 3) ** 2 - 2 * (1 / 3) + 1  # = 0.6667 per match (one-hot)
    uniform_logloss = -math.log(1 / 3)  # 1.0986

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "polymarket",
        "method": "De-vigged 3-way (home/draw/away) last pre-match daily price, scored vs result. Multiclass Brier + log-loss + argmax accuracy.",
        "matches_total": tot,
        "pooled_accuracy": round(pooled_acc, 4),
        "pooled_brier": round(pooled_brier, 5),
        "pooled_logloss": round(pooled_logloss, 5),
        "baseline_uniform_brier": round(uniform_brier, 5),
        "baseline_uniform_logloss": round(uniform_logloss, 5),
        "results": results,
    }
    (DATA_DIR / "polymarket-match-backtest.json").write_text(json.dumps(summary, indent=2) + "\n")

    print("\n" + "=" * 64)
    print("POLYMARKET PER-MATCH BACKTEST (market leg, 3-way moneyline)")
    print("=" * 64)
    for r in results:
        print(f"\n{r['tournament']}: {r['correct']} correct = {r['accuracy']*100:.1f}% "
              f"({r['matches_scored']}/{r['candidates']} matches had history)")
        print(f"  Brier {r['brier']}  ·  log-loss {r['logloss']}  ·  actual draw-rate {r['draw_rate_actual']}")
        for ex in r["examples"]:
            mark = "✓" if ex["correct"] else "✗"
            print(f"    {mark} {ex['match'][:38]:38} pred {ex['predicted']:>8} ({max(ex['probs'].values()):.2f})  actual {ex['actual']}")
    print("\n" + "-" * 64)
    print(f"POOLED: {tot} matches  ·  accuracy {pooled_acc*100:.1f}%  ·  "
          f"Brier {pooled_brier:.4f}  ·  log-loss {pooled_logloss:.4f}")
    print(f"  baselines (uniform 1/3): Brier {uniform_brier:.4f}, log-loss {uniform_logloss:.4f}")
    print(f"  → market beats uniform by {(uniform_logloss-pooled_logloss):.3f} nats log-loss")
    print(f"\n→ wrote {DATA_DIR / 'polymarket-match-backtest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
