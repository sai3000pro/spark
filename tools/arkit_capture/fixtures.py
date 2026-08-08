"""Synthetic capture-session generator for tests and integration.

Produces an on-disk capture directory conforming to the format contract, with
a *known* trajectory and a *known* constant-depth plane so downstream results
can be asserted exactly.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import List, Optional

import numpy as np

from . import formats
from .formats import (
    CAPTURE_FORMAT_VERSION,
    CONFIDENCE_HIGH,
    encode_confidence,
    encode_depth,
    matrix_to_rows,
)


def _identity_transform(tx: float, ty: float, tz: float) -> np.ndarray:
    T = np.eye(4, dtype=np.float64)
    T[0, 3] = tx
    T[1, 3] = ty
    T[2, 3] = tz
    return T


def default_intrinsics(image_w: int = 1920, image_h: int = 1440) -> np.ndarray:
    K = np.array(
        [[1000.0, 0.0, image_w / 2.0],
         [0.0, 1000.0, image_h / 2.0],
         [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    return K


def _write_rgb(path: Path, w: int = 64, h: int = 48) -> None:
    try:
        from PIL import Image
        img = Image.new("RGB", (w, h), (120, 130, 140))
        img.save(path, "JPEG", quality=80)
    except Exception:
        # Fallback: a tiny valid-ish placeholder so file existence checks pass.
        path.write_bytes(b"\xff\xd8\xff\xe0placeholder\xff\xd9")


def make_synthetic_session(
    root: Path,
    *,
    n_frames: int = 3,
    rate_hz: float = 5.0,
    step_m: float = 0.5,
    depth_value: float = 2.0,
    depth_w: int = 8,
    depth_h: int = 6,
    image_w: int = 1920,
    image_h: int = 1440,
    session_id: str = "test-session-0001",
    with_depth: bool = True,
    missing_depth_frames: Optional[List[int]] = None,
) -> Path:
    """Create a synthetic capture at ``root``.

    Camera moves +``step_m`` along world X each frame (identity rotation).
    Depth is a constant plane at ``depth_value`` meters, confidence all HIGH.
    Returns ``root``.
    """
    root = Path(root)
    (root / "frames").mkdir(parents=True, exist_ok=True)
    (root / "depth").mkdir(parents=True, exist_ok=True)
    (root / "confidence").mkdir(parents=True, exist_ok=True)
    (root / "diagnostics").mkdir(parents=True, exist_ok=True)

    missing = set(missing_depth_frames or [])
    K = default_intrinsics(image_w, image_h)
    dt = 1.0 / rate_hz

    session = formats.SessionInfo(
        session_id=session_id,
        format_version=CAPTURE_FORMAT_VERSION,
        created_at="2026-01-01T00:00:00Z",
        device_model="synthetic",
        app_version="test",
        sample_rate_hz=rate_hz,
    )
    with open(root / "session.json", "w", encoding="utf-8") as fh:
        json.dump(formats.session_to_dict(session), fh, indent=2)

    depth = np.full((depth_h, depth_w), depth_value, dtype=np.float32)
    conf = np.full((depth_h, depth_w), CONFIDENCE_HIGH, dtype=np.uint8)

    with open(root / "metadata.jsonl", "w", encoding="utf-8") as meta:
        for i in range(n_frames):
            fid = i
            name = f"{fid:06d}"
            rgb_rel = f"frames/{name}.jpg"
            _write_rgb(root / rgb_rel)

            has_depth = with_depth and fid not in missing
            depth_rel = conf_rel = None
            if has_depth:
                depth_rel = f"depth/{name}.f32"
                conf_rel = f"confidence/{name}.u8"
                (root / depth_rel).write_bytes(encode_depth(depth))
                (root / conf_rel).write_bytes(encode_confidence(conf))

            T = _identity_transform(step_m * i, 0.0, 0.0)
            rec = {
                "format_version": CAPTURE_FORMAT_VERSION,
                "frame_id": fid,
                "timestamp": round(i * dt, 6),
                "session_time": round(i * dt, 6),
                "rgb_path": rgb_rel,
                "depth_path": depth_rel,
                "confidence_path": conf_rel,
                "image_width": image_w,
                "image_height": image_h,
                "depth_width": depth_w if has_depth else None,
                "depth_height": depth_h if has_depth else None,
                "depth_format": formats.DEPTH_FORMAT if has_depth else None,
                "depth_units": formats.DEPTH_UNITS if has_depth else None,
                "confidence_format": formats.CONFIDENCE_FORMAT if has_depth else None,
                "depth_status": "available" if has_depth else "unavailable",
                "camera_transform": matrix_to_rows(T),
                "camera_intrinsics": matrix_to_rows(K),
                "tracking_state": "normal",
                "tracking_reason": None,
            }
            meta.write(json.dumps(rec) + "\n")

    return root
