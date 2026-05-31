#!/usr/bin/env python3
"""Rebuild data/schedule_full.json + data/schedule.json from the open-source
mjwebmaster/world-cup-2026-schedule-data feed.

Why this source: independently maintained, dates match openfootball/worldcup.json,
includes venue + city + ET-and-local times. No API key required. Cross-verified
against FIFA PDF dates where possible.

Run from repo root:
    python3 scripts/scrape_schedule.py

This replaces the previous PDF-extract-based scrape which had a ~1-day date
offset for many group-stage matches due to PDF column-detection drift.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

SOURCE_URL = "https://raw.githubusercontent.com/mjwebmaster/world-cup-2026-schedule-data/main/world-cup-2026-schedule.json"
ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_FULL = ROOT / "data" / "schedule_full.json"
SCHEDULE_SUMMARY = ROOT / "data" / "schedule.json"
VENUES_JSON = ROOT / "data" / "venues.json"

# Team-name normalization. Maps source names to our canonical names in teams.json.
TEAM_RENAMES = {
    "South Korea":            "Korea Republic",
    "Korea Republic":         "Korea Republic",
    "Czech Republic":         "Czechia",
    "Cape Verde":             "Cabo Verde",
    "Bosnia & Herzegovina":   "Bosnia and Herzegovina",
    "Turkey":                 "Turkiye",
    "Türkiye":                "Turkiye",
    "Ivory Coast":            "Cote d'Ivoire",
    "Côte d'Ivoire":          "Cote d'Ivoire",
    "Côte d’Ivoire":          "Cote d'Ivoire",   # curly apostrophe variant
    "Curaçao":                "Curacao",
    "United States":          "USA",
    "U.S.A.":                 "USA",
    "Congo DR":               "DR Congo",
    "Democratic Republic of the Congo": "DR Congo",
    "DR Congo":               "DR Congo",
}

def build_venue_map():
    venues = json.loads(VENUES_JSON.read_text())
    out = {}
    for v in venues:
        out[v["name"].lower()] = v["id"]
        out[(v["name"] + ", " + v["city"]).lower()] = v["id"]
        out[v["city"].lower()] = v["id"]
    overrides = {
        "estadio bbva":              "bbva",
        "monterrey":                 "bbva",
        "estadio akron":             "akron",
        "guadalajara":               "akron",
        "estadio azteca":            "azteca",
        "mexico city":               "azteca",
        "sofi stadium":              "sofi",
        "inglewood":                 "sofi",
        "los angeles":               "sofi",
        "metlife stadium":           "metlife",
        "east rutherford":           "metlife",
        "new york/new jersey (east rutherford)": "metlife",
        "lumen field":               "lumen",
        "seattle":                   "lumen",
        "levi's stadium":            "levis",
        "san francisco bay area":    "levis",
        "santa clara":               "levis",
        "lincoln financial field":   "lincoln",
        "philadelphia":              "lincoln",
        "gillette stadium":          "gillette",
        "foxborough":                "gillette",
        "boston":                    "gillette",
        "hard rock stadium":         "hardrock",
        "miami":                     "hardrock",
        "miami gardens":             "hardrock",
        "mercedes-benz stadium":     "mercedes",
        "atlanta":                   "mercedes",
        "at&t stadium":              "att",
        "att stadium":               "att",
        "arlington":                 "att",
        "dallas":                    "att",
        "nrg stadium":               "nrg",
        "houston":                   "nrg",
        "arrowhead stadium":         "arrowhead",
        "geha field at arrowhead stadium": "arrowhead",
        "kansas city":               "arrowhead",
        "bmo field":                 "bmo_field",
        "toronto":                   "bmo_field",
        "bc place":                  "bc_place",
        "vancouver":                 "bc_place",
    }
    out.update(overrides)
    return out

import re
def normalize_team(name):
    if not name: return None
    name = name.strip()
    # Knockout slot placeholders from the source come as human strings; convert
    # them to the convention the rest of the app already understands
    # (1A/2B = group winner/runner-up; 3 ABCDF = best 3rd of those groups;
    # W74 = winner of match 74; L101 = loser of match 101).
    m = re.match(r'^Group ([A-L]) Winner$', name)
    if m: return f"1{m.group(1)}"
    m = re.match(r'^Group ([A-L]) Runner[-\s]?up$', name)
    if m: return f"2{m.group(1)}"
    # Match patterns like:
    #   "3rd Place Groups A, E, H, I, J" / "Best 3rd Place Group ABCDF"
    #   "Group A/E/H/I/J 3rd Place"
    m = (re.match(r'^(?:3rd Place|Best 3rd Place)[\s,]*Groups?\s+([A-L\s,/-]+)$', name, re.IGNORECASE)
         or re.match(r'^Group\s+([A-L][A-L/,\s-]*)\s+3rd\s+Place$', name, re.IGNORECASE))
    if m:
        letters = re.findall(r'[A-L]', m.group(1))
        return f"3 {''.join(sorted(set(letters)))}"
    m = re.match(r'^Match (\d+) Winner$', name)
    if m: return f"W{m.group(1)}"
    m = re.match(r'^Match (\d+) Loser$', name)
    if m: return f"L{m.group(1)}"
    return TEAM_RENAMES.get(name, name)

def venue_id_for(venue_map, venue_str, city_str):
    if venue_str:
        k = venue_str.lower().strip()
        if k in venue_map: return venue_map[k]
        k2 = f"{venue_str}, {city_str}".lower().strip()
        if k2 in venue_map: return venue_map[k2]
    if city_str:
        k = city_str.lower().strip()
        if k in venue_map: return venue_map[k]
    return None

def et_to_utc(date_iso, time_et):
    """ET → UTC. WC26 runs June 11–July 19, fully inside EDT (UTC-4)."""
    h, m = time_et.split(":")
    edt = timezone(timedelta(hours=-4))
    local = datetime.fromisoformat(date_iso).replace(hour=int(h), minute=int(m), tzinfo=edt)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

STAGE_MAP = {
    "Group Stage": "group",
    "Round of 32": "round_of_32",
    "Round of 16": "round_of_16",
    "Quarter-final": "quarterfinals",
    "Quarter-finals": "quarterfinals",
    "Semi-final": "semifinals",
    "Semi-finals": "semifinals",
    "Match for third place": "third_place",
    "Third Place": "third_place",
    "Final": "final",
}

def normalize_stage(s):
    return STAGE_MAP.get(s, s.lower().replace(" ", "_").replace("-", "_"))

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "wc26-tracker/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def main():
    print(f"fetching {SOURCE_URL}")
    try:
        raw = fetch(SOURCE_URL)
    except Exception as e:
        print(f"WARN: fetch failed ({e}); leaving existing schedule untouched.")
        return 0
    src = json.loads(raw.decode("utf-8"))
    matches = src.get("matches", [])
    if len(matches) != 104:
        print(f"WARN: source has {len(matches)} matches (expected 104); leaving existing schedule untouched.")
        return 0
    venue_map = build_venue_map()

    out = []
    venue_unknown = 0
    for m in matches:
        team_a = normalize_team(m.get("team_a"))
        team_b = normalize_team(m.get("team_b"))
        stage = normalize_stage(m.get("stage", ""))
        kickoff_utc = et_to_utc(m["date"], m["time_et"])
        vid = venue_id_for(venue_map, m.get("venue"), m.get("city"))
        if not vid:
            venue_unknown += 1
        if stage == "group":
            match_id = f"{team_a}__vs__{team_b}"
        else:
            ta = (team_a or "").replace(" ", "_")
            tb = (team_b or "").replace(" ", "_")
            match_id = f"M{m['match_number']:03d}__{ta}__vs__{tb}"
        row = {
            "match_id": match_id,
            "match_number": m["match_number"],
            "stage": stage,
            "team_a": team_a,
            "team_b": team_b,
            "kickoff_utc": kickoff_utc,
            "kickoff_local_et": f"{m['date']}T{m['time_et']}-04:00",
            "venue_id": vid,
            "broadcast": {"us": {"english_channel": None, "spanish_channel": None, "stream_url": None}},
        }
        if m.get("group"):
            row["group"] = m["group"]
        out.append(row)

    SCHEDULE_FULL.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} matches to {SCHEDULE_FULL}")
    print(f"venue unknown: {venue_unknown}")

    venues = json.loads(VENUES_JSON.read_text())
    by_id = {v["id"]: v for v in venues}
    def venue_label(vid):
        v = by_id.get(vid); return v and f"{v['name']}, {v['city']}"

    opening = out[0]
    usa_match = next((m for m in out if "USA" in (m["team_a"], m["team_b"]) and m["stage"] == "group"), None)
    final = out[-1]
    ko_start = next((m for m in out if m["stage"] == "round_of_32"), None)
    summary = {
        "opening_match": {
            "date": opening["kickoff_utc"][:10],
            "match": f"{opening['team_a']} vs {opening['team_b']}",
            "venue": venue_label(opening["venue_id"]),
            "group": opening.get("group"),
        },
        "usa_opener": usa_match and {
            "date": usa_match["kickoff_utc"][:10],
            "match": f"{usa_match['team_a']} vs {usa_match['team_b']}",
            "venue": venue_label(usa_match["venue_id"]),
            "group": usa_match.get("group"),
        },
        "final": {
            "date": final["kickoff_utc"][:10],
            "venue": venue_label(final["venue_id"]) or "MetLife Stadium, East Rutherford",
        },
        "knockout_stage_starts": ko_start and ko_start["kickoff_utc"][:10],
        "source": SOURCE_URL,
        "source_last_updated": src.get("last_updated"),
    }
    SCHEDULE_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote summary to {SCHEDULE_SUMMARY}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
