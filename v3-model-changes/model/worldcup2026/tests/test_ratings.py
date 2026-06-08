"""Unit tests for ratings.py — the strength-blend layer."""
import unittest

import numpy as np
import pandas as pd

import _path  # noqa: F401  (sets sys.path)
from wc2026.ratings import build_ratings, RatingConfig, _zscore


def _teams(**overrides):
    base = pd.DataFrame({
        "team": ["A", "B", "C", "D"],
        "elo": [2000.0, 1800.0, 1600.0, 1500.0],
        "market_value": [900.0, 400.0, 150.0, 60.0],
        "gdp_per_capita": [40000.0, 30000.0, 9000.0, 3000.0],
        "population": [60e6, 40e6, 20e6, 5e6],
        "fifa_points": [1800.0, 1600.0, 1450.0, 1380.0],
        "is_host": [0, 0, 0, 0],
    })
    for k, v in overrides.items():
        base[k] = v
    return base


class TestZScore(unittest.TestCase):
    def test_zscore_mean_std(self):
        z = _zscore(pd.Series([1.0, 2.0, 3.0]))
        self.assertAlmostEqual(z.mean(), 0.0, places=9)
        self.assertAlmostEqual(z.std(ddof=0), 1.0, places=9)
        self.assertTrue(z.iloc[0] < z.iloc[1] < z.iloc[2])  # monotone

    def test_zscore_constant_is_zero_not_nan(self):
        z = _zscore(pd.Series([5.0, 5.0, 5.0]))
        self.assertTrue((z == 0).all())
        self.assertFalse(z.isna().any())


class TestBuildRatings(unittest.TestCase):
    def test_returns_team_indexed_standardised(self):
        r = build_ratings(_teams())
        self.assertEqual(list(r.index), ["A", "B", "C", "D"])
        self.assertAlmostEqual(float(r.mean()), 0.0, places=6)
        self.assertAlmostEqual(float(r.std(ddof=0)), 1.0, places=6)

    def test_monotone_in_elo(self):
        r = build_ratings(_teams(), RatingConfig(w_elo=1, w_market=0, w_gdp=0,
                                                 w_population=0, w_fifa=0))
        self.assertTrue(r["A"] > r["B"] > r["C"] > r["D"])

    def test_zero_weight_drops_signal(self):
        cfg = RatingConfig(w_elo=1, w_market=0, w_gdp=0, w_population=0, w_fifa=0)
        r1 = build_ratings(_teams(), cfg)
        # change market_value drastically; with w_market=0 ratings must be identical
        r2 = build_ratings(_teams(market_value=[10.0, 999.0, 1.0, 500.0]), cfg)
        np.testing.assert_allclose(r1.to_numpy(), r2.to_numpy(), atol=1e-12)

    def test_host_bonus_raises_a_team(self):
        cfg = RatingConfig(w_elo=1, w_market=0, w_gdp=0, w_population=0,
                           w_fifa=0, host_bonus=0.5)
        flat = _teams(elo=[1800.0, 1800.0, 1800.0, 1800.0])  # equal on-pitch
        flat["is_host"] = [1, 0, 0, 0]
        r = build_ratings(flat, cfg)
        self.assertTrue(r["A"] > r["B"])  # host edges ahead of identical peers

    def test_missing_optional_column_skipped(self):
        df = _teams().drop(columns=["fifa_points", "gdp_per_capita"])
        r = build_ratings(df)  # should not raise
        self.assertEqual(len(r), 4)

    def test_no_signals_raises(self):
        cfg = RatingConfig(w_elo=0, w_market=0, w_gdp=0, w_population=0,
                           w_fifa=0, w_temperature=0, host_bonus=0)
        with self.assertRaises(ValueError):
            build_ratings(_teams(), cfg)


if __name__ == "__main__":
    unittest.main()
