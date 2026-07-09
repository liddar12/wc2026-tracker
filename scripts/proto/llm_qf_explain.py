#!/usr/bin/env python3
"""PROTOTYPE — LLM projection EXPLANATIONS for the remaining quarterfinals.

This is the honest, high-value use of an LLM here (per the prototype findings):
not to change the probability numbers — the calibrated model already wins on
accuracy — but to EXPLAIN them and fold in context the numbers don't encode
(rest-day edge, and, when available, suspensions/news). Forward-looking, so there
is no ground truth to score; the value is a smarter, readable projection.

For each upcoming QF it builds a compact brief from:
  * base J5L win/draw/loss (composite gap -> bivariate-Poisson)
  * champion odds (forecast.json) for each side
  * derived rest-days edge (data/proto/ko_context.json)
and asks Claude for a 2-sentence "why favored + upset risk" note.

Dormant without ANTHROPIC_API_KEY (mirrors generate_previews.py). Cheap: Haiku,
~120 tokens/match, 4 matches. Writes data/proto/qf_explanations.json.

Run (needs the key in env / GitHub Actions secret):
    python3 scripts/proto/llm_qf_explain.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "qf_explanations.json"
MODEL = os.environ.get("WC26_PREVIEW_MODEL", "claude-haiku-4-5-20251001").strip()


def log(m):
    print(f"[qf-explain] {m}", file=sys.stderr, flush=True)


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
    return h / t, d / t, a / t


def qf_pairings():
    res = json.loads((DATA / "actual_results.json").read_text())
    out = []
    for key in (res.get("quarterfinals") or {}):
        if "__vs__" in key:
            out.append(tuple(key.split("__vs__", 1)))
    return out


def build_brief(a, b, teams, champ, ko_ctx, mu, beta):
    ca = teams.get(a, {}).get("composite", 0)
    cb = teams.get(b, {}).get("composite", 0)
    pa, pd, pb = _win_probs(ca - cb, mu, beta)
    ctx = ko_ctx.get(f"{a}__vs__{b}") or ko_ctx.get(f"{b}__vs__{a}") or {}
    ra = (ctx.get("team_a") or {}).get("rest_days")
    rb = (ctx.get("team_b") or {}).get("rest_days")
    return {
        "match": f"{a} vs {b}",
        "base": {"team_a_win": round(pa * 100, 1), "draw": round(pd * 100, 1), "team_b_win": round(pb * 100, 1)},
        "champion_odds": {a: champ.get(a, 0), b: champ.get(b, 0)},
        "rest_days": {a: ra, b: rb},
    }, (
        f"{a} vs {b} (World Cup quarterfinal). Model regulation W/D/L for {a}: "
        f"{pa*100:.0f}%/{pd*100:.0f}%/{pb*100:.0f}%. Title odds: {a} {champ.get(a,0)*100:.0f}%, "
        f"{b} {champ.get(b,0)*100:.0f}%. Rest days: {a} {ra}, {b} {rb}. "
        "In <=2 sentences, explain who is favored and why, and the single biggest upset risk "
        "(mention the rest-day edge only if it is >=2 days). Neutral analyst tone, no hedging filler."
    )


def main():
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        log("ANTHROPIC_API_KEY unset — dormant; leaving qf_explanations.json unchanged")
        return 0
    try:
        import anthropic
    except Exception:
        log("anthropic SDK missing — dormant")
        return 0

    teams = json.loads((DATA / "teams.json").read_text())
    fc = json.loads((DATA / "forecast.json").read_text())
    champ = {r.get("team"): r.get("champion", 0) for r in (fc.get("teams") or [])}
    ko_ctx = json.loads((DATA / "proto" / "ko_context.json").read_text()) if (DATA / "proto" / "ko_context.json").exists() else {}
    meta = json.loads((DATA / "meta.json").read_text())
    pg = meta.get("poisson_group") or {}
    mu, beta = pg.get("mu", 0.30), pg.get("beta", 0.125)

    client = anthropic.Anthropic(api_key=key)
    out = {"__meta__": {"model": MODEL, "method": "LLM explanation over base model + rest context; forward-looking, unscored"}}
    for a, b in qf_pairings():
        rec, prompt = build_brief(a, b, teams, champ, ko_ctx, mu, beta)
        try:
            msg = client.messages.create(model=MODEL, max_tokens=160,
                                         messages=[{"role": "user", "content": prompt}])
            rec["explanation"] = msg.content[0].text.strip()
        except Exception as e:  # noqa: BLE001
            log(f"{a} vs {b}: LLM call failed ({e})")
            rec["explanation"] = None
        out[f"{a}__vs__{b}"] = rec
        log(f"{a} vs {b}: {'ok' if rec.get('explanation') else 'failed'}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=True, indent=2) + "\n")
    log(f"wrote {OUT.name} ({len(qf_pairings())} QFs)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
