"""Compatibility import for :mod:`backend.accounts`."""
import sys
from backend import accounts as _implementation
sys.modules[__name__] = _implementation
