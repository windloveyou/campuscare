"""Compatibility import for :mod:`backend.admin_services`."""
import sys
from backend import admin_services as _implementation
sys.modules[__name__] = _implementation
