"""
Evaluation — the discipline Klement never publishes.

Don't judge the model on "did it pick the champion." Judge the *match-level*
probabilities with proper scoring rules and compare them to a baseline
(bookmaker odds or a pure-Elo model). If you can't beat the baseline, your
extra variables aren't earning their place.

Provide results as a list of (home, away, outcome) where outcome is one of
"H", "D", "A". Probabilities come from MatchModel.outcome_probs.
"""

from __future__ import annotations

from typing import List, Sequence, Tuple

import numpy as np

OUTCOMES = ["H", "D", "A"]


def multiclass_brier(probs: np.ndarray, actual_idx: np.ndarray) -> float:
    """Mean Brier score over 3-class outcomes. Lower is better (0..2)."""
    onehot = np.zeros_like(probs)
    onehot[np.arange(len(actual_idx)), actual_idx] = 1.0
    return float(np.mean(np.sum((probs - onehot) ** 2, axis=1)))


def multiclass_log_loss(probs: np.ndarray, actual_idx: np.ndarray, eps: float = 1e-12) -> float:
    """Mean log-loss (cross-entropy). Lower is better."""
    p = np.clip(probs[np.arange(len(actual_idx)), actual_idx], eps, 1.0)
    return float(-np.mean(np.log(p)))


def evaluate_model(model, matches: Sequence[Tuple[str, str, str]], name_to_id: dict):
    """Score `model` over a list of (home, away, outcome) tuples.

    Returns dict with brier, log_loss, n.
    """
    probs = []
    actual = []
    for home, away, result in matches:
        ph, pd_, pa = model.outcome_probs(name_to_id[home], name_to_id[away])
        probs.append([ph, pd_, pa])
        actual.append(OUTCOMES.index(result))
    probs = np.array(probs)
    actual = np.array(actual)
    return {
        "brier": multiclass_brier(probs, actual),
        "log_loss": multiclass_log_loss(probs, actual),
        "n": len(matches),
    }


def baseline_bookmaker(odds: Sequence[Tuple[float, float, float]]):
    """Convert decimal odds (home, draw, away) to de-vigged probabilities.

    Use this as the benchmark your model must beat.
    """
    probs = []
    for h, d, a in odds:
        raw = np.array([1 / h, 1 / d, 1 / a])
        probs.append(raw / raw.sum())
    return np.array(probs)
