"""Camera intrinsics scaling for depth unprojection.

RGB and LiDAR depth have different resolutions.  To unproject depth we scale
the RGB-resolution intrinsics down to depth resolution:

    sx = depth_width  / image_width
    sy = depth_height / image_height
    fx_d = fx * sx      cx_d = cx * sx
    fy_d = fy * sy      cy_d = cy * sy

This assumes the depth map covers the same field of view as the RGB frame
(true for ARKit ``sceneDepth`` — it is a lower-resolution sampling of the same
camera).  Verified against Apple's ARKit depth sample conventions; confirm on
device during physical validation.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np

from .formats import FormatError


def intrinsic_params(K: np.ndarray) -> Tuple[float, float, float, float]:
    """Return (fx, fy, cx, cy) from a 3x3 intrinsics matrix."""
    K = np.asarray(K, dtype=np.float64)
    if K.shape != (3, 3):
        raise FormatError(f"intrinsics must be 3x3, got {K.shape}")
    return float(K[0, 0]), float(K[1, 1]), float(K[0, 2]), float(K[1, 2])


def scale_intrinsics(
    K: np.ndarray,
    src_size: Tuple[int, int],
    dst_size: Tuple[int, int],
) -> np.ndarray:
    """Scale a 3x3 intrinsics matrix from ``src_size`` to ``dst_size``.

    ``src_size`` / ``dst_size`` are ``(width, height)`` tuples.  Supports
    uniform and non-uniform scaling; principal point scales with the same
    factors.  Raises on non-positive dimensions.
    """
    K = np.asarray(K, dtype=np.float64)
    if K.shape != (3, 3):
        raise FormatError(f"intrinsics must be 3x3, got {K.shape}")
    src_w, src_h = src_size
    dst_w, dst_h = dst_size
    for name, v in (("src_w", src_w), ("src_h", src_h), ("dst_w", dst_w), ("dst_h", dst_h)):
        if v <= 0:
            raise FormatError(f"invalid dimension {name}={v} (must be > 0)")

    sx = dst_w / src_w
    sy = dst_h / src_h
    scaled = K.copy()
    scaled[0, 0] *= sx  # fx
    scaled[0, 2] *= sx  # cx
    scaled[1, 1] *= sy  # fy
    scaled[1, 2] *= sy  # cy
    return scaled
