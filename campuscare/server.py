"""Compatibility launcher for the separated SmartCampus backend."""

import sys

from backend import server as _implementation


if __name__ == "__main__":
    _implementation.main()
else:
    sys.modules[__name__] = _implementation
