"""Per-frame image sharpness (variance-of-Laplacian).

Motion blur is the main RGB quality problem for hand-held capture. Higher score
= sharper. Used to flag blurry frames and pick sharp keyframes for downstream
reconstruction — the phone stores every frame, selection happens here.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import numpy as np


def laplacian_variance(gray: np.ndarray) -> float:
    """Variance of the 4-neighbour Laplacian of a grayscale image."""
    g = np.asarray(gray, dtype=np.float64)
    if g.ndim != 2 or g.shape[0] < 3 or g.shape[1] < 3:
        return 0.0
    lap = (-4.0 * g
           + np.roll(g, 1, 0) + np.roll(g, -1, 0)
           + np.roll(g, 1, 1) + np.roll(g, -1, 1))
    return float(lap[1:-1, 1:-1].var())


def frame_sharpness(image_path: Path, max_width: int = 320) -> Optional[float]:
    """Sharpness of a JPEG frame. Downsamples for speed. None if unreadable."""
    try:
        from PIL import Image
        with Image.open(image_path) as im:
            im = im.convert("L")
            if im.width > max_width:
                h = max(1, int(im.height * max_width / im.width))
                im = im.resize((max_width, h))
            arr = np.asarray(im)
    except Exception:
        return None
    return laplacian_variance(arr)


def classify(scores: List[float], threshold: Optional[float] = None,
             rel_factor: float = 0.5):
    """Return (threshold, is_sharp_mask). Default threshold = rel_factor*median."""
    arr = np.array([s for s in scores if s is not None], dtype=np.float64)
    if arr.size == 0:
        return 0.0, []
    thr = threshold if threshold is not None else float(np.median(arr) * rel_factor)
    mask = [(s is not None and s >= thr) for s in scores]
    return thr, mask
