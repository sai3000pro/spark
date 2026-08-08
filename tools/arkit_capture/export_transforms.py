#!/usr/bin/env python3
"""Convert a Gauzensplat capture into a Nerfstudio/Brush-ready dataset.

Produces (into <out>/):
    images/000000.jpg ...          selected RGB frames
    transforms.json                intrinsics + per-frame camera-to-world poses
    init.ply                       LiDAR point cloud for initialization (optional)

No COLMAP needed — ARKit already provides metric camera poses. ARKit camera
space (+x right, +y up, -z forward) matches the Nerfstudio/OpenGL convention
used by `transform_matrix`, so poses pass through directly.

Usage:
    python tools/arkit_capture/export_transforms.py <capture> --out <dataset> \
        [--sharp-only] [--max-frames N] [--no-init-ply]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import List, Optional, Set

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.arkit_capture.formats import CaptureReader, FrameMeta  # noqa: E402
from tools.arkit_capture.sharpness import classify, frame_sharpness  # noqa: E402


def _sharp_ids(reader: CaptureReader, frames: List[FrameMeta]) -> Set[int]:
    scores = [frame_sharpness(reader.rgb_path(fm)) for fm in frames]
    _, mask = classify(scores)
    return {fm.frame_id for fm, ok in zip(frames, mask) if ok}


def export(capture_dir: Path, out_dir: Path, *, sharp_only: bool = False,
           max_frames: Optional[int] = None, init_ply: bool = True) -> dict:
    capture_dir = Path(capture_dir)
    out_dir = Path(out_dir)
    (out_dir / "images").mkdir(parents=True, exist_ok=True)

    reader = CaptureReader(capture_dir, strict=False)
    frames = list(reader.frames())
    if not frames:
        raise SystemExit("no valid frames in capture")

    keep_ids: Optional[Set[int]] = _sharp_ids(reader, frames) if sharp_only else None

    selected: List[FrameMeta] = []
    for fm in frames:
        if keep_ids is not None and fm.frame_id not in keep_ids:
            continue
        selected.append(fm)
    if max_frames:
        # evenly subsample to max_frames while preserving order
        if len(selected) > max_frames:
            idx = np.linspace(0, len(selected) - 1, max_frames).round().astype(int)
            selected = [selected[i] for i in sorted(set(idx.tolist()))]

    frames_json = []
    for fm in selected:
        src = reader.rgb_path(fm)
        name = f"{fm.frame_id:06d}.jpg"
        shutil.copy2(src, out_dir / "images" / name)
        K = np.asarray(fm.camera_intrinsics, dtype=float)
        T = np.asarray(fm.camera_transform, dtype=float)
        frames_json.append({
            "file_path": f"images/{name}",
            "fl_x": float(K[0, 0]),
            "fl_y": float(K[1, 1]),
            "cx": float(K[0, 2]),
            "cy": float(K[1, 2]),
            "w": fm.image_width,
            "h": fm.image_height,
            "transform_matrix": [[float(v) for v in row] for row in T],
        })

    transforms = {
        "camera_model": "OPENCV",   # pinhole; ARKit intrinsics carry no distortion
        "orientation_override": "none",
        "frames": frames_json,
    }
    if init_ply:
        transforms["ply_file_path"] = "init.ply"

    (out_dir / "transforms.json").write_text(json.dumps(transforms, indent=2))

    # init.ply from the LiDAR cloud (reuse the inspector's if present, else make one)
    if init_ply:
        _write_init_ply(reader, selected, out_dir / "init.ply")

    result = {
        "capture": str(capture_dir),
        "dataset": str(out_dir),
        "frames_exported": len(selected),
        "sharp_only": sharp_only,
        "init_ply": init_ply,
    }
    print(json.dumps(result, indent=2))
    return result


def _write_init_ply(reader: CaptureReader, frames: List[FrameMeta], out: Path,
                    subsample: int = 6, max_points: int = 500_000) -> None:
    from tools.arkit_capture.pointcloud import unproject_frame, write_ply
    from tools.arkit_capture.formats import CONFIDENCE_MEDIUM
    chunks = []
    for fm in frames:
        if not fm.has_depth:
            continue
        depth = reader.load_depth(fm)
        conf = reader.load_confidence(fm)
        if depth is None:
            continue
        pts = unproject_frame(depth, fm.camera_intrinsics,
                              (fm.image_width, fm.image_height), fm.camera_transform,
                              confidence=conf, min_confidence=CONFIDENCE_MEDIUM,
                              subsample=subsample)
        if pts.shape[0]:
            chunks.append(pts)
    cloud = np.concatenate(chunks, axis=0) if chunks else np.zeros((0, 3))
    if cloud.shape[0] > max_points:
        sel = np.random.default_rng(0).choice(cloud.shape[0], max_points, replace=False)
        cloud = cloud[sel]
    write_ply(cloud, out)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Export capture -> Nerfstudio/Brush dataset")
    ap.add_argument("capture")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sharp-only", action="store_true",
                    help="keep only frames above the sharpness threshold")
    ap.add_argument("--max-frames", type=int, default=None)
    ap.add_argument("--no-init-ply", action="store_true")
    args = ap.parse_args(argv)
    export(Path(args.capture), Path(args.out), sharp_only=args.sharp_only,
           max_frames=args.max_frames, init_ply=not args.no_init_ply)


if __name__ == "__main__":
    main()
