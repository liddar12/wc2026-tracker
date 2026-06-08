"""
Team strength ratings.

This is the layer Klement gets *partly* right. He uses GDP per capita,
population, FIFA ranking points, temperature and a host bonus. We keep the
slow-moving systemic priors but lead with the signals that actually backtest
well: Elo and squad market value. FIFA ranking is intentionally demoted.

Output: one z-scored strength number per team. Higher = stronger.
Tune the weights by backtesting (see evaluation.py), not by intuition.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np
import pandas as pd


@dataclass
class RatingConfig:
    """Weights for blending raw signals into one strength score.

    Weights are applied to z-scored (standardised) inputs, so they are
    directly comparable. They do not need to sum to 1, but it reads more
    cleanly if the on-pitch + market + systemic weights do.
    """

    w_elo: float = 0.50          # World Football Elo — best single signal
    w_market: float = 0.30       # log squad market value (€m) — current quality
    w_gdp: float = 0.07          # log GDP per capita — Klement's infra proxy
    w_population: float = 0.05   # log population — talent pool size
    w_fifa: float = 0.08         # FIFA ranking points — demoted, kept for continuity
    host_bonus: float = 0.35     # added to final z-score for host nations
    # Optional override: temperature term (Klement uses it). Off by default
    # because modern venue/heat effects are better handled per-match.
    w_temperature: float = 0.0


def _zscore(series: pd.Series) -> pd.Series:
    s = series.astype(float)
    std = s.std(ddof=0)
    if std == 0 or np.isnan(std):
        return pd.Series(np.zeros(len(s)), index=s.index)
    return (s - s.mean()) / std


def build_ratings(teams: pd.DataFrame, config: RatingConfig | None = None) -> pd.Series:
    """Build a single strength rating per team.

    Expected columns in `teams` (missing optional ones are skipped):
        team           str   team name (index after this call)
        elo            float  World Football Elo
        market_value   float  squad market value in €m
        gdp_per_capita float  USD
        population     float  people
        fifa_points    float  FIFA ranking points
        temperature    float  avg home-country temp (C), optional
        is_host        bool/int  1 if USA/MEX/CAN

    Returns a pd.Series indexed by team name, mean ~0, std ~1.
    """
    cfg = config or RatingConfig()
    df = teams.copy()

    contributions: List[pd.Series] = []

    def add(col: str, weight: float, log: bool = False):
        if weight == 0 or col not in df.columns:
            return
        raw = df[col].astype(float)
        if log:
            raw = np.log(raw.clip(lower=1e-9))
        contributions.append(weight * _zscore(raw))

    add("elo", cfg.w_elo)
    add("market_value", cfg.w_market, log=True)
    add("gdp_per_capita", cfg.w_gdp, log=True)
    add("population", cfg.w_population, log=True)
    add("fifa_points", cfg.w_fifa)
    add("temperature", cfg.w_temperature)

    if not contributions:
        raise ValueError("No rating signals available — check your columns/weights.")

    rating = sum(contributions)

    if "is_host" in df.columns and cfg.host_bonus:
        rating = rating + cfg.host_bonus * df["is_host"].astype(float)

    # Re-standardise so downstream beta scaling is interpretable.
    rating = _zscore(rating)
    rating.index = df["team"].values if "team" in df.columns else df.index
    rating.name = "rating"
    return rating
