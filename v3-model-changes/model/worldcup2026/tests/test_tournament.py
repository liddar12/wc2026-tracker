"""Unit tests for tournament.py — format, qualifiers, seeding, determinism."""
import os
import tempfile
import unittest

import numpy as np
import pandas as pd

import _path  # noqa: F401
from wc2026 import Tournament, TournamentConfig, load_teams
from wc2026.tournament import _seed_bracket_order, ROUND_NAMES


class TestLoadTeams(unittest.TestCase):
    def test_missing_required_columns_raises(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bad.csv")
            pd.DataFrame({"team": ["A", "B"]}).to_csv(p, index=False)  # no 'group'
            with self.assertRaises(ValueError):
                load_teams(p)


class TestConstructorValidation(unittest.TestCase):
    def _df(self, groups):
        teams, gcol = [], []
        for g, k in groups.items():
            for i in range(k):
                teams.append(f"{g}{i}")
                gcol.append(g)
        return pd.DataFrame({"team": teams, "group": gcol})

    def test_group_not_four_raises(self):
        df = self._df({"A": 3, "B": 4})  # group A has 3
        ratings = pd.Series(np.linspace(1, -1, len(df)), index=df["team"])
        with self.assertRaises(ValueError):
            Tournament(df, ratings=ratings)

    def test_missing_rating_raises(self):
        df = self._df({"A": 4, "B": 4})
        ratings = pd.Series([1.0, 0.5], index=["A0", "A1"])  # incomplete
        with self.assertRaises(ValueError):
            Tournament(df, ratings=ratings)


class TestSeeding(unittest.TestCase):
    def test_top_two_seeds_in_opposite_halves(self):
        order = _seed_bracket_order(32)            # bracket position -> seed rank
        pos_seed0 = order.index(0)                 # where the #1 seed sits
        pos_seed1 = order.index(1)                 # where the #2 seed sits
        self.assertLess(pos_seed0, 16)             # top half
        self.assertGreaterEqual(pos_seed1, 16)     # bottom half (meet only in final)

    def test_order_is_permutation(self):
        order = _seed_bracket_order(32)
        self.assertEqual(sorted(order), list(range(32)))


class TestRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.teams = load_teams(_path.DATA)
        cls.res = Tournament(cls.teams).run(TournamentConfig(n_sims=3000, seed=1))
        cls.table = cls.res.table()

    def test_champion_probs_sum_to_one(self):
        self.assertAlmostEqual(self.table["P(Champion)"].sum(), 1.0, places=6)

    def test_survival_monotonic(self):
        for _, row in self.table.iterrows():
            seq = [row[f"P({r})"] for r in ROUND_NAMES]
            self.assertTrue(all(seq[i] >= seq[i + 1] - 1e-9 for i in range(len(seq) - 1)))

    def test_exactly_32_qualifiers_per_sim(self):
        total_r32 = self.res.reach["R32"].sum()
        self.assertEqual(total_r32, 32 * self.res.n_sims)

    def test_stronger_team_more_likely_champion(self):
        t = self.table.set_index("team")["P(Champion)"]
        self.assertGreater(t["Argentina"], t["Cape Verde"])  # extreme gap → robust

    def test_determinism_same_seed(self):
        r2 = Tournament(self.teams).run(TournamentConfig(n_sims=3000, seed=1)).table()
        np.testing.assert_allclose(
            self.table.set_index("team")["P(Champion)"].sort_index().to_numpy(),
            r2.set_index("team")["P(Champion)"].sort_index().to_numpy(),
        )


if __name__ == "__main__":
    unittest.main()
