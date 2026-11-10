"""Compatibility import for :mod:`backend.forecast`."""
import sys
from backend import forecast as _implementation
sys.modules[__name__] = _implementation
