#!/usr/bin/env python3
"""WC26 Tracker — data integrity validator.

Runs against the JSON files under data/ and exits non-zero with a clear error
list if anything looks off. Designed to be wired into the deploy + daily-update
GitHub Actions workflows so we never publish a broken dataset.

Pure stdlib — runs anywhere Python 3.10+ is available with no extra installs.

Checks (see CHECKS list at bottom of file for the canonical inventory):
  meta.json:        required keys + data_version is ISO-8601 parseable
  teams.json:       48 teams, each with composite + group, group in {A..L}
  group_matchups:   12 groups A..L, 6 matches each, probabilities sum ~100,
                    predicted_winner ∈ {team_a, team_b, 'draw_likely'},
                    both teams exist in teams.json
  players.json:     non-empty list, each player has name + team referencing
                    teams.json, position ∈ {GK, DEF, MID, FWD}
  schedule.json:    has opening_match + usa_opener + final with date strings
  actual_results.json: keys present even when empty (so the loader is happy)

Usage:
  python3 scripts/validate_data.py [--data-dir data]

Exit codes:
  0 = all checks passed
  1 = one or more checks failed (errors printed to stderr)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

EXPECTED_GROUPS = list("ABCDEFGHIJKL")
EXPECTED_TEAM_COUNT = 48
MATCHES_PER_GROUP = 6
TEAMS_PER_GROUP = 4
EXPECTED_VENUE_COUNT = 16
EXPECTED_FULL_SCHEDULE = 104
PROBABILITY_TOLERANCE = 1.0  # % — probabilities sum to within this of 100
VALID_POSITIONS = {"GK", "DEF", "MID", "FWD"}
VALID_STAGES = {"group", "r32", "r16", "qf", "sf", "third_place", "final"}
ACTUAL_RESULT_STAGES = (
    "group_stage",
    "round_of_32",
    "round_of_16",
    "quarterfinals",
    "semifinals",
    "third_place",
    "final",
)


class Validator:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self._files: dict[str, Any] = {}

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def load(self, name: str) -> Any:
        if name in self._files:
            return self._files[name]
        path = self.data_dir / name
        if not path.exists():
            self.err(f"{name}: file is missing at {path}")
            self._files[name] = None
            return None
        try:
            with path.open("r", encoding="utf-8") as f:
                self._files[name] = json.load(f)
        except json.JSONDecodeError as e:
            self.err(f"{name}: invalid JSON ({e})")
            self._files[name] = None
        return self._files[name]

    # ----- per-file checks -----

    def check_meta(self) -> None:
        meta = self.load("meta.json")
        if not isinstance(meta, dict):
            return
        for key in ("tournament", "hosts", "format", "data_version", "model_version"):
            if key not in meta:
                self.err(f"meta.json: missing key {key!r}")
        dv = meta.get("data_version")
        if isinstance(dv, str):
            try:
                # Accept both naive (datetime.fromisoformat) and Z-suffixed.
                datetime.fromisoformat(dv.replace("Z", "+00:00"))
            except ValueError:
                self.err(f"meta.json: data_version {dv!r} is not ISO-8601 parseable")
        else:
            self.err("meta.json: data_version must be a string")

    def check_teams(self) -> set[str]:
        teams = self.load("teams.json")
        if not isinstance(teams, dict):
            return set()
        if len(teams) != EXPECTED_TEAM_COUNT:
            self.err(
                f"teams.json: expected {EXPECTED_TEAM_COUNT} teams, "
                f"got {len(teams)}"
            )
        valid_groups = set(EXPECTED_GROUPS)
        for name, info in teams.items():
            if not isinstance(info, dict):
                self.err(f"teams.json[{name!r}]: not an object")
                continue
            if info.get("group") not in valid_groups:
                self.err(
                    f"teams.json[{name!r}]: group {info.get('group')!r} "
                    f"not in A..L"
                )
            if not isinstance(info.get("composite"), (int, float)):
                self.err(f"teams.json[{name!r}]: composite must be numeric")
            # Light sanity: composite roughly in 0..100 range
            comp = info.get("composite")
            if isinstance(comp, (int, float)) and not (0 <= comp <= 110):
                self.warn(
                    f"teams.json[{name!r}]: composite {comp} outside 0..110"
                )
        return set(teams.keys())

    def check_group_matchups(self, team_names: set[str]) -> None:
        gm = self.load("group_matchups.json")
        if not isinstance(gm, dict):
            return
        got_groups = sorted(gm.keys())
        if got_groups != EXPECTED_GROUPS:
            self.err(
                f"group_matchups.json: expected groups {EXPECTED_GROUPS}, "
                f"got {got_groups}"
            )

        for group, info in gm.items():
            if not isinstance(info, dict):
                self.err(f"group_matchups[{group}]: not an object")
                continue
            teams_in_group = info.get("teams", [])
            if (
                not isinstance(teams_in_group, list)
                or len(teams_in_group) != TEAMS_PER_GROUP
            ):
                self.err(
                    f"group_matchups[{group}].teams: expected "
                    f"{TEAMS_PER_GROUP} teams, got {len(teams_in_group)}"
                )
            for t in teams_in_group:
                if t not in team_names:
                    self.err(
                        f"group_matchups[{group}].teams: {t!r} not in "
                        f"teams.json"
                    )

            matches = info.get("matches", [])
            if not isinstance(matches, list) or len(matches) != MATCHES_PER_GROUP:
                self.err(
                    f"group_matchups[{group}].matches: expected "
                    f"{MATCHES_PER_GROUP} matches, got {len(matches)}"
                )
            seen_pairs: set[frozenset[str]] = set()
            for idx, m in enumerate(matches or []):
                label = f"group_matchups[{group}].matches[{idx}]"
                self._check_match(m, label, team_names)
                pair = frozenset((m.get("team_a"), m.get("team_b")))
                if pair in seen_pairs:
                    self.err(f"{label}: duplicate pairing {sorted(pair)}")
                seen_pairs.add(pair)

    def _check_match(self, m: Any, label: str, team_names: set[str]) -> None:
        if not isinstance(m, dict):
            self.err(f"{label}: not an object")
            return
        for key in (
            "team_a",
            "team_b",
            "probabilities",
            "expected_points",
            "predicted_winner",
            "win_confidence_pct",
        ):
            if key not in m:
                self.err(f"{label}: missing key {key!r}")
                return

        a, b = m["team_a"], m["team_b"]
        for t in (a, b):
            if t not in team_names:
                self.err(f"{label}: team {t!r} not in teams.json")

        pw = m["predicted_winner"]
        if pw not in (a, b, "draw_likely"):
            self.err(
                f"{label}: predicted_winner {pw!r} not in "
                f"{{team_a, team_b, 'draw_likely'}}"
            )

        p = m["probabilities"]
        if not isinstance(p, dict):
            self.err(f"{label}.probabilities: not an object")
        else:
            try:
                s = p["team_a_wins"] + p["draw"] + p["team_b_wins"]
            except (KeyError, TypeError):
                self.err(
                    f"{label}.probabilities: missing "
                    f"team_a_wins/draw/team_b_wins"
                )
            else:
                if abs(s - 100.0) > PROBABILITY_TOLERANCE:
                    self.err(
                        f"{label}.probabilities: sum is {s:.2f}, "
                        f"expected ~100 (±{PROBABILITY_TOLERANCE})"
                    )

        ep = m["expected_points"]
        if not isinstance(ep, dict) or "team_a" not in ep or "team_b" not in ep:
            self.err(f"{label}.expected_points: must include team_a + team_b")
        elif not all(isinstance(ep[k], (int, float)) for k in ("team_a", "team_b")):
            self.err(f"{label}.expected_points: values must be numeric")

        wc = m["win_confidence_pct"]
        if not isinstance(wc, (int, float)) or not (0 <= wc <= 100):
            self.err(f"{label}.win_confidence_pct: must be numeric in 0..100")

    def check_players(self, team_names: set[str]) -> None:
        players = self.load("players.json")
        if not isinstance(players, list) or not players:
            self.err("players.json: expected non-empty list")
            return
        for idx, p in enumerate(players):
            label = f"players.json[{idx}]"
            if not isinstance(p, dict):
                self.err(f"{label}: not an object")
                continue
            if not p.get("name"):
                self.err(f"{label}: missing name")
            t = p.get("team")
            if t not in team_names:
                self.err(f"{label}: team {t!r} not in teams.json")
            pos = p.get("position")
            if pos and pos not in VALID_POSITIONS:
                self.warn(
                    f"{label}: position {pos!r} not in {sorted(VALID_POSITIONS)}"
                )

    def check_schedule(self) -> None:
        s = self.load("schedule.json")
        if not isinstance(s, dict):
            return
        for key in ("opening_match", "usa_opener", "final"):
            if key not in s:
                self.err(f"schedule.json: missing {key}")
                continue
            block = s[key]
            if not isinstance(block, dict):
                self.err(f"schedule.json.{key}: not an object")
                continue
            if "date" not in block:
                self.err(f"schedule.json.{key}: missing date")

    def check_actual_results(self) -> None:
        r = self.load("actual_results.json")
        if not isinstance(r, dict):
            self.err("actual_results.json: not an object")
            return
        for stage in ACTUAL_RESULT_STAGES:
            if stage not in r:
                self.err(f"actual_results.json: missing stage {stage!r}")
            elif not isinstance(r[stage], dict):
                self.err(f"actual_results.json.{stage}: must be an object")

    # ----- Phase 2 checks -----

    def check_venues(self) -> set[str]:
        venues = self.load("venues.json")
        if not isinstance(venues, list):
            self.err("venues.json: expected a list")
            return set()
        if len(venues) != EXPECTED_VENUE_COUNT:
            self.err(
                f"venues.json: expected {EXPECTED_VENUE_COUNT} venues, "
                f"got {len(venues)}"
            )
        ids: set[str] = set()
        required = ("id", "name", "city", "country", "lat", "lon", "capacity", "timezone")
        for idx, v in enumerate(venues):
            if not isinstance(v, dict):
                self.err(f"venues.json[{idx}]: not an object")
                continue
            for k in required:
                if k not in v:
                    self.err(f"venues.json[{idx}]: missing key {k!r}")
            vid = v.get("id")
            if vid in ids:
                self.err(f"venues.json: duplicate id {vid!r}")
            if isinstance(vid, str):
                ids.add(vid)
            if not isinstance(v.get("lat"), (int, float)) or not isinstance(
                v.get("lon"), (int, float)
            ):
                self.err(f"venues.json[{idx}]: lat/lon must be numeric")
        return ids

    def check_schedule_full(self, venue_ids: set[str], team_names: set[str]) -> None:
        s = self.load("schedule_full.json")
        if not isinstance(s, list):
            self.err("schedule_full.json: expected a list")
            return
        if len(s) != EXPECTED_FULL_SCHEDULE:
            self.err(
                f"schedule_full.json: expected {EXPECTED_FULL_SCHEDULE} matches, "
                f"got {len(s)}"
            )
        seen_ids: set[str] = set()
        for idx, row in enumerate(s):
            label = f"schedule_full.json[{idx}]"
            if not isinstance(row, dict):
                self.err(f"{label}: not an object")
                continue
            for k in ("match_id", "stage", "kickoff_utc", "venue_id", "broadcast"):
                if k not in row:
                    self.err(f"{label}: missing key {k!r}")
            mid = row.get("match_id")
            if mid in seen_ids:
                self.err(f"{label}: duplicate match_id {mid!r}")
            seen_ids.add(mid)
            if row.get("stage") not in VALID_STAGES:
                self.err(
                    f"{label}: stage {row.get('stage')!r} not in {sorted(VALID_STAGES)}"
                )
            vid = row.get("venue_id")
            if vid and venue_ids and vid not in venue_ids:
                self.err(f"{label}: venue_id {vid!r} not in venues.json")
            for side in ("team_a", "team_b"):
                t = row.get(side)
                if t and team_names and t not in team_names:
                    self.err(f"{label}: {side} {t!r} not in teams.json")
            br = row.get("broadcast")
            if not isinstance(br, dict) or "us" not in br:
                self.err(f"{label}: broadcast.us missing")
            kickoff = row.get("kickoff_utc")
            if isinstance(kickoff, str):
                try:
                    datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
                except ValueError:
                    self.err(f"{label}: kickoff_utc {kickoff!r} not ISO-8601")

    def check_dict_or_empty(self, name: str) -> None:
        v = self.load(name)
        if v is None:
            return  # already errored in load
        if not isinstance(v, dict):
            self.err(f"{name}: expected an object (got {type(v).__name__})")

    def check_xg(self) -> None:
        v = self.load("xg.json")
        if not isinstance(v, dict):
            self.err("xg.json: expected an object")
            return
        for k, row in v.items():
            if k == "__meta__":
                continue
            if not isinstance(row, dict):
                self.err(f"xg.json[{k}]: not an object")
                continue
            for side in ("team_a_xg", "team_b_xg"):
                if not isinstance(row.get(side), (int, float)):
                    self.err(f"xg.json[{k}].{side}: must be numeric")

    def check_fatigue(self) -> None:
        v = self.load("fatigue.json")
        if not isinstance(v, dict):
            self.err("fatigue.json: expected an object")
            return
        for k, row in v.items():
            if not isinstance(row, dict):
                self.err(f"fatigue.json[{k}]: not an object")
                continue
            for side in ("team_a", "team_b"):
                if side not in row:
                    self.err(f"fatigue.json[{k}]: missing {side}")

    def check_markets(self) -> None:
        v = self.load("markets.json")
        if not isinstance(v, dict):
            self.err("markets.json: expected an object")
            return
        if v.get("source") != "kalshi":
            self.err("markets.json: source must be 'kalshi'")
        ua = v.get("updated_at")
        if isinstance(ua, str):
            try:
                datetime.fromisoformat(ua.replace("Z", "+00:00"))
            except ValueError:
                self.err(f"markets.json: updated_at {ua!r} not ISO-8601")
        else:
            self.err("markets.json: updated_at must be a string")
        tw = v.get("tournament_winner")
        if not isinstance(tw, list):
            self.err("markets.json: tournament_winner must be a list")
        else:
            for idx, row in enumerate(tw):
                label = f"markets.json.tournament_winner[{idx}]"
                if not isinstance(row, dict):
                    self.err(f"{label}: not an object")
                    continue
                for key in ("team", "ticker", "prob_pct", "delta_24h_pp"):
                    if key not in row:
                        self.err(f"{label}: missing key {key!r}")
                if "sparkline" in row and not isinstance(row["sparkline"], list):
                    self.err(f"{label}.sparkline: must be a list")
        mo = v.get("match_outcomes")
        if mo is not None and not isinstance(mo, dict):
            self.err("markets.json: match_outcomes must be an object")
        bm = v.get("biggest_movers")
        if bm is not None and not isinstance(bm, list):
            self.err("markets.json: biggest_movers must be a list")

    # ----- orchestration -----

    def run(self) -> int:
        self.check_meta()
        team_names = self.check_teams()
        self.check_group_matchups(team_names)
        self.check_players(team_names)
        self.check_schedule()
        self.check_actual_results()
        venue_ids = self.check_venues()
        self.check_schedule_full(venue_ids, team_names)
        for name in (
            "lineups.json",
            "referees.json",
            "match_referees.json",
            "h2h.json",
            "form.json",
            "scorers.json",
            "weather.json",
        ):
            self.check_dict_or_empty(name)
        self.check_xg()
        self.check_fatigue()
        self.check_markets()

        if self.warnings:
            for w in self.warnings:
                print(f"  [warn] {w}", file=sys.stderr)
        if self.errors:
            print(
                f"\nvalidate_data.py: FAILED — {len(self.errors)} error(s):",
                file=sys.stderr,
            )
            for e in self.errors:
                print(f"  - {e}", file=sys.stderr)
            return 1
        print(
            f"validate_data.py: OK "
            f"({len(self._files)} file(s) checked, "
            f"{len(self.warnings)} warning(s))"
        )
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--data-dir",
        default=str(Path(__file__).resolve().parent.parent / "data"),
        help="Directory containing the JSON data files (default: ../data)",
    )
    args = ap.parse_args()
    return Validator(Path(args.data_dir)).run()


if __name__ == "__main__":
    sys.exit(main())
