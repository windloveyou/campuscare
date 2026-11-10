"""Compatibility import for :mod:`backend.mailservice`."""
import sys
from backend import mailservice as _implementation
sys.modules[__name__] = _implementation
