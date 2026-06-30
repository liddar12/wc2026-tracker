#!/usr/bin/env python3
"""Live results scraper — pulls ESPN's public soccer/fifa.world scoreboard
for each tournament day with a match in [yesterday, +2 days] and updates
data/actual_results.json with finished + in-progress match scores.

Run from repo root:
    python3 scripts/scrape_live_results.py

Endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD
"""
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTUAL = ROOT / "data" / "actual_results.json"
SCHEDULE_FULL = ROOT / "data" / "schedule_full.json"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"

# ESPN may use slightly different team labels than our canonical names.
TEAM_RENAMES = {
    "United States":                    "USA",
    "USA":                              "USA",
    "South Korea":                      "Korea Republic",
    "Korea Republic":                   "Korea Republic",
    "Czechia":                          "Czechia",
    "Czech Republic":                   "Czechia",
    "Cabo Verde":                       "Cabo Verde",
    "Cape Verde":                       "Cabo Verde",
    "Türkiye":                          "Turkiye",
    "Turkey":                           "Turkiye",
    "Turkiye":                          "Turkiye",
    "Côte d'Ivoire":                    "Cote d'Ivoire",
    "Ivory Coast":                      "Cote d'Ivoire",
    "Curaçao":                          "Curacao",
    "Bosnia & Herzegovina":             "Bosnia and Herzegovina",
    "Bosnia-Herzegovina":               "Bosnia and Herzegovina",
    "Bosnia and Herzegovina":           "Bosnia and Herzegovina",
    "DR Congo":                         "DR Congo",
    "Congo DR":                         "DR Congo",
    "Democratic Republic of the Congo": "DR Congo",
    "IR Iran":                          "Iran",
    "Iran":                             "Iran",
}

# ESPN status types. AET/PEN are knockout finishes (extra time / penalty
# shootout): the score is the regulation score (a tie for PEN) and the advancing
# team is in ESPN's per-competitor "winner" flag — without them a finished
# penalty knockout was never marked complete, so its winner was never recorded
# and the bracket could not advance it.
STATUS_COMPLETE = {
    "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
    "STATUS_FINAL_AET", "STATUS_FINAL_PEN",
}
STATUS_IN_PROGRESS = {"STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD"}

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "wc26-tracker/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))

def normalize_team(name):
    if not name: return None
    return TEAM_RENAMES.get(name.strip(), name.strip())

def stage_for_match_number(num):
    if num <= 72:  return "group_stage"
    if num <= 88:  return "round_of_32"
    if num <= 96:  return "round_of_16"
    if num <= 100: return "quarterfinals"
    if num <= 102: return "semifinals"
    if num == 103: return "third_place"
    if num == 104: return "final"
    return None

def find_target_dates():
    """Return UTC dates [-3 days, +2 days] in YYYYMMDD form to query.

    The lookback is widened to 3 days so a final that was MISSED on its match
    day (GitHub throttles the crons heavily — a finished knockout could go
    unscraped for a day or more) is still re-fetched and recorded on a later run.
    """
    now = datetime.now(timezone.utc)
    days = range(-3, 3)  # yesterday-3 .. +2
    return [(now + timedelta(days=d)).strftime("%Y%m%d") for d in days]


def parse_result(sched_a, sched_b, t1, t2, score_1, score_2, status_type, comp1, comp2, kickoff):
    """Build the actual_results record for one finished/in-progress match.

    Pure (no network): given the schedule's team_a/team_b orientation, the two
    ESPN competitors (t1/t2 normalized names, scores, and their full competitor
    dicts), and the status, return the rec dict or None if scores are missing.

    Knockout winners: ESPN exposes a per-competitor "winner" boolean. We record
    rec["winner"] for ANY completed knockout — a regulation win too, not only a
    penalty tie (the old `and sa == sb` gate dropped regulation winners, so the
    bracket could not score/advance a R32 game won 2-1 in normal time). The
    shootout tally is still captured when ESPN provides it.
    """
    # Map ESPN scores to schedule team_a/team_b orientation.
    if t1 == sched_a and t2 == sched_b:
        score_a, score_b = score_1, score_2
        c_a, c_b = comp1, comp2
    elif t1 == sched_b and t2 == sched_a:
        score_a, score_b = score_2, score_1
        c_a, c_b = comp2, comp1
    else:
        return None

    try:
        sa = int(score_a) if score_a is not None else None
        sb = int(score_b) if score_b is not None else None
    except (TypeError, ValueError):
        sa = sb = None
    if sa is None or sb is None:
        return None

    rec = {
        "score_a": sa,
        "score_b": sb,
        "kickoff_utc": kickoff,
        "status": status_type,
    }

    if status_type in STATUS_COMPLETE:
        # Winner: prefer ESPN's per-competitor boolean (set for ALL completed
        # knockouts incl. regulation wins), fall back to comparing the scores.
        wa = bool(c_a.get("winner"))
        wb = bool(c_b.get("winner"))
        if wa:
            rec["winner"] = sched_a
        elif wb:
            rec["winner"] = sched_b
        elif sa > sb:
            rec["winner"] = sched_a
        elif sb > sa:
            rec["winner"] = sched_b
        # Method of victory: AET / penalty shootout when ESPN flags it.
        if status_type == "STATUS_FINAL_PEN":
            rec["method"] = "pens"
        elif status_type == "STATUS_FINAL_AET":
            rec["method"] = "aet"
        # Shootout tally (oriented to schedule team_a/team_b) when present.
        so_a = c_a.get("shootoutScore")
        so_b = c_b.get("shootoutScore")
        if so_a is not None and so_b is not None:
            rec["shootout_a"], rec["shootout_b"] = so_a, so_b
    return rec

def main():
    schedule = json.loads(SCHEDULE_FULL.read_text())
    schedule_by_pair_stage = {}
    for m in schedule:
        a, b, stg = m.get("team_a"), m.get("team_b"), m.get("stage")
        if a and b and stg:
            schedule_by_pair_stage[(frozenset([a, b]), stg)] = m

    actual = json.loads(ACTUAL.read_text()) if ACTUAL.exists() else {
        "group_stage": {}, "round_of_32": {}, "round_of_16": {},
        "quarterfinals": {}, "semifinals": {}, "third_place": {}, "final": {},
        "last_updated": None,
    }
    for k in ("group_stage","round_of_32","round_of_16","quarterfinals","semifinals","third_place","final"):
        actual.setdefault(k, {})

    updated_count = 0
    dates = find_target_dates()
    for d in dates:
        url = f"{ESPN_BASE}?dates={d}"
        try:
            data = fetch(url)
        except Exception as e:
            print(f"  {d}: fetch fail ({e})")
            continue
        events = data.get("events", [])
        for ev in events:
            comps = (ev.get("competitions") or [{}])[0]
            competitors = comps.get("competitors", [])
            if len(competitors) != 2: continue
            t1 = normalize_team(competitors[0].get("team", {}).get("name"))
            t2 = normalize_team(competitors[1].get("team", {}).get("name"))
            if not t1 or not t2: continue
            score_1 = competitors[0].get("score")
            score_2 = competitors[1].get("score")
            status_type = (comps.get("status", {}).get("type", {}) or {}).get("name", "")
            kickoff = ev.get("date")

            # Find matching schedule entry to determine stage
            sched = None
            for stg_try in ("group_stage", "group", "round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final"):
                key = (frozenset([t1, t2]), "group" if stg_try == "group_stage" else stg_try)
                if key in schedule_by_pair_stage:
                    sched = schedule_by_pair_stage[key]
                    break
            if not sched: continue
            stage = stage_for_match_number(sched.get("match_number", 0)) or "group_stage"

            # Map both team names to schedule's team_a / team_b orientation and
            # build the record (winner/method/shootout) via the pure helper.
            sched_a = sched["team_a"]; sched_b = sched["team_b"]
            rec = parse_result(
                sched_a, sched_b, t1, t2, score_1, score_2, status_type,
                competitors[0], competitors[1], kickoff,
            )
            if rec is None:
                continue

            key_match = f"{sched_a}__vs__{sched_b}"
            prev = actual.get(stage, {}).get(key_match)
            if prev != rec:
                actual.setdefault(stage, {})[key_match] = rec
                updated_count += 1

    actual["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    ACTUAL.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n")
    print(f"updated {updated_count} match record(s); wrote {ACTUAL}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
