"""Camera trajectory extraction and metrics from raw ARKit transforms.

Uses ``ARCamera.transform`` (camera-to-world) exactly as stored — no axis
flips or scale normalisation.  Camera world position is the translation column
of the 4x4 transform.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

import numpy as np

from .formats import FrameMeta, translation_of


@dataclass
class TrajectoryPoint:
    frame_id: int
    timestamp: float
    x: float
    y: float
    z: float
    tracking_state: str


@dataclass
class TrajectoryMetrics:
    frame_count: int
    duration_s: float
    path_length_m: float
    net_displacement_m: float
    start_end_distance_m: float
    average_velocity_mps: float
    max_frame_translation_m: float
    max_frame_rotation_rad: float
    warnings: List[str]


def build_trajectory(frames: Sequence[FrameMeta]) -> List[TrajectoryPoint]:
    pts: List[TrajectoryPoint] = []
    for fm in frames:
        t = translation_of(fm.camera_transform)
        pts.append(
            TrajectoryPoint(
                frame_id=fm.frame_id,
                timestamp=fm.timestamp,
                x=float(t[0]),
                y=float(t[1]),
                z=float(t[2]),
                tracking_state=fm.tracking_state,
            )
        )
    return pts


def _rotation_angle(R0: np.ndarray, R1: np.ndarray) -> float:
    """Geodesic angle (radians) between two 3x3 rotation matrices."""
    R = R0.T @ R1
    trace = np.clip((np.trace(R) - 1.0) / 2.0, -1.0, 1.0)
    return float(math.acos(trace))


def compute_metrics(frames: Sequence[FrameMeta]) -> TrajectoryMetrics:
    warns: List[str] = []
    pts = build_trajectory(frames)
    n = len(pts)
    if n == 0:
        return TrajectoryMetrics(0, 0, 0, 0, 0, 0, 0, 0, ["no frames"])

    positions = np.array([[p.x, p.y, p.z] for p in pts], dtype=np.float64)
    times = np.array([p.timestamp for p in pts], dtype=np.float64)

    duration = float(times[-1] - times[0]) if n > 1 else 0.0
    if n > 1 and np.any(np.diff(times) <= 0):
        warns.append("non-monotonic or duplicate timestamps detected")

    seg = np.linalg.norm(np.diff(positions, axis=0), axis=1) if n > 1 else np.array([])
    path_length = float(seg.sum())
    max_step = float(seg.max()) if seg.size else 0.0
    start_end = float(np.linalg.norm(positions[-1] - positions[0]))
    net_disp = start_end  # net displacement == straight-line start->end
    avg_vel = path_length / duration if duration > 0 else 0.0

    max_rot = 0.0
    for a, b in zip(frames[:-1], frames[1:]):
        R0 = np.asarray(a.camera_transform, dtype=np.float64)[:3, :3]
        R1 = np.asarray(b.camera_transform, dtype=np.float64)[:3, :3]
        max_rot = max(max_rot, _rotation_angle(R0, R1))

    # Flag suspicious geometry (do not silently correct).
    if max_step > 1.0:
        warns.append(f"large single-frame translation {max_step:.2f} m (possible jump)")
    if path_length > 1000.0:
        warns.append(f"implausibly long path {path_length:.1f} m")
    if not np.all(np.isfinite(positions)):
        warns.append("non-finite camera positions present")

    return TrajectoryMetrics(
        frame_count=n,
        duration_s=duration,
        path_length_m=path_length,
        net_displacement_m=net_disp,
        start_end_distance_m=start_end,
        average_velocity_mps=avg_vel,
        max_frame_translation_m=max_step,
        max_frame_rotation_rad=max_rot,
        warnings=warns,
    )


def write_trajectory_csv(pts: Sequence[TrajectoryPoint], out_path: Path) -> None:
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["frame_id", "timestamp", "x", "y", "z", "tracking_state"])
        for p in pts:
            w.writerow([p.frame_id, f"{p.timestamp:.6f}", f"{p.x:.6f}",
                        f"{p.y:.6f}", f"{p.z:.6f}", p.tracking_state])


def plot_trajectory(
    pts: Sequence[TrajectoryPoint],
    topdown_path: Optional[Path] = None,
    threed_path: Optional[Path] = None,
) -> bool:
    """Render top-down (X/Z) and 3D trajectory plots.

    Returns True if plots were written, False if matplotlib is unavailable
    (the caller degrades gracefully — CSV/PLY/summary still work).
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # noqa: F401
        from mpl_toolkits.mplot3d import Axes3D  # noqa: F401
    except Exception:
        return False

    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]

    if topdown_path is not None:
        fig, ax = plt.subplots(figsize=(6, 6))
        ax.plot(xs, zs, "-o", ms=2, lw=1, color="#1f77b4")
        if pts:
            ax.plot(xs[0], zs[0], "go", ms=10, label="start")
            ax.plot(xs[-1], zs[-1], "rs", ms=10, label="end")
        ax.set_xlabel("X (m)")
        ax.set_ylabel("Z (m)")
        ax.set_title("Camera trajectory (top-down, X/Z)")
        ax.axis("equal")
        ax.grid(True, alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(topdown_path, dpi=120)
        plt.close(fig)

    if threed_path is not None:
        fig = plt.figure(figsize=(7, 6))
        ax = fig.add_subplot(111, projection="3d")
        ax.plot(xs, ys, zs, "-o", ms=2, lw=1, color="#1f77b4")
        if pts:
            ax.scatter([xs[0]], [ys[0]], [zs[0]], c="g", s=60, label="start")
            ax.scatter([xs[-1]], [ys[-1]], [zs[-1]], c="r", s=60, label="end")
        ax.set_xlabel("X (m)")
        ax.set_ylabel("Y (m)")
        ax.set_zlabel("Z (m)")
        ax.set_title("Camera trajectory (3D)")
        ax.legend()
        fig.tight_layout()
        fig.savefig(threed_path, dpi=120)
        plt.close(fig)

    return True
