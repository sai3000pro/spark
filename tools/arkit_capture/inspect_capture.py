#!/usr/bin/env python3
"""Offline Mac validator for a Gauzensplat capture directory.

Usage:
    python tools/arkit_capture/inspect_capture.py /path/to/capture [--out DIR]
                                                  [--conf {low,medium,high}]
                                                  [--max-frames N] [--subsample K]

Produces (into <capture>/report/ by default):
    validation report (stdout + report/validation.txt)
    trajectory.csv
    trajectory_topdown.png   (if matplotlib available)
    trajectory_3d.png        (if matplotlib available)
    lidar_cloud.ply
    summary.json

Runs standalone (`python tools/arkit_capture/inspect_capture.py ...`) or as a
module (`python -m tools.arkit_capture.inspect_capture ...`).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import numpy as np

# Allow running as a plain script (no package parent on sys.path).
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.arkit_capture import formats  # noqa: E402
from tools.arkit_capture.formats import (  # noqa: E402
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CaptureReader,
)
from tools.arkit_capture.pointcloud import (  # noqa: E402
    cloud_stats,
    unproject_frame,
    write_ply,
)
from tools.arkit_capture.trajectory import (  # noqa: E402
    build_trajectory,
    compute_metrics,
    plot_trajectory,
    write_trajectory_csv,
)
from tools.arkit_capture.validate import ValidationReport, validate_capture  # noqa: E402
from tools.arkit_capture.sharpness import classify, frame_sharpness  # noqa: E402

CONF_MAP = {"low": CONFIDENCE_LOW, "medium": CONFIDENCE_MEDIUM, "high": CONFIDENCE_HIGH}


def _format_report(report: ValidationReport) -> str:
    lines = []
    lines.append(f"Capture:        {report.root}")
    lines.append(f"Session:        {report.session_id}")
    lines.append(f"Format version: {report.format_version}")
    lines.append(f"Lines:          {report.total_lines}")
    lines.append(f"Valid frames:   {report.valid_frames}")
    lines.append(f"Frames w/depth: {report.frames_with_depth}")
    c = report.counts()
    lines.append(f"Issues:         {c['ERROR']} ERROR / {c['WARNING']} WARNING "
                 f"/ {c['RECOVERABLE']} RECOVERABLE")
    if report.issues:
        lines.append("")
        for i in report.issues[:200]:
            fid = f" [frame {i.frame_id}]" if i.frame_id is not None else ""
            lines.append(f"  {i.severity:11s} {i.code}: {i.message}{fid}")
        if len(report.issues) > 200:
            lines.append(f"  ... {len(report.issues) - 200} more issues")
    return "\n".join(lines)


def inspect(
    capture_dir: Path,
    out_dir: Optional[Path] = None,
    *,
    min_confidence: int = CONFIDENCE_MEDIUM,
    max_frames: Optional[int] = None,
    subsample: int = 4,
    max_depth: float = 8.0,
    blur_threshold: Optional[float] = None,
    keyframes: Optional[int] = None,
) -> dict:
    capture_dir = Path(capture_dir)
    out_dir = out_dir or (capture_dir / "report")
    out_dir.mkdir(parents=True, exist_ok=True)

    report = validate_capture(capture_dir)
    report_txt = _format_report(report)
    (out_dir / "validation.txt").write_text(report_txt + "\n", encoding="utf-8")

    summary: dict = {
        "capture": str(capture_dir),
        "session_id": report.session_id,
        "format_version": report.format_version,
        "validation": {
            "valid_frames": report.valid_frames,
            "frames_with_depth": report.frames_with_depth,
            "issue_counts": report.counts(),
            "ok": report.ok,
        },
    }

    if report.valid_frames == 0:
        summary["error"] = "no valid frames; skipping trajectory/pointcloud"
        (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
        return summary

    reader = CaptureReader(capture_dir, strict=False)
    frames = list(reader.frames())

    # --- trajectory ---
    pts = build_trajectory(frames)
    metrics = compute_metrics(frames)
    write_trajectory_csv(pts, out_dir / "trajectory.csv")
    plotted = plot_trajectory(
        pts,
        topdown_path=out_dir / "trajectory_topdown.png",
        threed_path=out_dir / "trajectory_3d.png",
    )
    summary["trajectory"] = {
        "frame_count": metrics.frame_count,
        "duration_s": metrics.duration_s,
        "path_length_m": metrics.path_length_m,
        "net_displacement_m": metrics.net_displacement_m,
        "start_end_distance_m": metrics.start_end_distance_m,
        "average_velocity_mps": metrics.average_velocity_mps,
        "max_frame_translation_m": metrics.max_frame_translation_m,
        "max_frame_rotation_rad": metrics.max_frame_rotation_rad,
        "warnings": metrics.warnings,
        "plots_written": plotted,
    }

    # tracking-state histogram + valid-depth stats
    tracking_counts: dict = {}
    valid_depth_pcts = []
    for fm in frames:
        tracking_counts[fm.tracking_state] = tracking_counts.get(fm.tracking_state, 0) + 1
    summary["tracking_state_counts"] = tracking_counts

    # --- sharpness (motion-blur) scoring ---
    scores = [frame_sharpness(reader.rgb_path(fm)) for fm in frames]
    thr, sharp_mask = classify(scores, threshold=blur_threshold)
    valid_scores = [s for s in scores if s is not None]
    blurry_ids = [fm.frame_id for fm, ok in zip(frames, sharp_mask) if not ok]
    # sharpest-first frame_ids (usable as reconstruction keyframes)
    scored = [(fm.frame_id, s) for fm, s in zip(frames, scores) if s is not None]
    ranked = [fid for fid, _ in sorted(scored, key=lambda t: -t[1])]
    if keyframes:
        ranked_keyframes = ranked[:keyframes]
    else:
        ranked_keyframes = [fm.frame_id for fm, ok in zip(frames, sharp_mask) if ok]
    with open(out_dir / "sharpness.csv", "w", encoding="utf-8") as fh:
        fh.write("frame_id,sharpness,is_sharp\n")
        for fm, s, ok in zip(frames, scores, sharp_mask):
            fh.write(f"{fm.frame_id},{'' if s is None else f'{s:.2f}'},{int(bool(ok))}\n")
    (out_dir / "keyframes_sharp.txt").write_text(
        "\n".join(str(i) for i in ranked_keyframes) + "\n", encoding="utf-8")
    summary["sharpness"] = {
        "threshold": thr,
        "mean": float(np.mean(valid_scores)) if valid_scores else 0.0,
        "median": float(np.median(valid_scores)) if valid_scores else 0.0,
        "min": float(np.min(valid_scores)) if valid_scores else 0.0,
        "max": float(np.max(valid_scores)) if valid_scores else 0.0,
        "blurry_count": len(blurry_ids),
        "sharp_count": len(ranked_keyframes),
        "blurry_frame_ids": blurry_ids[:100],
    }

    # --- point cloud ---
    all_pts = []
    depth_frames = [fm for fm in frames if fm.has_depth]
    if max_frames:
        depth_frames = depth_frames[:max_frames]
    for fm in depth_frames:
        depth = reader.load_depth(fm)
        conf = reader.load_confidence(fm)
        if depth is None:
            continue
        finite = np.isfinite(depth) & (depth > 0)
        if finite.size:
            valid_depth_pcts.append(100.0 * finite.mean())
        world = unproject_frame(
            depth, fm.camera_intrinsics, (fm.image_width, fm.image_height),
            fm.camera_transform, confidence=conf, min_confidence=min_confidence,
            max_depth=max_depth, subsample=subsample,
        )
        if world.shape[0]:
            all_pts.append(world)

    if all_pts:
        cloud = np.concatenate(all_pts, axis=0)
    else:
        cloud = np.zeros((0, 3))
    write_ply(cloud, out_dir / "lidar_cloud.ply")
    stats = cloud_stats(cloud)
    summary["lidar_cloud"] = {
        "point_count": stats.point_count,
        "bbox_min": stats.bbox_min,
        "bbox_max": stats.bbox_max,
        "extent": stats.extent,
        "median_distance_m": stats.median_distance_m,
        "warnings": stats.warnings,
        "confidence_threshold": min_confidence,
        "subsample": subsample,
    }
    summary["depth"] = {
        "avg_valid_depth_pct": float(np.mean(valid_depth_pcts)) if valid_depth_pcts else 0.0,
        "frames_unprojected": len(depth_frames),
    }

    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Inspect a Gauzensplat capture.")
    ap.add_argument("capture", help="path to capture directory")
    ap.add_argument("--out", default=None, help="output directory (default <capture>/report)")
    ap.add_argument("--conf", choices=list(CONF_MAP), default="medium",
                    help="min confidence for point cloud (default medium)")
    ap.add_argument("--max-frames", type=int, default=None,
                    help="cap number of depth frames unprojected")
    ap.add_argument("--subsample", type=int, default=4,
                    help="depth pixel subsample stride (default 4)")
    ap.add_argument("--max-depth", type=float, default=8.0)
    ap.add_argument("--blur-threshold", type=float, default=None,
                    help="absolute sharpness cutoff (default: 0.5 x median)")
    ap.add_argument("--keyframes", type=int, default=None,
                    help="write the N sharpest frame_ids to keyframes_sharp.txt")
    args = ap.parse_args(argv)

    summary = inspect(
        Path(args.capture),
        Path(args.out) if args.out else None,
        min_confidence=CONF_MAP[args.conf],
        max_frames=args.max_frames,
        subsample=args.subsample,
        max_depth=args.max_depth,
        blur_threshold=args.blur_threshold,
        keyframes=args.keyframes,
    )
    report = validate_capture(Path(args.capture))
    print(_format_report(report))
    print()
    print(json.dumps(summary.get("trajectory", {}), indent=2))
    print(json.dumps(summary.get("lidar_cloud", {}), indent=2))
    print(json.dumps(summary.get("sharpness", {}), indent=2))
    out = Path(args.out) if args.out else (Path(args.capture) / "report")
    print(f"\nOutputs written to: {out}")
    return 0 if report.ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
