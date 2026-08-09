#!/usr/bin/env python3
"""Convert a Gauzensplat capture into a COLMAP dataset (text model).

Feeds the Reconstruction Studio's `brush` / `hybrid` pipelines directly — no
COLMAP *solve* needed, because ARKit already provides exact metric camera poses
and the LiDAR gives a dense points3D initialization.

    <out>/
        images/000001.jpg ...
        sparse/0/cameras.txt      PINHOLE per-image intrinsics
        sparse/0/images.txt       world->camera poses (COLMAP/OpenCV convention)
        sparse/0/points3D.txt     LiDAR points (metric, colored)

Coordinate conversion: ARKit camera space (+x right, +y up, -z fwd) -> COLMAP/
OpenCV (+x right, +y down, +z fwd) via diag(1,-1,-1); poses inverted to
world->camera as COLMAP stores them.

Usage:
    python tools/arkit_capture/export_colmap.py <capture> --out ComfyUI/brush_data/<name>
"""

from __future__ import annotations

import argparse
import math
import shutil
import sys
from pathlib import Path
from typing import List, Set

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.arkit_capture.formats import CaptureReader, FrameMeta, CONFIDENCE_MEDIUM  # noqa: E402
from tools.arkit_capture.intrinsics import scale_intrinsics  # noqa: E402
from tools.arkit_capture.sharpness import classify, frame_sharpness  # noqa: E402

# ARKit-camera -> COLMAP/OpenCV-camera axis flip (y, z negated).
_FLIP = np.diag([1.0, -1.0, -1.0])


def _quat_from_R(R: np.ndarray):
    """COLMAP (Hamilton, w-first) quaternion from a 3x3 rotation matrix."""
    m = R
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        qw = 0.25 * s
        qx = (m[2, 1] - m[1, 2]) / s
        qy = (m[0, 2] - m[2, 0]) / s
        qz = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        qw = (m[2, 1] - m[1, 2]) / s
        qx = 0.25 * s
        qy = (m[0, 1] + m[1, 0]) / s
        qz = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        qw = (m[0, 2] - m[2, 0]) / s
        qx = (m[0, 1] + m[1, 0]) / s
        qy = 0.25 * s
        qz = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        qw = (m[1, 0] - m[0, 1]) / s
        qx = (m[0, 2] + m[2, 0]) / s
        qy = (m[1, 2] + m[2, 1]) / s
        qz = 0.25 * s
    return qw, qx, qy, qz


def _sharp_ids(reader: CaptureReader, frames: List[FrameMeta]) -> Set[int]:
    scores = [frame_sharpness(reader.rgb_path(fm)) for fm in frames]
    _, mask = classify(scores)
    return {fm.frame_id for fm, ok in zip(frames, mask) if ok}


def _colored_points(reader: CaptureReader, frames: List[FrameMeta],
                    subsample: int, max_points: int):
    """Unproject LiDAR depth to metric world XYZ + RGB sampled from the frame."""
    try:
        from PIL import Image
    except Exception:
        Image = None
    pts_all, col_all = [], []
    for fm in frames:
        if not fm.has_depth:
            continue
        # Metadata may advertise depth that never landed on disk (dropped/partial
        # payload during live streaming); skip such frames instead of crashing.
        try:
            depth = reader.load_depth(fm)
            conf = reader.load_confidence(fm)
        except (FileNotFoundError, OSError):
            continue
        if depth is None:
            continue
        h, w = depth.shape
        K = scale_intrinsics(fm.camera_intrinsics, (fm.image_width, fm.image_height), (w, h))
        fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
        vv, uu = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
        valid = np.isfinite(depth) & (depth > 0.1) & (depth < 8.0)
        if conf is not None:
            conf_ok = valid & (conf >= CONFIDENCE_MEDIUM)
            # Only trust the confidence map when it actually keeps points. Some
            # captures stream all-low (0) confidence for otherwise-good LiDAR depth;
            # filtering on it would discard the entire frame. Fall back to depth-only
            # rather than produce an empty reconstruction (adaptive, not per-capture).
            if conf_ok.sum() >= 0.05 * max(1, valid.sum()):
                valid = conf_ok
        valid[::subsample, ::subsample] = valid[::subsample, ::subsample]
        mask = np.zeros_like(valid)
        mask[::subsample, ::subsample] = True
        valid &= mask
        if not valid.any():
            continue
        u = uu[valid].astype(np.float64); v = vv[valid].astype(np.float64); d = depth[valid]
        x = (u - cx) / fx * d
        y = -(v - cy) / fy * d
        z = -d
        cam = np.stack([x, y, z, np.ones_like(d)], axis=1)
        world = (np.asarray(fm.camera_transform) @ cam.T).T[:, :3]
        pts_all.append(world)
        # colors
        if Image is not None:
            try:
                with Image.open(reader.rgb_path(fm)) as im:
                    im = im.convert("RGB").resize((w, h))
                    arr = np.asarray(im)
                col_all.append(arr[valid])
            except Exception:
                col_all.append(np.full((world.shape[0], 3), 160, np.uint8))
        else:
            col_all.append(np.full((world.shape[0], 3), 160, np.uint8))
    if not pts_all:
        return np.zeros((0, 3)), np.zeros((0, 3), np.uint8)
    pts = np.concatenate(pts_all); cols = np.concatenate(col_all)
    if pts.shape[0] > max_points:
        sel = np.random.default_rng(0).choice(pts.shape[0], max_points, replace=False)
        pts, cols = pts[sel], cols[sel]
    return pts, cols


def export_colmap(capture_dir: Path, out_dir: Path, *, sharp_only: bool = True,
                  max_points: int = 200_000, subsample: int = 6,
                  rotate_cw: bool = False) -> dict:
    capture_dir = Path(capture_dir)
    out_dir = Path(out_dir)
    images_dir = out_dir / "images"
    sparse_dir = out_dir / "sparse" / "0"
    images_dir.mkdir(parents=True, exist_ok=True)
    sparse_dir.mkdir(parents=True, exist_ok=True)

    reader = CaptureReader(capture_dir, strict=False)
    frames = list(reader.frames())
    if not frames:
        raise SystemExit("no valid frames")
    keep = _sharp_ids(reader, frames) if sharp_only else None
    selected = [fm for fm in frames if keep is None or fm.frame_id in keep]

    # 90deg-CW image rotation = +90deg rotation of camera coords about the optical
    # (z) axis. Rotating image + intrinsics + pose together keeps every 3D ray
    # identical, so the reconstruction is unchanged — frames just store upright.
    _RZ = np.array([[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]])
    cameras, images_lines = [], []
    for idx, fm in enumerate(selected, start=1):
        name = f"{fm.frame_id:06d}.jpg"
        K = np.asarray(fm.camera_intrinsics, dtype=float)
        fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
        W0, H0 = fm.image_width, fm.image_height
        T_wc = np.linalg.inv(np.asarray(fm.camera_transform, dtype=float))
        R = _FLIP @ T_wc[:3, :3]
        t = _FLIP @ T_wc[:3, 3]
        if rotate_cw:
            from PIL import Image
            with Image.open(reader.rgb_path(fm)) as im:
                im.transpose(Image.ROTATE_270).save(images_dir / name, quality=95)
            cam_w, cam_h = H0, W0                  # dims swap
            fx, fy, cx, cy = fy, fx, (H0 - 1 - cy), cx   # rotated intrinsics
            R = _RZ @ R
            t = _RZ @ t                            # rotated pose (about optical z)
        else:
            shutil.copy2(reader.rgb_path(fm), images_dir / name)
            cam_w, cam_h = W0, H0
        cameras.append(f"{idx} PINHOLE {cam_w} {cam_h} "
                       f"{fx:.6f} {fy:.6f} {cx:.6f} {cy:.6f}")
        qw, qx, qy, qz = _quat_from_R(R)
        images_lines.append(
            f"{idx} {qw:.9f} {qx:.9f} {qy:.9f} {qz:.9f} "
            f"{t[0]:.9f} {t[1]:.9f} {t[2]:.9f} {idx} {name}")

    (sparse_dir / "cameras.txt").write_text(
        "# Camera list\n" + "\n".join(cameras) + "\n")
    with open(sparse_dir / "images.txt", "w") as fh:
        fh.write("# Image list (two lines each: pose, then empty 2D points)\n")
        for ln in images_lines:
            fh.write(ln + "\n\n")   # second (points2D) line intentionally empty

    pts, cols = _colored_points(reader, selected, subsample, max_points)
    with open(sparse_dir / "points3D.txt", "w") as fh:
        fh.write("# 3D point list\n")
        for i, (p, c) in enumerate(zip(pts, cols), start=1):
            fh.write(f"{i} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f} "
                     f"{int(c[0])} {int(c[1])} {int(c[2])} 0\n")

    res = {"capture": str(capture_dir), "dataset": str(out_dir),
           "images": len(selected), "points3D": int(pts.shape[0]),
           "sharp_only": sharp_only}
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description="Export capture -> COLMAP dataset")
    ap.add_argument("capture")
    ap.add_argument("--out", required=True)
    ap.add_argument("--all-frames", action="store_true", help="include blurry frames too")
    ap.add_argument("--max-points", type=int, default=200_000)
    # Default ON: this iOS capture app stores landscape buffers that must be
    # rotated 90deg CW to display upright, and the metadata carries no orientation
    # signal to auto-detect from. Use --no-rotate-cw for an already-upright capture.
    ap.add_argument("--rotate-cw", action=argparse.BooleanOptionalAction, default=True,
                    help="rotate frames 90deg clockwise (+ intrinsics + poses); default ON")
    args = ap.parse_args(argv)
    import json
    print(json.dumps(export_colmap(Path(args.capture), Path(args.out),
                                   sharp_only=not args.all_frames,
                                   max_points=args.max_points,
                                   rotate_cw=args.rotate_cw), indent=2))


if __name__ == "__main__":
    main()
