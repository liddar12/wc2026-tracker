#!/usr/bin/env python3
"""Build data/team_colors.json from Wikipedia national-team infoboxes.

For each team in data/teams.json we hit the MediaWiki action API for the
team's Wikipedia article, parse the kit color HEX codes from the infobox,
and write the canonical primary/secondary/tertiary to data/team_colors.json.

Wikipedia uses an SVG-based kit template like:
  | pattern_la1 = ...
  | leftarm1    = 006847
  | body1       = 006847
  | rightarm1   = 006847
  | shorts1     = FFFFFF
  | socks1      = C8102E
The "1" suffix is the HOME kit (what we want); "2" is away.

Strategy: pick the most-used color in {leftarm1, body1, rightarm1} as PRIMARY.
SECONDARY = shorts1. TERTIARY = socks1. If those collide with primary, fall
back to whichever doesn't.

Run from repo root: python3 scripts/scrape_team_colors_wiki.py
"""
import json
import re
import sys
import time
import urllib.request
import urllib.parse
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEAMS_JSON = ROOT / "data" / "teams.json"
OVERRIDES_JSON = ROOT / "data" / "team_colors_overrides.json"
OUT_JSON = ROOT / "data" / "team_colors.json"
WIKI_API = "https://en.wikipedia.org/w/api.php"

# Map our canonical team name to the Wikipedia article title.
WIKI_TITLES = {
    "USA":                       "United States men's national soccer team",
    "Korea Republic":            "South Korea national football team",
    "DR Congo":                  "DR Congo national football team",
    "Cote d'Ivoire":             "Ivory Coast national football team",
    "Cabo Verde":                "Cape Verde national football team",
    "Bosnia and Herzegovina":    "Bosnia and Herzegovina national football team",
    "Turkiye":                   "Turkey national football team",
    "Curacao":                   "Curaçao national football team",
    "Czechia":                   "Czech Republic national football team",
    "Iran":                      "Iran national football team",
}

def wiki_title_for(team):
    if team in WIKI_TITLES:
        return WIKI_TITLES[team]
    return f"{team} national football team"

def fetch_wikitext(title):
    params = {
        "action": "parse",
        "page": title,
        "prop": "wikitext",
        "format": "json",
        "redirects": "1",
    }
    url = f"{WIKI_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "wc26-tracker/1.0 (+https://worldcup2026.j5lagenticstrategy.com)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if "error" in data:
        raise RuntimeError(f"wiki error: {data['error'].get('info')}")
    return data["parse"]["wikitext"]["*"]

HEX_RE = re.compile(r"\b([0-9a-fA-F]{6})\b")
FIELD_RE = re.compile(r"\|\s*(leftarm1|body1|rightarm1|shorts1|socks1)\s*=\s*([^|\n]+)", re.IGNORECASE)

def extract_kit_colors(wikitext):
    """Return a dict of field -> hex string (uppercase) for HOME kit only."""
    out = {}
    for m in FIELD_RE.finditer(wikitext):
        field = m.group(1).lower()
        raw = m.group(2).strip().strip("{}").strip("'\"")
        # First 6-hex-digit token in the value
        h = HEX_RE.search(raw)
        if h:
            out[field] = "#" + h.group(1).upper()
    return out

def derive_primary_secondary_tertiary(colors):
    if not colors:
        return None, None, None
    shirt = [colors.get(k) for k in ("leftarm1", "body1", "rightarm1") if colors.get(k)]
    primary = None
    if shirt:
        primary = Counter(shirt).most_common(1)[0][0]
    shorts = colors.get("shorts1")
    socks = colors.get("socks1")
    # Build a deduped list excluding primary
    candidates = []
    for c in (shorts, socks):
        if c and c != primary and c not in candidates:
            candidates.append(c)
    secondary = candidates[0] if len(candidates) >= 1 else None
    tertiary = candidates[1] if len(candidates) >= 2 else None
    return primary, secondary, tertiary

def main():
    teams = json.loads(TEAMS_JSON.read_text())
    names = list(teams.keys()) if isinstance(teams, dict) else [x["name"] for x in teams]
    out = {}
    failed = []
    for i, team in enumerate(names, 1):
        title = wiki_title_for(team)
        try:
            wt = fetch_wikitext(title)
        except Exception as e:
            print(f"  [{i:2d}/{len(names)}] {team:<28} FETCH FAIL ({e})")
            failed.append(team)
            continue
        colors = extract_kit_colors(wt)
        primary, secondary, tertiary = derive_primary_secondary_tertiary(colors)
        if not primary:
            print(f"  [{i:2d}/{len(names)}] {team:<28} NO COLORS")
            failed.append(team)
            continue
        out[team] = {
            "primary":   primary,
            "secondary": secondary,
            "tertiary":  tertiary,
            "source":    "wikipedia:infobox",
            "wiki_title": title,
        }
        print(f"  [{i:2d}/{len(names)}] {team:<28} {primary} {secondary or '-':>7} {tertiary or '-':>7}")
        time.sleep(0.2)  # be polite to MediaWiki

    # Always fill in any missing teams with a placeholder so callers can do safe lookups.
    for team in names:
        if team not in out:
            out[team] = {"primary": "#1F4E78", "secondary": "#FFFFFF", "tertiary": "#C9252D",
                         "source": "fallback", "wiki_title": wiki_title_for(team)}

    # Merge curated overrides on top — these win for visual identity colors
    # since Wikipedia's infobox often returns the literal shirt color (e.g.,
    # white) rather than the team's iconic brand color.
    if OVERRIDES_JSON.exists():
        overrides = json.loads(OVERRIDES_JSON.read_text())
        applied = 0
        for team, colors in overrides.items():
            if team.startswith("_"): continue  # skip _comment etc.
            if team not in out: continue
            # Stash the auto-scraped value for diagnostics, then apply override
            out[team]["wiki_primary"] = out[team]["primary"]
            out[team]["wiki_secondary"] = out[team].get("secondary")
            out[team]["wiki_tertiary"] = out[team].get("tertiary")
            out[team]["primary"]   = colors["primary"]
            out[team]["secondary"] = colors.get("secondary")
            out[team]["tertiary"]  = colors.get("tertiary")
            out[team]["source"]    = colors.get("source", "curated") + "+wikipedia"
            applied += 1
        print(f"applied {applied} curated overrides")

    # Freshness stamp — the home "Data freshness" panel reads
    # teamColors.__meta__.updated_at (was missing → showed "never").
    from datetime import datetime, timezone
    out["__meta__"] = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"\nwrote {len(out)} teams to {OUT_JSON}")
    print(f"failed: {len(failed)} ({', '.join(failed) if failed else 'none'})")
    return 0  # don't fail CI on partial; fallbacks and overrides fill in

if __name__ == "__main__":
    sys.exit(main())
