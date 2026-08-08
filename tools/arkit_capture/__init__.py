"""Gauzensplat ARKit capture tooling (Mac-side).

Pure-Python (numpy + Pillow) readers, math, and validators for the
iPhone LiDAR capture format.  No ML / reconstruction dependencies.

The capture format contract lives in :mod:`formats`.  See FORMAT_SPEC.md
for the human-readable specification.
"""

from . import formats  # noqa: F401

__all__ = ["formats"]
