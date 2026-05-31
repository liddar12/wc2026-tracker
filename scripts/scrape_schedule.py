#!/usr/bin/env python3
"""Rebuild data/schedule_full.json + data/schedule.json from
data/schedule_source.json (canonical, FIFA PDF v17 derived).

Falls back to the mjwebmaster open feed if the local file is missing
(e.g. CI checkout misses it) — but the local file is authoritative
when present. After consuming primary, we cross-check the mjwebmaster
feed and log any UTC kickoff diffs as warnings (non-blocking).

Run from repo root:
    python3 scripts/scrape_schedule.py
"""
import json
import sys
import urllib.request
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_SOURCE = ROOT / "data" / "schedule_source.json"   # PRIMARY: canonical FIFA-derived
SCHEDULE_FULL = ROOT / "data" / "schedule_full.json"
SCHEDULE_SUMMARY = ROOT / "data" / "schedule.json"
VENUES_JSON = ROOT / "data" / "venues.json"

# Secondary cross-check (logs warnings on UTC divergence; never blocks)
BACKUP_URL = "https://raw.githubusercontent.com/mjwebmaster/world-cup-2026-schedule-data/main/world-cup-2026-schedule.json"

# Team-name normalization. The canonical file already uses FIFA-official
# spellings (Türkiye, IR Iran, Côte d'Ivoire with curly apostrophe). Map all
# of those plus any other community-feed variants → our canonical app names
# (matching data/teams.json keys).
TEAM_RENAMES = {
    # Canonical file → app canonical
    "South Korea":                       "Korea Republic",
    "Korea Republic":                    "Korea Republic",
    "Czech Republic":                    "Czechia",
    "Cape Verde":                        "Cabo Verde",
    "Cabo Verde":                        "Cabo Verde",
    "Bosnia & Herzegovina":              "Bosnia and Herzegovina",
    "Bosnia and Herzegovina":            "Bosnia and Herzegovina",
    "Turkey":                            "Turkiye",
    "Türkiye":                           "Turkiye",
    "Turkiye":                           "Turkiye",
    "Ivory Coast":                       "Cote d'Ivoire",
    "Côte d'Ivoire":                     "Cote d'Ivoire",
    "Côte d’Ivoire":                     "Cote d'Ivoire",
    "Cote d'Ivoire":                     "Cote d'Ivoire",
    "Curaçao":                           "Curacao",
    "Curacao":                           "Curacao",
    "United States":                     "USA",
    "U.S.A.":                            "USA",
    "USA":                               "USA",
    "Congo DR":                          "DR Congo",
    "Democratic Republic of the Congo":  "DR Congo",
    "DR Congo":                          "DR Congo",
    "IR Iran":                           "Iran",
    "Iran":                              "Iran",
}

def build_venue_map():
    venues = json.loads(VENUES_JSON.read_text())
    out = {}
    for v in venues:
        out[v["name"].lower()] = v["id"]
        out[(v["name"] + ", " + v["city"]).lower()] = v["id"]
        out[v["city"].lower()] = v["id"]
    overrides = {
        "estadio bbva":                       "bbva",
        "monterrey":                          "bbva",
        "estadio akron":                      "akron",
        "guadalajara":                        "akron",
        "estadio azteca":                     "azteca",
        "estadio banorte (tournament name)":  "azteca",
        "estadio banorte":                    "azteca",
        "mexico city":                        "azteca",
        "sofi stadium":                       "sofi",
        "inglewood":                          "sofi",
        "los angeles":                        "sofi",
        "metlife stadium":                    "metlife",
        "east rutherford":                    "metlife",
        "new york/new jersey (east rutherford)": "metlife",
        "lumen field":                        "lumen",
        "seattle":                            "lumen",
        "levi's stadium":                     "levis",
        "san francisco bay area":             "levis",
        "santa clara":                        "levis",
        "lincoln financial field":            "lincoln",
        "philadelphia":                       "lincoln",
        "gillette stadium":                   "gillette",
        "foxborough":                         "gillette",
        "boston":                             "gillette",
        "hard rock stadium":                  "hardrock",
        "miami":                              "hardrock",
        "miami gardens":                      "hardrock",
        "mercedes-benz stadium":              "mercedes",
        "atlanta":                            "mercedes",
        "at&t stadium":                       "att",
        "att stadium":                        "att",
        "arlington":                          "att",
        "dallas":                             "att",
        "nrg stadium":                        "nrg",
        "houston":                            "nrg",
        "arrowhead stadium":                  "arrowhead",
        "geha field at arrowhead stadium":    "arrowhead",
        "kansas city":                        "arrowhead",
        "bmo field":                          "bmo_field",
        "toronto":                            "bmo_field",
        "bc place":                           "bc_place",
        "vancouver":                          "bc_place",
    }
    out.update(overrides)
    return out

def normalize_team(name):
    if not name: return None
    name = name.strip()
    # Group winner — accept both "Group A Winner" and "Winner Group A"
    m = (re.match(r'^Group ([A-L]) Winner$', name, re.IGNORECASE)
         or re.match(r'^Winner Group ([A-L])$', name, re.IGNORECASE))
    if m: return f"1{m.group(1).upper()}"
    # Runner-up — accept both "Group A Runner-up" and "Runner-up Group A"
    m = (re.match(r'^Group ([A-L]) Runner[-\s]?up$', name, re.IGNORECASE)
         or re.match(r'^Runner[-\s]?up Group ([A-L])$', name, re.IGNORECASE))
    if m: return f"2{m.group(1).upper()}"
    # Best 3rd-place — accept "3rd Place Groups A,B,C", "3rd Group A/B/C", "Group A/B/C 3rd Place"
    m = (re.match(r'^(?:3rd Place|Best 3rd Place|3rd Group)\s*(?:Groups?\s+)?([A-L][A-L\s,/-]*)$', name, re.IGNORECASE)
         or re.match(r'^Group\s+([A-L][A-L/,\s-]*)\s+3rd\s+Place$', name, re.IGNORECASE))
    if m:
        letters = re.findall(r'[A-L]', m.group(1))
        return f"3 {''.join(sorted(set(letters)))}"
    # Winner/Loser of a numbered match — accept both word orders.
    m = (re.match(r'^Match (\d+) Winner$', name, re.IGNORECASE)
         or re.match(r'^Winner Match (\d+)$', name, re.IGNORECASE))
    if m: return f"W{m.group(1)}"
    m = (re.match(r'^Match (\d+) Loser$', name, re.IGNORECASE)
         or re.match(r'^Loser Match (\d+)$', name, re.IGNORECASE))
    if m: return f"L{m.group(1)}"
    return TEAM_RENAMES.get(name, name)

def venue_id_for(venue_map, *candidates):
    for c in candidates:
        if not c: continue
        k = c.lower().strip()
        if k in venue_map: return venue_map[k]
    return None

STAGE_MAP_PRIMARY = {
    "Group stage":               "group",
    "Round of 32":               "round_of_32",
    "Round of 16":               "round_of_16",
    "Quarter-finals":            "quarterfinals",
    "Quarter-final":             "quarterfinals",
    "Semi-finals":               "semifinals",
    "Semi-final":                "semifinals",
    "Third-place playoff":       "third_place",
    "Match for third place":     "third_place",
    "Third Place":               "third_place",
    "Bronze final (3rd place)":  "third_place",
    "Bronze final":              "third_place",
    "Final":                     "final",
}
STAGE_MAP_BACKUP = {
    "Group Stage":     "group",
    "Round of 32":     "round_of_32",
    "Round of 16":     "round_of_16",
    "Quarter-final":   "quarterfinals",
    "Quarter-finals":  "quarterfinals",
    "Semi-final":      "semifinals",
    "Semi-finals":     "semifinals",
    "Match for third place": "third_place",
    "Third Place":     "third_place",
    "Final":           "final",
}

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "wc26-tracker/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def et_to_utc(date_iso, time_et):
    """ET → UTC for backup-source fallback. WC26 runs fully inside EDT (UTC-4)."""
    h, m = time_et.split(":")
    edt = timezone(timedelta(hours=-4))
    local = datetime.fromisoformat(date_iso).replace(hour=int(h), minute=int(m), tzinfo=edt)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def build_from_primary(venue_map):
    """Primary path: read data/schedule_source.json and translate to our shape."""
    src = json.loads(SCHEDULE_SOURCE.read_text())
    matches = src.get("matches", [])
    if len(matches) != 104:
        raise RuntimeError(f"schedule_source.json has {len(matches)} matches; expected 104")

    out = []
    venue_unknown = 0
    for m in matches:
        team_a = normalize_team(m.get("teams", {}).get("home"))
        team_b = normalize_team(m.get("teams", {}).get("away"))
        stage = STAGE_MAP_PRIMARY.get(m.get("round", ""), m.get("round", "").lower().replace(" ", "_").replace("-", "_"))
        kickoff_utc_iso = m.get("kickoff_utc", {}).get("iso8601", "")
        # Convert "+00:00" → "Z" suffix to match our existing schema convention.
        kickoff_utc = kickoff_utc_iso.replace("+00:00", "Z") if kickoff_utc_iso else None

        venue = m.get("venue", {})
        vid = venue_id_for(
            venue_map,
            venue.get("stadium"),
            venue.get("tournament_alt_name"),
            f"{venue.get('stadium','')}, {venue.get('city','')}",
            venue.get("city"),
        )
        if not vid: venue_unknown += 1

        if stage == "group":
            match_id = f"{team_a}__vs__{team_b}"
        else:
            ta = (team_a or "").replace(" ", "_")
            tb = (team_b or "").replace(" ", "_")
            match_id = f"M{m['match_number']:03d}__{ta}__vs__{tb}"

        row = {
            "match_id":          match_id,
            "match_number":      m["match_number"],
            "stage":             stage,
            "team_a":            team_a,
            "team_b":            team_b,
            "kickoff_utc":       kickoff_utc,
            "kickoff_local_et":  m.get("kickoff_et_official", {}).get("iso8601"),
            "kickoff_local_venue": m.get("kickoff_local_venue", {}).get("iso8601"),
            "venue_id":          vid,
            "venue_timezone":    venue.get("iana_timezone"),
            "broadcast":         {"us": {"english_channel": None, "spanish_channel": None, "stream_url": None}},
        }
        if m.get("group"):
            row["group"] = m["group"]
        out.append(row)

    return out, src, venue_unknown

def build_from_backup(venue_map):
    """Fallback path: hit mjwebmaster if local file is missing. Same as the
    pre-canonical version of this script."""
    src = fetch_json(BACKUP_URL)
    matches = src.get("matches", [])
    if len(matches) != 104:
        raise RuntimeError(f"backup source has {len(matches)} matches; expected 104")
    out = []
    venue_unknown = 0
    for m in matches:
        team_a = normalize_team(m.get("team_a"))
        team_b = normalize_team(m.get("team_b"))
        stage = STAGE_MAP_BACKUP.get(m.get("stage", ""), m.get("stage", "").lower().replace(" ", "_").replace("-", "_"))
        kickoff_utc = et_to_utc(m["date"], m["time_et"])
        vid = venue_id_for(venue_map, m.get("venue"), m.get("city"))
        if not vid: venue_unknown += 1

        if stage == "group":
            match_id = f"{team_a}__vs__{team_b}"
        else:
            ta = (team_a or "").replace(" ", "_")
            tb = (team_b or "").replace(" ", "_")
            match_id = f"M{m['match_number']:03d}__{ta}__vs__{tb}"

        row = {
            "match_id":          match_id,
            "match_number":      m["match_number"],
            "stage":             stage,
            "team_a":            team_a,
            "team_b":            team_b,
            "kickoff_utc":       kickoff_utc,
            "kickoff_local_et":  f"{m['date']}T{m['time_et']}-04:00",
            "venue_id":          vid,
            "broadcast":         {"us": {"english_channel": None, "spanish_channel": None, "stream_url": None}},
        }
        if m.get("group"):
            row["group"] = m["group"]
        out.append(row)
    return out, src, venue_unknown

def cross_check_against_backup(out, log_prefix="cross-check"):
    """Fetch mjwebmaster and log any UTC kickoff divergence. Non-blocking."""
    try:
        backup = fetch_json(BACKUP_URL)
    except Exception as e:
        print(f"{log_prefix}: backup fetch failed ({e}); skipping cross-check")
        return
    bk_by_num = {m["match_number"]: m for m in backup.get("matches", [])}
    diverged = 0
    for row in out:
        n = row["match_number"]
        b = bk_by_num.get(n)
        if not b: continue
        bk_utc = et_to_utc(b["date"], b["time_et"])
        if bk_utc != row["kickoff_utc"]:
            diverged += 1
            if diverged <= 5:
                print(f"  ⚠ #{n:3d} {row['team_a']} v {row['team_b']}: primary={row['kickoff_utc']}  backup={bk_utc}")
    if diverged:
        print(f"{log_prefix}: {diverged} of {len(out)} matches diverge from backup feed (primary wins)")
    else:
        print(f"{log_prefix}: 0 divergences from backup feed ✓")

def main():
    venue_map = build_venue_map()
    src_meta = {}
    if SCHEDULE_SOURCE.exists():
        print(f"primary: {SCHEDULE_SOURCE.name}")
        out, src, venue_unknown = build_from_primary(venue_map)
        src_meta = {
            "source": "schedule_source.json (FIFA PDF v17 derived)",
            "source_provenance": src.get("data_provenance"),
            "source_tournament": src.get("tournament", {}).get("official_name"),
        }
    else:
        print(f"primary missing; falling back to {BACKUP_URL}")
        try:
            out, src, venue_unknown = build_from_backup(venue_map)
            src_meta = {"source": BACKUP_URL}
        except Exception as e:
            print(f"backup also failed ({e}); leaving existing schedule untouched.")
            return 0

    SCHEDULE_FULL.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} matches to {SCHEDULE_FULL}")
    print(f"venue unknown: {venue_unknown}")

    # Cross-check against the public backup feed — non-blocking, informational.
    if SCHEDULE_SOURCE.exists():
        cross_check_against_backup(out)

    # Build summary
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
            "date":  opening["kickoff_utc"][:10],
            "match": f"{opening['team_a']} vs {opening['team_b']}",
            "venue": venue_label(opening["venue_id"]),
            "group": opening.get("group"),
        },
        "usa_opener": usa_match and {
            "date":  usa_match["kickoff_utc"][:10],
            "match": f"{usa_match['team_a']} vs {usa_match['team_b']}",
            "venue": venue_label(usa_match["venue_id"]),
            "group": usa_match.get("group"),
        },
        "final": {
            "date":  final["kickoff_utc"][:10],
            "venue": venue_label(final["venue_id"]) or "MetLife Stadium, East Rutherford",
        },
        "knockout_stage_starts": ko_start and ko_start["kickoff_utc"][:10],
        **src_meta,
    }
    SCHEDULE_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote summary to {SCHEDULE_SUMMARY}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
