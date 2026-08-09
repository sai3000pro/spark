"""LiDAR depth -> world-space point cloud.

Unprojection convention (ARKit ``sceneDepth``), documented in FORMAT_SPEC.md:

    depth pixel (u=col, v=row), depth d (meters, >0), depth-scaled intrinsics
    (fx, fy, cx, cy).  Camera space (+x right, +y up, -z forward):

        x_cam = (u - cx) / fx * d
        y_cam = -(v - cy) / fy * d
        z_cam = -d

    world = camera_transform @ [x_cam, y_cam, z_cam, 1]

Correct XYZ is the priority.  The sign convention above matches ARKit's
camera space (camera looks down -Z).  Confirm on device: a wall in front of
the camera must appear in front (not mirrored / upside-down / behind).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from .formats import CONFIDENCE_MEDIUM
from .intrinsics import intrinsic_params, scale_intrinsics


@dataclass
class CloudStats:
    point_count: int
    bbox_min: Tuple[float, float, float]
    bbox_max: Tuple[float, float, float]
    extent: Tuple[float, float, float]
    median_distance_m: float
    warnings: List[str]


def unproject_frame(
    depth: np.ndarray,
    intrinsics_rgb: np.ndarray,
    image_size: Tuple[int, int],
    camera_transform: np.ndarray,
    *,
    confidence: Optional[np.ndarray] = None,
    min_confidence: int = CONFIDENCE_MEDIUM,
    min_depth: float = 0.1,
    max_depth: float = 8.0,
    subsample: int = 1,
) -> np.ndarray:
    """Unproject one depth frame into world-space (N, 3) points.

    ``intrinsics_rgb`` is at ``image_size`` resolution; it is scaled to the
    depth resolution internally.  Filters invalid / out-of-range depth and,
    if provided, low-confidence pixels.
    """
    depth = np.asarray(depth, dtype=np.float64)
    h, w = depth.shape
    K = scale_intrinsics(intrinsics_rgb, image_size, (w, h))
    fx, fy, cx, cy = intrinsic_params(K)

    if subsample > 1:
        depth = depth[::subsample, ::subsample]
        if confidence is not None:
            confidence = confidence[::subsample, ::subsample]
        # Rebuild pixel grid on the subsampled lattice (original pixel coords).
        vv, uu = np.meshgrid(
            np.arange(0, h, subsample), np.arange(0, w, subsample), indexing="ij"
        )
    else:
        vv, uu = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")

    d = depth
    valid = np.isfinite(d) & (d >= min_depth) & (d <= max_depth)
    if confidence is not None:
        valid &= confidence >= min_confidence

    u = uu[valid].astype(np.float64)
    v = vv[valid].astype(np.float64)
    dv = d[valid]

    x_cam = (u - cx) / fx * dv
    y_cam = -(v - cy) / fy * dv
    z_cam = -dv

    cam = np.stack([x_cam, y_cam, z_cam, np.ones_like(dv)], axis=1)  # (N,4)
    T = np.asarray(camera_transform, dtype=np.float64)
    world = (T @ cam.T).T[:, :3]
    return world


def cloud_stats(points: np.ndarray) -> CloudStats:
    warns: List[str] = []
    if points.shape[0] == 0:
        return CloudStats(0, (0, 0, 0), (0, 0, 0), (0, 0, 0), 0.0, ["empty cloud"])
    bmin = points.min(axis=0)
    bmax = points.max(axis=0)
    extent = bmax - bmin
    dist = np.linalg.norm(points, axis=1)
    median = float(np.median(dist))

    if not np.all(np.isfinite(points)):
        warns.append("non-finite points present")
    if float(extent.max()) > 100.0:
        warns.append(f"exploding geometry: extent {extent.max():.1f} m")
    return CloudStats(
        point_count=int(points.shape[0]),
        bbox_min=tuple(float(x) for x in bmin),
        bbox_max=tuple(float(x) for x in bmax),
        extent=tuple(float(x) for x in extent),
        median_distance_m=median,
        warnings=warns,
    )


def write_ply(points: np.ndarray, out_path: Path,
              colors: Optional[np.ndarray] = None) -> None:
    """Write an ASCII PLY point cloud (optionally with uint8 RGB)."""
    points = np.asarray(points, dtype=np.float64)
    n = points.shape[0]
    has_color = colors is not None and len(colors) == n
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("ply\n")
        fh.write("format ascii 1.0\n")
        fh.write(f"element vertex {n}\n")
        fh.write("property float x\nproperty float y\nproperty float z\n")
        if has_color:
            fh.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        fh.write("end_header\n")
        if has_color:
            for p, c in zip(points, colors):
                fh.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} "
                         f"{int(c[0])} {int(c[1])} {int(c[2])}\n")
        else:
            for p in points:
                fh.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")


def read_ply_xyz(path: Path) -> np.ndarray:
    """Minimal ASCII-PLY reader returning (N,3) xyz — used by tests."""
    with open(path, "r", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    n = 0
    header_end = 0
    for i, ln in enumerate(lines):
        if ln.startswith("element vertex"):
            n = int(ln.split()[-1])
        if ln.strip() == "end_header":
            header_end = i + 1
            break
    pts = []
    for ln in lines[header_end:header_end + n]:
        parts = ln.split()
        pts.append([float(parts[0]), float(parts[1]), float(parts[2])])
    return np.array(pts, dtype=np.float64)
