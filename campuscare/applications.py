"""Compatibility import for :mod:`backend.applications`."""
import sys
from backend import applications as _implementation
sys.modules[__name__] = _implementation
