"""Compatibility import for :mod:`backend.bookings`."""
import sys
from backend import bookings as _implementation
sys.modules[__name__] = _implementation
