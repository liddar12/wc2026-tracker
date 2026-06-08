"""Unit tests for evaluation.py — proper scoring rules + bookmaker baseline."""
import math
import unittest

import numpy as np

import _path  # noqa: F401
from wc2026.evaluation import (
    multiclass_brier,
    multiclass_log_loss,
    baseline_bookmaker,
    evaluate_model,
)
from wc2026.match_model import MatchModel, MatchConfig


class TestScoringRules(unittest.TestCase):
    def test_brier_perfect_is_zero(self):
        probs = np.array([[1.0, 0, 0], [0, 0, 1.0]])
        actual = np.array([0, 2])
        self.assertAlmostEqual(multiclass_brier(probs, actual), 0.0, places=12)

    def test_brier_uniform_value(self):
        probs = np.full((4, 3), 1 / 3)
        actual = np.array([0, 1, 2, 0])
        # per match: (1-1/3)^2 + 2*(1/3)^2 = 6/9
        self.assertAlmostEqual(multiclass_brier(probs, actual), 6 / 9, places=9)

    def test_logloss_perfect_near_zero(self):
        probs = np.array([[1.0, 0, 0], [0, 1.0, 0]])
        actual = np.array([0, 1])
        self.assertAlmostEqual(multiclass_log_loss(probs, actual), 0.0, places=9)

    def test_logloss_uniform_is_ln3(self):
        probs = np.full((3, 3), 1 / 3)
        actual = np.array([0, 1, 2])
        self.assertAlmostEqual(multiclass_log_loss(probs, actual), math.log(3), places=9)

    def test_logloss_lower_when_more_confident_correct(self):
        actual = np.array([0])
        confident = multiclass_log_loss(np.array([[0.8, 0.1, 0.1]]), actual)
        unsure = multiclass_log_loss(np.array([[0.4, 0.3, 0.3]]), actual)
        self.assertLess(confident, unsure)


class TestBookmakerBaseline(unittest.TestCase):
    def test_devig_sums_to_one_and_orders(self):
        probs = baseline_bookmaker([(2.0, 3.0, 4.0)])  # home favourite (lowest odds)
        self.assertAlmostEqual(probs[0].sum(), 1.0, places=12)
        self.assertTrue(probs[0][0] > probs[0][1] > probs[0][2])

    def test_known_devig_values(self):
        probs = baseline_bookmaker([(2.0, 4.0, 4.0)])[0]
        raw = np.array([1 / 2, 1 / 4, 1 / 4])
        np.testing.assert_allclose(probs, raw / raw.sum(), atol=1e-12)


class TestEvaluateModel(unittest.TestCase):
    def test_end_to_end(self):
        model = MatchModel(np.array([2.0, -2.0]), MatchConfig())
        name_to_id = {"Strong": 0, "Weak": 1}
        matches = [("Strong", "Weak", "H"), ("Weak", "Strong", "A")]  # favourite wins both
        out = evaluate_model(model, matches, name_to_id)
        self.assertEqual(out["n"], 2)
        self.assertTrue(0 <= out["brier"] <= 2)
        self.assertGreater(out["log_loss"], 0)


if __name__ == "__main__":
    unittest.main()
