#!/usr/bin/env python3
"""PROTOTYPE (scripts/proto) — backfill the dormant player-talent + coaching layer.

Un-dormants DT's pending "player-talent + coaching" inputs WITHOUT the robots-
blocked FBref scrape. Everything here is derived from data already on disk
(players.json, teams.json) so it is fully reproducible and offline-safe; an
OPTIONAL Wikipedia enrichment pass adds real manager pedigree (honors / caps)
when the network is reachable, and degrades to the curated coach.experience
proxy when it is not.

Outputs data/proto/talent_coach.json:
  { team: {
      talent: { squad_overall, star_power, attack, midfield, defense, gk, depth,
                talent_raw },     # 0-100-ish player-derived strength
      coach:  { experience, pedigree_raw, source },
      talent_scaled, coach_scaled  # mapped onto the elo_scale sub-rating range
  }, __meta__: {...} }

These scaled values are drop-in new sub_ratings for the extended composite
(scripts/proto/optimize_weights_ext.py) and new columns for the GBM match model.
NOTHING in the production pipeline is touched.

Run:  python3 scripts/proto/backfill_talent_coach.py [--enrich-wiki]
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
OUT = DATA / "proto" / "talent_coach.json"

# position buckets in players.json -> our four aggregate lines
POS_MAP = {
    "GK": "gk",
    "DF": "defense", "CB": "defense", "LB": "defense", "RB": "defense", "DEF": "defense",
    "MF": "midfield", "CM": "midfield", "DM": "midfield", "AM": "midfield", "MID": "midfield",
    "FW": "attack", "ST": "attack", "CF": "attack", "LW": "attack", "RW": "attack", "FWD": "attack",
}


def log(m):
    print(f"[backfill] {m}", file=sys.stderr, flush=True)


def _bucket(pos: str) -> str:
    p = (pos or "").upper().strip()
    if p in POS_MAP:
        return POS_MAP[p]
    # first token / prefix fallback (e.g. "GK1", "CB-R")
    for k, v in POS_MAP.items():
        if p.startswith(k):
            return v
    return "midfield"


def _top_mean(vals, n):
    vals = sorted((v for v in vals if isinstance(v, (int, float))), reverse=True)
    if not vals:
        return None
    return statistics.mean(vals[:n])


def build_talent(players_by_team: dict) -> dict:
    """Player-derived talent per team. All 0-100 on the players.json `overall`
    scale so it is directly comparable to position_ratings / other sub-ratings."""
    out = {}
    for team, roster in players_by_team.items():
        by_line = {"gk": [], "defense": [], "midfield": [], "attack": []}
        overalls = []
        for p in roster:
            ov = p.get("overall")
            if not isinstance(ov, (int, float)):
                continue
            overalls.append(ov)
            by_line[_bucket(p.get("position"))].append(ov)
        # Best-XI-ish: a squad's strength is its best players, not its 26th man.
        # top-4 GK->1, defense->4, midfield->3, attack->3 (a 4-3-3 spine).
        gk = _top_mean(by_line["gk"], 1) or 0.0
        deff = _top_mean(by_line["defense"], 4) or 0.0
        mid = _top_mean(by_line["midfield"], 3) or 0.0
        att = _top_mean(by_line["attack"], 3) or 0.0
        squad_overall = _top_mean(overalls, 11) or 0.0     # best XI mean
        star_power = max(overalls) if overalls else 0.0    # single best player
        depth = _top_mean(overalls, 20) or 0.0             # 20-deep mean (rotation)
        # Weighted spine: attack + midfield carry most predictive signal, then
        # defense, then GK. Blend best-XI with star power (tournaments turn on
        # individual moments). Weights are a prior; the optimizer/GBM re-weight.
        talent_raw = round(
            0.30 * att + 0.27 * mid + 0.25 * deff + 0.08 * gk
            + 0.06 * squad_overall + 0.04 * (star_power or 0.0), 2
        )
        out[team] = {
            "squad_overall": round(squad_overall, 2),
            "star_power": round(star_power, 2),
            "attack": round(att, 2),
            "midfield": round(mid, 2),
            "defense": round(deff, 2),
            "gk": round(gk, 2),
            "depth": round(depth, 2),
            "talent_raw": talent_raw,
        }
    return out


def build_coach(teams: dict, enrich_wiki: bool) -> dict:
    """Coach pedigree per team. Base = curated coach.experience (50-99). Optional
    Wikipedia enrichment blends in a real honors/caps signal when reachable."""
    out = {}
    wiki = {}
    if enrich_wiki:
        wiki = _scrape_wiki_coaches(teams)
    for name, t in teams.items():
        c = t.get("coach", {}) or {}
        exp = c.get("experience")
        exp = float(exp) if isinstance(exp, (int, float)) else 70.0
        source = "experience"
        pedigree = exp
        w = wiki.get(name)
        if w and isinstance(w.get("pedigree"), (int, float)):
            # 60/40 curated/scraped blend so a thin wiki page can't dominate.
            pedigree = round(0.6 * exp + 0.4 * w["pedigree"], 2)
            source = "experience+wiki"
        out[name] = {
            "coach_name": c.get("name"),
            "experience": exp,
            "pedigree_raw": round(pedigree, 2),
            "source": source,
        }
    return out


def _scrape_wiki_coaches(teams: dict) -> dict:
    """Best-effort Wikipedia manager pedigree. Reachable per the env proxy
    (fbref is 403, wikipedia is 200). Returns {team: {pedigree}} on the 50-99
    scale. Never raises — returns {} on any failure so the offline path wins."""
    try:
        import re
        import urllib.parse
        import requests
    except Exception:
        return {}
    out = {}
    sess = requests.Session()
    sess.headers["User-Agent"] = "wc26-proto-backfill/1.0 (research)"
    for name, t in teams.items():
        coach = (t.get("coach", {}) or {}).get("name")
        if not coach:
            continue
        try:
            url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
                "action": "query", "prop": "extracts", "explaintext": 1,
                "titles": coach, "format": "json", "redirects": 1, "exintro": 1,
            })
            r = sess.get(url, timeout=15)
            pages = r.json().get("query", {}).get("pages", {})
            text = ""
            for p in pages.values():
                text = p.get("extract", "") or ""
            if not text:
                continue
            # crude pedigree proxy from the intro: honors keywords + career length.
            kw = sum(text.lower().count(k) for k in (
                "world cup", "champions league", "league title", "won the",
                "continental", "olympic", "trophy", "cup final"))
            yrs = 0
            m = re.search(r"since (\d{4})", text.lower())
            if m:
                yrs = max(0, 2026 - int(m.group(1)))
            # map to 50-99: base 55 + honors + tenure, clamped.
            ped = 55 + min(30, 4 * kw) + min(14, yrs)
            out[name] = {"pedigree": float(max(50, min(99, ped)))}
        except Exception:
            continue
    log(f"wiki enrichment: {len(out)}/{len(teams)} coaches enriched")
    return out


def _scale_map(raw: dict, scale: dict) -> dict:
    """z-score raw values across teams, map onto the elo_scale sub-rating range
    (mirrors compute_form.to_scaled so the new sub-ratings are commensurate)."""
    vals = [v for v in raw.values() if isinstance(v, (int, float))]
    lo, hi = scale["clamp_lo"], scale["clamp_hi"]
    mid = (lo + hi) / 2.0
    if len(vals) < 2:
        return {k: round(mid, 1) for k in raw}
    mu = statistics.mean(vals)
    sd = statistics.pstdev(vals) or 1.0
    spread = (hi - lo) / 4.0  # +-2 sigma spans the range
    out = {}
    for k, v in raw.items():
        if not isinstance(v, (int, float)):
            out[k] = round(mid, 1)
        else:
            z = (v - mu) / sd
            out[k] = round(max(lo, min(hi, mid + spread * z)), 1)
    return out


def main() -> int:
    enrich = "--enrich-wiki" in sys.argv
    teams = json.loads((DATA / "teams.json").read_text())
    players = json.loads((DATA / "players.json").read_text())
    scale = json.loads((DATA / "elo_scale.json").read_text()) if (DATA / "elo_scale.json").exists() \
        else {"clamp_lo": 56.3, "clamp_hi": 93.1}

    by_team = {}
    for p in players:
        by_team.setdefault(p.get("team"), []).append(p)

    talent = build_talent(by_team)
    coach = build_coach(teams, enrich)

    talent_scaled = _scale_map({n: talent[n]["talent_raw"] for n in teams if n in talent}, scale)
    coach_scaled = _scale_map({n: coach[n]["pedigree_raw"] for n in teams if n in coach}, scale)

    out = {"__meta__": {
        "generated": "prototype",
        "method": "player-derived talent (players.json best-XI spine) + curated coach.experience"
                  + (" enriched w/ Wikipedia manager pedigree" if enrich else ""),
        "scale": scale, "enrich_wiki": enrich, "n_teams": len(teams),
    }}
    for n in teams:
        out[n] = {
            "talent": talent.get(n, {}),
            "coach": coach.get(n, {}),
            "talent_scaled": talent_scaled.get(n),
            "coach_scaled": coach_scaled.get(n),
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=True, indent=2) + "\n")

    # quick sanity print: top-5 by talent
    top = sorted(((talent[n]["talent_raw"], n) for n in talent), reverse=True)[:5]
    log("talent+coach written -> data/proto/talent_coach.json")
    log("top-5 talent: " + ", ".join(f"{n} {v:.1f}" for v, n in top))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(1)
