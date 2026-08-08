"""Synthetic in-memory frames + odometry paths for simulators and tests.

Uses the SAME encoders as the on-disk recorder so mirrored sessions are
byte-identical to a local capture.
"""

from __future__ import annotations

import io
import json
import math
from typing import Iterator, List

import numpy as np

from tools.arkit_capture import formats
from tools.arkit_capture.fixtures import default_intrinsics
from tools.live_capture_server.client import Frame


def _jpeg(w=64, h=48, tint=(120, 130, 140)) -> bytes:
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (w, h), tint).save(buf, "JPEG", quality=80)
        return buf.getvalue()
    except Exception:
        return b"\xff\xd8\xff\xe0synthetic\xff\xd9"


def synth_frame(frame_id: int, *, rate_hz: float = 5.0, step_m: float = 0.1,
                depth_value: float = 2.0, depth_w: int = 16, depth_h: int = 12,
                image_w: int = 1920, image_h: int = 1440,
                with_depth: bool = True) -> Frame:
    K = default_intrinsics(image_w, image_h)
    T = np.eye(4)
    T[0, 3] = step_m * frame_id
    depth = np.full((depth_h, depth_w), depth_value, dtype=np.float32)
    conf = np.full((depth_h, depth_w), formats.CONFIDENCE_HIGH, dtype=np.uint8)
    t = frame_id / rate_hz
    meta = {
        "format_version": formats.CAPTURE_FORMAT_VERSION,
        "frame_id": frame_id,
        "timestamp": round(t, 6),
        "session_time": round(t, 6),
        "rgb_path": f"frames/{frame_id:06d}.jpg",
        "depth_path": f"depth/{frame_id:06d}.f32" if with_depth else None,
        "confidence_path": f"confidence/{frame_id:06d}.u8" if with_depth else None,
        "image_width": image_w,
        "image_height": image_h,
        "depth_width": depth_w if with_depth else None,
        "depth_height": depth_h if with_depth else None,
        "depth_format": formats.DEPTH_FORMAT if with_depth else None,
        "depth_units": formats.DEPTH_UNITS if with_depth else None,
        "confidence_format": formats.CONFIDENCE_FORMAT if with_depth else None,
        "depth_status": "available" if with_depth else "unavailable",
        "camera_transform": formats.matrix_to_rows(T),
        "camera_intrinsics": formats.matrix_to_rows(K),
        "tracking_state": "normal",
    }
    return Frame(
        frame_id=frame_id,
        rgb=_jpeg(),
        depth=formats.encode_depth(depth) if with_depth else None,
        confidence=formats.encode_confidence(conf) if with_depth else None,
        metadata=meta,
    )


def synth_frames(n: int, **kw) -> List[Frame]:
    return [synth_frame(i, **kw) for i in range(n)]


# --------------------------------------------------------------------------- #
# Odometry paths
# --------------------------------------------------------------------------- #

def odometry_payload(path: str, i: int, dt: float) -> dict:
    """Generate a pose for the given synthetic path at step i (dt seconds/step)."""
    t = i * dt
    if path == "stationary":
        x, y, yaw = 0.0, 0.0, 0.0
    elif path == "straight":
        x, y, yaw = 0.5 * t, 0.0, 0.0
    elif path == "square":
        side = 2.0
        leg = int((t / 2.0) % 4)
        frac = (t / 2.0) % 1.0
        if leg == 0:
            x, y, yaw = side * frac, 0.0, 0.0
        elif leg == 1:
            x, y, yaw = side, side * frac, math.pi / 2
        elif leg == 2:
            x, y, yaw = side * (1 - frac), side, math.pi
        else:
            x, y, yaw = 0.0, side * (1 - frac), -math.pi / 2
    elif path == "circle":
        r = 1.0
        w = 0.5
        x, y, yaw = r * math.cos(w * t), r * math.sin(w * t), w * t
    elif path == "random":
        # deterministic pseudo-random smooth path (index-seeded, no Math.random)
        x = math.sin(0.3 * t) + 0.2 * math.sin(1.7 * t)
        y = math.cos(0.25 * t) + 0.15 * math.cos(2.1 * t)
        yaw = math.atan2(math.cos(0.25 * t), math.sin(0.3 * t))
    else:
        raise ValueError(f"unknown path {path}")
    return {
        "x_m": round(x, 6), "y_m": round(y, 6), "yaw_rad": round(yaw, 6),
        "linear_velocity": None, "angular_velocity": None,
    }
