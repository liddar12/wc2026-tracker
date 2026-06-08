"""
Match model: two team-strength ratings -> a scoreline.

Design
------
Expected goals come from the rating *difference* (the "supremacy"):

    supremacy = beta * (rating_A - rating_B)
    lambda_A  = exp(mu + supremacy / 2)
    lambda_B  = exp(mu - supremacy / 2)

`mu` sets the baseline scoring rate for an even match; `beta` controls how
much a rating edge converts into goals. Both are tunable / fittable.

Goals are sampled from a **bivariate Poisson** (shared component `lambda3`)
so the two scorelines are mildly positively correlated and draws behave
realistically — the simulator analogue of the Dixon-Coles low-score fix.

This module is fully vectorised: pass arrays of ratings and get arrays of
goals back, which is what makes 50k tournament simulations fast.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class MatchConfig:
    mu: float = 0.30        # log baseline goals per team (~exp(0.30)=1.35)
    beta: float = 0.70      # rating-difference -> goal-supremacy scaling
    lambda3: float = 0.12   # bivariate-Poisson shared component (correlation)
    # Penalty-shootout edge per unit of rating difference (knockouts).
    pen_beta: float = 0.35
    max_goals: int = 12     # truncation for the analytic probability grid


class MatchModel:
    def __init__(self, ratings: np.ndarray, config: MatchConfig | None = None):
        """`ratings` is a 1-D array indexed by integer team id."""
        self.ratings = np.asarray(ratings, dtype=float)
        self.cfg = config or MatchConfig()

    # ---- expected goals -------------------------------------------------
    def lambdas(self, a: np.ndarray, b: np.ndarray):
        """Expected goals for team-id arrays a, b. Returns (lamA, lamB)."""
        ra = self.ratings[a]
        rb = self.ratings[b]
        sup = self.cfg.beta * (ra - rb)
        lam_a = np.exp(self.cfg.mu + sup / 2.0)
        lam_b = np.exp(self.cfg.mu - sup / 2.0)
        return lam_a, lam_b

    # ---- sampling (for Monte Carlo) ------------------------------------
    def sample_goals(self, a: np.ndarray, b: np.ndarray, rng: np.random.Generator):
        """Sample correlated scorelines via a bivariate Poisson."""
        lam_a, lam_b = self.lambdas(a, b)
        l3 = self.cfg.lambda3
        base_a = np.clip(lam_a - l3, 1e-6, None)
        base_b = np.clip(lam_b - l3, 1e-6, None)
        shared = rng.poisson(l3, size=a.shape)
        ga = rng.poisson(base_a) + shared
        gb = rng.poisson(base_b) + shared
        return ga, gb

    def knockout_winner(self, a, b, ga, gb, rng):
        """Resolve a knockout match. Ties go to a rating-weighted shootout."""
        winner = np.where(ga > gb, a, b)
        tie = ga == gb
        if np.any(tie):
            ra = self.ratings[a[tie]]
            rb = self.ratings[b[tie]]
            p_a = 1.0 / (1.0 + np.exp(-self.cfg.pen_beta * (ra - rb)))
            a_wins = rng.random(tie.sum()) < p_a
            winner[tie] = np.where(a_wins, a[tie], b[tie])
        return winner

    # ---- analytic probabilities (for evaluation / baselines) -----------
    def outcome_probs(self, a: int, b: int):
        """Analytic P(home win), P(draw), P(away win) for a single pair.

        Uses an independent-Poisson grid (good enough for evaluation;
        the shared component shifts results only marginally).
        """
        lam_a, lam_b = self.lambdas(np.array([a]), np.array([b]))
        lam_a, lam_b = float(lam_a[0]), float(lam_b[0])
        n = self.cfg.max_goals + 1
        ks = np.arange(n)
        pa = _poisson_pmf(ks, lam_a)
        pb = _poisson_pmf(ks, lam_b)
        joint = np.outer(pa, pb)  # joint[i, j] = P(A=i, B=j)
        p_home = np.tril(joint, -1).sum()
        p_draw = np.trace(joint)
        p_away = np.triu(joint, 1).sum()
        total = p_home + p_draw + p_away
        return p_home / total, p_draw / total, p_away / total


def _poisson_pmf(k: np.ndarray, lam: float) -> np.ndarray:
    from math import lgamma
    logp = k * np.log(lam) - lam - np.array([lgamma(int(x) + 1) for x in k])
    return np.exp(logp)
