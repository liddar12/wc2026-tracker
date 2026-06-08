"""Unit tests for match_model.py — bivariate-Poisson scoreline + 1X2."""
import unittest

import numpy as np

import _path  # noqa: F401
from wc2026.match_model import MatchModel, MatchConfig


class TestOutcomeProbs(unittest.TestCase):
    def setUp(self):
        # ids: 0 strong, 1 mid, 2 weak
        self.m = MatchModel(np.array([2.0, 0.0, -2.0]), MatchConfig())

    def test_probs_sum_to_one(self):
        for a, b in [(0, 1), (1, 0), (0, 2), (1, 1)]:
            ph, pd_, pa = self.m.outcome_probs(a, b)
            self.assertAlmostEqual(ph + pd_ + pa, 1.0, places=9)
            self.assertTrue(min(ph, pd_, pa) >= 0)

    def test_stronger_team_favoured(self):
        ph, _, pa = self.m.outcome_probs(0, 2)
        self.assertGreater(ph, pa)

    def test_equal_strength_symmetric(self):
        ph, pd_, pa = self.m.outcome_probs(1, 1)  # equal ratings
        self.assertAlmostEqual(ph, pa, places=9)

    def test_swap_symmetry(self):
        ph, pd_, pa = self.m.outcome_probs(0, 2)
        ph2, pd2, pa2 = self.m.outcome_probs(2, 0)
        self.assertAlmostEqual(ph, pa2, places=9)
        self.assertAlmostEqual(pa, ph2, places=9)
        self.assertAlmostEqual(pd_, pd2, places=9)

    def test_monotone_in_gap(self):
        # bigger rating gap -> higher favourite win prob
        ph_small, _, _ = self.m.outcome_probs(1, 2)  # gap 2
        ph_big, _, _ = self.m.outcome_probs(0, 2)    # gap 4
        self.assertGreater(ph_big, ph_small)


class TestLambdas(unittest.TestCase):
    def test_even_match_baseline(self):
        m = MatchModel(np.array([0.0, 0.0]), MatchConfig(mu=0.30, beta=0.70))
        la, lb = m.lambdas(np.array([0]), np.array([1]))
        self.assertAlmostEqual(float(la[0]), np.exp(0.30), places=9)
        self.assertAlmostEqual(float(lb[0]), np.exp(0.30), places=9)

    def test_supremacy_raises_favourite_lambda(self):
        m = MatchModel(np.array([1.0, -1.0]), MatchConfig(mu=0.30, beta=0.70))
        la, lb = m.lambdas(np.array([0]), np.array([1]))
        self.assertGreater(la[0], lb[0])  # stronger expects more goals


class TestSampling(unittest.TestCase):
    def test_shape_nonneg_int(self):
        m = MatchModel(np.array([1.0, -1.0]))
        rng = np.random.default_rng(0)
        a = np.zeros(500, dtype=int)
        b = np.ones(500, dtype=int)
        ga, gb = m.sample_goals(a, b, rng)
        self.assertEqual(ga.shape, (500,))
        self.assertTrue((ga >= 0).all() and (gb >= 0).all())
        self.assertTrue(np.issubdtype(ga.dtype, np.integer))

    def test_reproducible_with_seed(self):
        m = MatchModel(np.array([1.0, -1.0]))
        a, b = np.zeros(50, dtype=int), np.ones(50, dtype=int)
        g1 = m.sample_goals(a, b, np.random.default_rng(7))
        g2 = m.sample_goals(a, b, np.random.default_rng(7))
        np.testing.assert_array_equal(g1[0], g2[0])
        np.testing.assert_array_equal(g1[1], g2[1])

    def test_favourite_scores_more_on_average(self):
        m = MatchModel(np.array([2.0, -2.0]))
        rng = np.random.default_rng(1)
        a, b = np.zeros(20000, dtype=int), np.ones(20000, dtype=int)
        ga, gb = m.sample_goals(a, b, rng)
        self.assertGreater(ga.mean(), gb.mean())


class TestKnockout(unittest.TestCase):
    def test_no_ties_remain(self):
        m = MatchModel(np.array([1.0, -1.0]))
        rng = np.random.default_rng(2)
        a, b = np.zeros(1000, dtype=int), np.ones(1000, dtype=int)
        ga = gb = np.zeros(1000, dtype=int)  # force all ties -> shootout
        w = m.knockout_winner(a, b, ga, gb, rng)
        self.assertTrue(np.isin(w, [0, 1]).all())

    def test_stronger_wins_most_shootouts(self):
        m = MatchModel(np.array([10.0, -10.0]), MatchConfig(pen_beta=0.35))
        rng = np.random.default_rng(3)
        n = 4000
        a, b = np.zeros(n, dtype=int), np.ones(n, dtype=int)
        ga = gb = np.zeros(n, dtype=int)
        w = m.knockout_winner(a, b, ga, gb, rng)
        self.assertGreater((w == 0).mean(), 0.9)  # huge edge -> almost always wins


if __name__ == "__main__":
    unittest.main()
