"""
Monte Carlo simulator for the 48-team / 12-group World Cup 2026 format.

Format implemented
------------------
* 12 groups (A-L) of 4 teams, single round-robin (6 matches/group).
* Group ranking: points -> goal difference -> goals for -> random tiebreak.
* Qualifiers: top 2 from each group (24) + 8 best third-placed teams (32).
* Knockout: Round of 32 -> R16 -> QF -> SF -> Final (single elimination).

The whole thing is vectorised over `n_sims`: every team-id is an array of
length n_sims, so one call simulates tens of thousands of tournaments.

Bracket note
------------
The *exact* official R32 slotting (which group's 3rd goes where) is intricate
and changes with which thirds qualify. By default we use `bracket="reseed"`:
the 32 qualifiers are seeded 1..32 by strength into a standard bracket so the
draw is balanced and champion odds are meaningful. To reproduce a specific
official bracket, set bracket="fixed" and supply `fixed_bracket` (see README).
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .match_model import MatchModel, MatchConfig
from .ratings import build_ratings, RatingConfig

ROUND_NAMES = ["R32", "R16", "QF", "SF", "Final", "Champion"]


def load_teams(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    required = {"team", "group"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"teams file missing columns: {missing}")
    return df


@dataclass
class TournamentConfig:
    n_sims: int = 20000
    seed: int = 42
    bracket: str = "reseed"               # "reseed" or "fixed"
    fixed_bracket: Optional[List] = None  # list of 32 (group, position) slot specs


# canonical 32-team seeding order so seeds 1 & 2 can only meet in the final
def _seed_bracket_order(n: int = 32) -> List[int]:
    order = [1, 2]
    while len(order) < n:
        size = len(order) * 2
        nxt = []
        for s in order:
            nxt.append(s)
            nxt.append(size + 1 - s)
        order = nxt
    return [s - 1 for s in order]  # 0-indexed seed ranks


class Tournament:
    def __init__(
        self,
        teams: pd.DataFrame,
        rating_config: RatingConfig | None = None,
        match_config: MatchConfig | None = None,
        ratings: pd.Series | None = None,
    ):
        self.teams = teams.reset_index(drop=True)
        self.team_names = self.teams["team"].tolist()
        self.n_teams = len(self.team_names)
        self.name_to_id = {n: i for i, n in enumerate(self.team_names)}

        if ratings is None:
            ratings = build_ratings(self.teams, rating_config)
        # align ratings to team order
        self.rating_series = ratings.reindex(self.team_names)
        if self.rating_series.isna().any():
            raise ValueError("Ratings missing for some teams.")
        self.ratings = self.rating_series.to_numpy()

        self.model = MatchModel(self.ratings, match_config)

        # group label -> list of team ids
        self.groups: Dict[str, List[int]] = {}
        for g, sub in self.teams.groupby("group"):
            self.groups[g] = [self.name_to_id[t] for t in sub["team"]]
        for g, ids in self.groups.items():
            if len(ids) != 4:
                raise ValueError(f"Group {g} has {len(ids)} teams (expected 4).")

    # ------------------------------------------------------------------
    def run(self, config: TournamentConfig | None = None) -> "SimResult":
        cfg = config or TournamentConfig()
        rng = np.random.default_rng(cfg.seed)
        n = cfg.n_sims

        # reach[round_index] -> count array over team ids
        reach = {r: np.zeros(self.n_teams, dtype=np.int64) for r in ROUND_NAMES}

        winners, runners, thirds, third_keys = self._simulate_groups(n, rng)

        # qualifiers: 24 group-position teams + 8 best thirds
        # best thirds: rank the 12 third keys, take top 8 per sim
        third_ids = np.stack(thirds, axis=1)          # [n, 12]
        third_k = np.stack(third_keys, axis=1)        # [n, 12]
        order = np.argsort(-third_k, axis=1)
        best8_pos = order[:, :8]                      # [n, 8]
        best_thirds = np.take_along_axis(third_ids, best8_pos, axis=1)  # [n, 8]

        qualifiers = np.concatenate(
            [np.stack(winners, axis=1), np.stack(runners, axis=1), best_thirds],
            axis=1,
        )  # [n, 32]

        # tally R32 reach
        for col in range(qualifiers.shape[1]):
            np.add.at(reach["R32"], qualifiers[:, col], 1)

        slots = self._seed_into_bracket(qualifiers, n)

        # knockout rounds
        round_for_size = {32: "R16", 16: "QF", 8: "SF", 4: "Final", 2: "Champion"}
        while slots.shape[1] > 1:
            nxt = self._play_round(slots, rng)
            advanced_round = round_for_size[slots.shape[1]]
            for col in range(nxt.shape[1]):
                np.add.at(reach[advanced_round], nxt[:, col], 1)
            slots = nxt

        return SimResult(self.team_names, reach, n, self.rating_series)

    # ------------------------------------------------------------------
    def _simulate_groups(self, n, rng):
        winners, runners, thirds, third_keys = [], [], [], []
        for g in sorted(self.groups):
            ids = np.array(self.groups[g])
            pts = np.zeros((n, 4))
            gd = np.zeros((n, 4))
            gf = np.zeros((n, 4))
            for i, j in combinations(range(4), 2):
                a = np.full(n, ids[i])
                b = np.full(n, ids[j])
                ga, gb = self.model.sample_goals(a, b, rng)
                a_win = ga > gb
                b_win = gb > ga
                draw = ga == gb
                pts[:, i] += 3 * a_win + draw
                pts[:, j] += 3 * b_win + draw
                gd[:, i] += ga - gb
                gd[:, j] += gb - ga
                gf[:, i] += ga
                gf[:, j] += gb
            # ranking key: pts dominate, then GD, then GF, then tiny noise
            key = pts * 1e6 + gd * 1e3 + gf + rng.random((n, 4)) * 1e-3
            order = np.argsort(-key, axis=1)  # [n,4] positions into ids
            pos1 = order[:, 0]
            pos2 = order[:, 1]
            pos3 = order[:, 2]
            winners.append(ids[pos1])
            runners.append(ids[pos2])
            thirds.append(ids[pos3])
            third_keys.append(np.take_along_axis(key, pos3[:, None], axis=1)[:, 0])
        return winners, runners, thirds, third_keys

    def _seed_into_bracket(self, qualifiers, n):
        # seed by strength so the bracket is balanced (reseed mode)
        q_ratings = self.ratings[qualifiers]            # [n, 32]
        seed_order = np.argsort(-q_ratings, axis=1)     # strongest first
        seeded = np.take_along_axis(qualifiers, seed_order, axis=1)  # seeds 1..32
        bracket_positions = _seed_bracket_order(32)     # where each seed sits
        slots = np.empty_like(seeded)
        slots[:, bracket_positions] = seeded
        return slots

    def _play_round(self, slots, rng):
        n, m = slots.shape
        nxt = np.empty((n, m // 2), dtype=slots.dtype)
        for k in range(0, m, 2):
            a = slots[:, k]
            b = slots[:, k + 1]
            ga, gb = self.model.sample_goals(a, b, rng)
            nxt[:, k // 2] = self.model.knockout_winner(a, b, ga, gb, rng)
        return nxt


class SimResult:
    def __init__(self, team_names, reach, n_sims, ratings):
        self.team_names = team_names
        self.reach = reach
        self.n_sims = n_sims
        self.ratings = ratings

    def table(self) -> pd.DataFrame:
        data = {"team": self.team_names, "rating": self.ratings.to_numpy()}
        for r in ROUND_NAMES:
            data[f"P({r})"] = self.reach[r] / self.n_sims
        df = pd.DataFrame(data).sort_values("P(Champion)", ascending=False)
        return df.reset_index(drop=True)
