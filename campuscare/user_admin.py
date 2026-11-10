"""Compatibility import for :mod:`backend.user_admin`."""
import sys
from backend import user_admin as _implementation
sys.modules[__name__] = _implementation
