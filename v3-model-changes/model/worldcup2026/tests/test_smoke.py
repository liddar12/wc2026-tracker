"""Minimal smoke tests — run with: python -m pytest -q  (or python tests/test_smoke.py)."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from wc2026 import Tournament, TournamentConfig, load_teams
from wc2026.match_model import MatchModel, MatchConfig


def test_probs_sum_to_one():
    m = MatchModel(np.array([1.0, -1.0]), MatchConfig())
    ph, pd_, pa = m.outcome_probs(0, 1)
    assert abs(ph + pd_ + pa - 1.0) < 1e-9
    assert ph > pa  # stronger team (id 0) favoured


def test_simulation_probabilities_valid():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    teams = load_teams(os.path.join(here, "data", "teams_2026.csv"))
    t = Tournament(teams)
    res = t.run(TournamentConfig(n_sims=2000, seed=1))
    table = res.table()
    champ = table["P(Champion)"].sum()
    assert abs(champ - 1.0) < 1e-6, f"champion probs sum to {champ}"
    # monotonic: P(reach round) should not increase as rounds advance
    for _, row in table.iterrows():
        seq = [row[f"P({r})"] for r in ["R32", "R16", "QF", "SF", "Final", "Champion"]]
        assert all(seq[i] >= seq[i + 1] - 1e-9 for i in range(len(seq) - 1))
    print("OK — champion probs sum to 1, monotonic survival.")


if __name__ == "__main__":
    test_probs_sum_to_one()
    test_simulation_probabilities_valid()
    print("All smoke tests passed.")
