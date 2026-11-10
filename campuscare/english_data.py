"""Compatibility import for :mod:`backend.english_data`."""
import sys
from backend import english_data as _implementation
sys.modules[__name__] = _implementation
