"""
wc2026 — A World Cup 2026 forecasting model.

Pipeline (Klement-style, but upgraded):
  1. ratings.py      Blend Elo + squad market value + systemic priors (GDP, pop, host)
                     into one team-strength score.
  2. match_model.py  Turn two strengths into expected goals -> bivariate Poisson scoreline.
  3. tournament.py   Monte Carlo the real 48-team / 12-group bracket many times.
  4. evaluation.py   Score the match model with Brier / log-loss vs a baseline.

Everything is data-driven: swap in real ratings, the official draw, and the
official knockout bracket without touching the engine.
"""

from .ratings import build_ratings, RatingConfig
from .match_model import MatchModel, MatchConfig
from .tournament import Tournament, TournamentConfig, load_teams

__all__ = [
    "build_ratings",
    "RatingConfig",
    "MatchModel",
    "MatchConfig",
    "Tournament",
    "TournamentConfig",
    "load_teams",
]
