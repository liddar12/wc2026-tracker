"""Shared: put the package root (worldcup2026/) on sys.path for test imports."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
DATA = os.path.join(ROOT, "data", "teams_2026.csv")
