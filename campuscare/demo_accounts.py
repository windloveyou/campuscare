"""Compatibility import for :mod:`backend.demo_accounts`."""
import sys
from backend import demo_accounts as _implementation
sys.modules[__name__] = _implementation
