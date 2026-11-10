"""Compatibility import for :mod:`backend.prereview`."""
import sys
from backend import prereview as _implementation
sys.modules[__name__] = _implementation
