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
from datetime import datetime, timezone
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
VALID_STAGES = {
    # Legacy short stage names (group_matchups.json, older schedule_full.json).
    "group", "r32", "r16", "qf", "sf", "third_place", "final",
    # New long stage names used since the PDF rebuild — must stay aligned with
    # the keys in actual_results.json (group_stage, round_of_32, round_of_16,
    # quarterfinals, semifinals, third_place, final).
    "group_stage", "round_of_32", "round_of_16", "quarterfinals", "semifinals",
}
# Knockout slot placeholders used in schedule_full.json for matches whose
# participants depend on earlier rounds: "1A"/"2B" (group winner/runner-up),
# "3 ABCDF" (best third-place from a set of groups), "W74" (winner of match 74),
# "L101" (loser of match 101). These are NOT real team names so must skip the
# teams.json lookup.
import re as _re
_KO_SLOT_RE = _re.compile(r"^(\d[A-L]|3 [A-L]{2,6}|W\d{1,3}|L\d{1,3})$")
def _is_knockout_slot(name: str) -> bool:
    return isinstance(name, str) and bool(_KO_SLOT_RE.match(name))
ACTUAL_RESULT_STAGES = (
    "group_stage",
    "round_of_32",
    "round_of_16",
    "quarterfinals",
    "semifinals",
    "third_place",
    "final",
)


# Volatile, fan-facing feeds that must NOT be empty during the tournament. Each
# entry maps a data file to a callable returning its substantive row count
# (ignoring the __meta__ wrapper). A scraper failing silently under
# continue-on-error leaves a fresh-timestamped but empty file — strict mode
# turns that into a hard failure so the cron gate catches it.
TOURNAMENT_START = "2026-06-11"
TOURNAMENT_END = "2026-07-20"

# Knockout stages whose resolved real-team fixtures must be covered by both
# xg.json and knockout_matchups.json (Epic B's data contract).
KNOCKOUT_STAGES = {
    "round_of_32", "round_of_16", "quarterfinals", "semifinals",
    "third_place", "final",
    # legacy short names, in case schedule_full still carries them
    "r32", "r16", "qf", "sf",
}


class Validator:
    def __init__(self, data_dir: Path, *, strict: bool = False,
                 now: str | None = None, check_feed_freshness: bool = True) -> None:
        self.data_dir = data_dir
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self._files: dict[str, Any] = {}
        # Strict mode escalates the tournament-window freshness/coverage checks
        # from warnings to hard errors (the real cron gate). Off by default so
        # the standalone regression command stays green even while a volatile
        # feed is momentarily empty or Epic B's knockout file hasn't shipped.
        self.strict = strict
        self.now = now  # YYYY-MM-DD override for deterministic tests
        self.check_feed_freshness = check_feed_freshness

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def gate(self, msg: str) -> None:
        """Hard error in --strict mode (the cron gate), loud warning otherwise.

        Used for the tournament-window freshness + knockout-coverage checks: the
        default regression command stays green (warn) while the cron pipeline
        runs --strict so a silently-empty feed or missing knockout row fails
        the build with a non-zero exit code."""
        (self.err if self.strict else self.warn)(msg)

    def _in_tournament_window(self) -> bool:
        today = self.now or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return TOURNAMENT_START <= today <= TOURNAMENT_END

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
                if not t:
                    continue
                # Skip teams.json lookup for knockout-slot placeholders.
                if _is_knockout_slot(t):
                    continue
                if team_names and t not in team_names:
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

    def check_consensus_odds(self) -> None:
        v = self.load("consensus_odds.json")
        if not isinstance(v, dict):
            self.err("consensus_odds.json: expected an object")
            return
        if v.get("source") != "api-football":
            self.err("consensus_odds.json: source must be 'api-football'")
        ua = v.get("updated_at")
        if isinstance(ua, str):
            try:
                datetime.fromisoformat(ua.replace("Z", "+00:00"))
            except ValueError:
                self.err(f"consensus_odds.json: updated_at {ua!r} not ISO-8601")
        else:
            self.err("consensus_odds.json: updated_at must be a string")
        mo = v.get("match_outcomes")
        if not isinstance(mo, dict):
            self.err("consensus_odds.json: match_outcomes must be an object")
            return
        for k, rec in mo.items():
            if not isinstance(rec, dict):
                self.err(f"consensus_odds.json.match_outcomes[{k}]: not an object")
                continue
            for key in ("team_a", "team_b", "team_a_prob", "draw_prob", "team_b_prob"):
                if key not in rec:
                    self.err(f"consensus_odds.json.match_outcomes[{k}]: missing {key!r}")

    def check_polymarket_odds(self) -> None:
        """Polymarket per-match odds (overlaid under Kalshi in the UI).

        WARN-ONLY (never self.errors): the feed is KNOWN-DARK until the
        scrape_polymarket_odds cron lands real prices, and the matchup market
        bar degrades gracefully to Kalshi-only when it is empty. Mirrors the
        check_consensus_odds shape (source + updated_at + match_outcomes)."""
        v = self.load("polymarket_odds.json")
        if v is None:
            return  # absent file already handled by the optional-loader fallback
        if not isinstance(v, dict):
            self.warn("polymarket_odds.json: expected an object")
            return
        if v.get("source") != "polymarket":
            self.warn("polymarket_odds.json: source should be 'polymarket'")
        ua = v.get("updated_at")
        if isinstance(ua, str):
            try:
                datetime.fromisoformat(ua.replace("Z", "+00:00"))
            except ValueError:
                self.warn(f"polymarket_odds.json: updated_at {ua!r} not ISO-8601")
        mo = v.get("match_outcomes")
        if mo is None or not isinstance(mo, dict):
            self.warn("polymarket_odds.json: match_outcomes should be an object")
        elif not mo:
            # Empty is the KNOWN-DARK steady state until the cron captures prices.
            self.warn(
                "polymarket_odds.json: match_outcomes is EMPTY (KNOWN-DARK until "
                "the scrape_polymarket_odds cron captures live prices)"
            )

    def check_weather_coverage(self) -> None:
        """Warn (never error) when weather.json has no venue covered.

        weather.json is keyed by venue id -> date -> forecast metrics. Open-Meteo
        can fail under continue-on-error; an all-empty feed is a soft signal, not
        a deploy blocker (the weather section on matchup-detail just renders
        nothing)."""
        v = self.load("weather.json")
        if v is None or not isinstance(v, dict):
            return  # shape already covered by check_dict_or_empty
        covered = [k for k, val in v.items() if k != "__meta__" and isinstance(val, dict) and val]
        if not covered:
            self.warn(
                "weather.json: no venue has any forecast rows — the weather "
                "scraper likely failed (Open-Meteo)"
            )

    def check_form_coverage(self) -> None:
        """Warn (never error) when form.json covers no team.

        form.json is keyed by team name -> list of recent matches. An empty feed
        means the recent-form computation produced nothing; the form section
        degrades gracefully, so this is warn-only."""
        v = self.load("form.json")
        if v is None or not isinstance(v, dict):
            return  # shape already covered by check_dict_or_empty
        covered = [k for k, val in v.items() if k != "__meta__" and isinstance(val, list) and val]
        if not covered:
            self.warn(
                "form.json: no team has any recent-form rows — compute_form_recent "
                "likely produced nothing"
            )

    def check_match_stats_coverage(self) -> None:
        """RJ30.2: warn (never error) on the match_stats.json feed.

        match_stats.json is keyed by `${team_a}__vs__${team_b}` (plus a
        `__meta__` row) -> { team_a, team_b, stats:{a,b}, key_events, updated_at }
        from ESPN boxscores. WARN-ONLY (never self.errors): the feed only fills
        as real matches are played, and the match-stats / momentum components
        render nothing for pairs with no row, so an empty/thin feed is a soft
        signal, not a deploy blocker. Mirrors check_form_coverage / the other
        RJ30 warn-only coverage checks."""
        v = self.load("match_stats.json")
        if v is None:
            return  # absent file already handled by the optional-loader fallback
        if not isinstance(v, dict):
            self.warn("match_stats.json: expected an object")
            return
        rows = [k for k in v if k != "__meta__"]
        if not rows:
            self.warn(
                "match_stats.json: no fixtures covered — scrape_match_stats.py "
                "produced nothing yet (fills as matches are played)"
            )
            return
        for key in rows:
            row = v.get(key)
            if not isinstance(row, dict):
                self.warn(f"match_stats.json[{key!r}]: not an object")
                continue
            stats = row.get("stats")
            has_flat = isinstance(row.get("stats_a"), dict) or isinstance(row.get("stats_b"), dict)
            has_nested = (
                isinstance(stats, dict)
                and (isinstance(stats.get("a"), dict) or isinstance(stats.get("b"), dict))
            )
            if not has_flat and not has_nested:
                self.warn(
                    f"match_stats.json[{key!r}]: no stats.a/stats.b (or flat "
                    f"stats_a/stats_b) — row carries no boxscore"
                )
            ke = row.get("key_events")
            if ke is not None and not isinstance(ke, list):
                self.warn(f"match_stats.json[{key!r}]: key_events must be a list")

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

    # ----- tournament-window freshness + knockout coverage (Epic A) -----

    def check_feed_emptiness(self) -> None:
        """During the tournament, volatile fan-facing feeds must not be empty.

        A scraper failing silently under continue-on-error leaves a
        fresh-timestamped but empty file (RCA bug 6/9). In --strict mode an
        empty volatile feed is a hard failure; otherwise it is a loud warning."""
        if not self.check_feed_freshness or not self._in_tournament_window():
            return

        def rows(name, payload):
            if name == "markets.json" and isinstance(payload, dict):
                return len(payload.get("tournament_winner") or [])
            if isinstance(payload, dict):
                return len([k for k in payload if k != "__meta__"])
            if isinstance(payload, list):
                return len(payload)
            return 0

        # scorers.json has no reliable World Cup upstream (ESPN serves no WC
        # scorer feed); it is KNOWN-DARK, tracked by check_staleness, and must
        # NOT hard-fail the cron gate — warn only, even in --strict. markets.json
        # (Kalshi tournament markets) IS expected populated and stays gated.
        KNOWN_DARK = {"scorers.json"}
        for name in ("scorers.json", "markets.json"):
            payload = self.load(name)
            if payload is None:
                continue
            report = self.warn if name in KNOWN_DARK else self.gate
            if rows(name, payload) == 0:
                report(
                    f"{name}: volatile feed is EMPTY during the tournament "
                    f"window ({TOURNAMENT_START}..{TOURNAMENT_END}) — a scraper "
                    f"likely failed silently"
                )
            # Freshness: an updated_at that predates the tournament is stale.
            ua = (payload.get("__meta__") or {}).get("updated_at") if isinstance(payload, dict) else None
            if isinstance(ua, str):
                try:
                    dt = datetime.fromisoformat(ua.replace("Z", "+00:00"))
                except ValueError:
                    report(f"{name}: __meta__.updated_at {ua!r} not ISO-8601")
                else:
                    if dt.strftime("%Y-%m-%d") < TOURNAMENT_START:
                        report(
                            f"{name}: __meta__.updated_at {ua} predates the "
                            f"tournament — feed is stale"
                        )

    def check_knockout_coverage(self, team_names: set[str]) -> None:
        """Every RESOLVED real-team knockout fixture in schedule_full.json must
        have an xg.json key AND a row in knockout_matchups.json (Epic B's data
        contract). Placeholder slots (1A/W74/3 ABCDF) are skipped — they aren't
        resolved yet. Strict: hard failure; otherwise: loud warning.

        Guarded so a run BEFORE Epic B's knockout_matchups.json exists doesn't
        explode in default mode (it warns); strict mode (the cron gate) fails."""
        sched = self.load("schedule_full.json")
        if not isinstance(sched, list):
            return

        resolved = []
        for row in sched:
            if not isinstance(row, dict):
                continue
            if row.get("stage") not in KNOCKOUT_STAGES:
                continue
            a, b = row.get("team_a"), row.get("team_b")
            # only resolved real-team fixtures (both sides are canonical teams)
            if not a or not b or _is_knockout_slot(a) or _is_knockout_slot(b):
                continue
            if team_names and (a not in team_names or b not in team_names):
                continue
            resolved.append(row)

        if not resolved:
            return  # nothing to cover yet (e.g. group stage / unresolved bracket)

        xg = self.load("xg.json")
        xg_keys = set(xg.keys()) if isinstance(xg, dict) else set()

        km = self.load("knockout_matchups.json")
        if km is None:
            self.gate(
                "knockout_matchups.json: missing, but schedule_full has "
                f"{len(resolved)} resolved knockout fixture(s) requiring rows"
            )
            km_pairs: set[frozenset[str]] = set()
        elif not isinstance(km, list):
            self.err("knockout_matchups.json: expected an array of match rows")
            km_pairs = set()
        else:
            km_pairs = set()
            for idx, r in enumerate(km):
                if not isinstance(r, dict):
                    self.err(f"knockout_matchups.json[{idx}]: not an object")
                    continue
                ta, tb = r.get("team_a"), r.get("team_b")
                if ta and tb:
                    km_pairs.add(frozenset((ta, tb)))

        for row in resolved:
            a, b = row["team_a"], row["team_b"]
            key, rev = f"{a}__vs__{b}", f"{b}__vs__{a}"
            if xg_keys and key not in xg_keys and rev not in xg_keys:
                self.gate(
                    f"xg.json: resolved knockout fixture {a} vs {b} "
                    f"({row.get('match_id')}) has no xg key"
                )
            if frozenset((a, b)) not in km_pairs:
                self.gate(
                    f"knockout_matchups.json: resolved knockout fixture {a} vs "
                    f"{b} ({row.get('match_id')}) has no matchup row"
                )

    def check_past_kickoff_results(self) -> None:
        """Warn when a past-kickoff fixture lacks a FINAL actual_results entry
        (the durable scoring record lagging behind real time)."""
        if not self._in_tournament_window():
            return
        sched = self.load("schedule_full.json")
        results = self.load("actual_results.json")
        if not isinstance(sched, list) or not isinstance(results, dict):
            return
        now_s = (self.now or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        # collect all recorded "TeamA__vs__TeamB" keys across stages
        keys = set()
        for stage, block in results.items():
            if isinstance(block, dict):
                keys |= set(block.keys())
        for row in sched:
            if not isinstance(row, dict):
                continue
            a, b = row.get("team_a"), row.get("team_b")
            if not a or not b or _is_knockout_slot(a) or _is_knockout_slot(b):
                continue
            koff = row.get("kickoff_utc")
            if not isinstance(koff, str):
                continue
            try:
                day = datetime.fromisoformat(koff.replace("Z", "+00:00")).strftime("%Y-%m-%d")
            except ValueError:
                continue
            if day >= now_s:
                continue  # not kicked off yet (by date)
            if f"{a}__vs__{b}" not in keys and f"{b}__vs__{a}" not in keys:
                self.warn(
                    f"actual_results: past-kickoff fixture {a} vs {b} "
                    f"({row.get('match_id')}, {day}) has no recorded result"
                )

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
            "injuries.json",
        ):
            self.check_dict_or_empty(name)
        self.check_xg()
        self.check_fatigue()
        self.check_markets()
        self.check_consensus_odds()
        # RJ30 warn-only feed checks (never block a deploy — the UI degrades
        # gracefully for each when its feed is empty/dark).
        self.check_polymarket_odds()
        self.check_weather_coverage()
        self.check_form_coverage()
        self.check_match_stats_coverage()
        # Epic A: tournament-window freshness + knockout-coverage gates.
        self.check_feed_emptiness()
        self.check_knockout_coverage(team_names)
        self.check_past_kickoff_results()

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
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Escalate tournament-window freshness + knockout-coverage checks "
             "from warnings to hard errors (the cron data gate).",
    )
    ap.add_argument(
        "--now",
        default=None,
        metavar="YYYY-MM-DD",
        help="Override 'today' for the tournament-window checks (tests).",
    )
    ap.add_argument(
        "--skip-feed-freshness",
        action="store_true",
        help="Skip the volatile-feed emptiness/freshness check (keeps the "
             "knockout-coverage gate when feeds are intentionally empty).",
    )
    ap.add_argument(
        "--json-report",
        default=None,
        metavar="PATH",
        help="Additionally dump a machine-readable {generated_at, errors, "
             "warnings, files_checked} report to PATH after running. Purely "
             "additive — exit codes + stderr output are unchanged (the cron "
             "gate + status builder both rely on the default behavior).",
    )
    args = ap.parse_args()
    v = Validator(
        Path(args.data_dir),
        strict=args.strict,
        now=args.now,
        check_feed_freshness=not args.skip_feed_freshness,
    )
    code = v.run()
    if args.json_report:
        # Additive sidecar for the pipeline-status builder — never affects the
        # exit code or stderr (the regression gate stays byte-for-byte stable).
        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "errors": v.errors,
            "warnings": v.warnings,
            "files_checked": len(v._files),
        }
        try:
            p = Path(args.json_report)
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_text(
                json.dumps(report, ensure_ascii=True, indent=2) + "\n",
                encoding="utf-8",
            )
            tmp.replace(p)
        except OSError as e:
            print(f"validate_data.py: could not write --json-report {args.json_report}: {e}",
                  file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
