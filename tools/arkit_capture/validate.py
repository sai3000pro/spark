"""Capture validation / corruption detection.

Classifies issues as ERROR / WARNING / RECOVERABLE so partial or slightly
damaged captures remain inspectable.  Detects: format-version mismatch, JSONL
corruption, duplicate/non-monotonic ids, missing/oversized/truncated binaries,
bad matrix dimensions, NaN/inf, orphan files.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from . import formats
from .formats import (
    CAPTURE_FORMAT_VERSION,
    CONFIDENCE_DTYPE,
    DEPTH_DTYPE,
    CaptureReader,
    FormatError,
)

ERROR = "ERROR"
WARNING = "WARNING"
RECOVERABLE = "RECOVERABLE"


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    frame_id: Optional[int] = None


@dataclass
class ValidationReport:
    root: str
    session_id: Optional[str]
    format_version: Optional[int]
    total_lines: int = 0
    valid_frames: int = 0
    frames_with_depth: int = 0
    issues: List[Issue] = field(default_factory=list)

    def add(self, severity, code, message, frame_id=None):
        self.issues.append(Issue(severity, code, message, frame_id))

    @property
    def errors(self):
        return [i for i in self.issues if i.severity == ERROR]

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0

    def counts(self) -> Dict[str, int]:
        c = {ERROR: 0, WARNING: 0, RECOVERABLE: 0}
        for i in self.issues:
            c[i.severity] = c.get(i.severity, 0) + 1
        return c


def validate_capture(root: str | Path) -> ValidationReport:
    root = Path(root)
    report = ValidationReport(root=str(root), session_id=None, format_version=None)

    try:
        reader = CaptureReader(root, strict=False)
    except FormatError as e:
        report.add(ERROR, "unreadable", str(e))
        return report

    report.session_id = reader.session.session_id
    report.format_version = reader.session.format_version
    if reader.session.format_version > CAPTURE_FORMAT_VERSION:
        report.add(WARNING, "format_version",
                   f"capture format_version {reader.session.format_version} "
                   f"> supported {CAPTURE_FORMAT_VERSION}")
    if reader.session.camera_transform_modified:
        report.add(WARNING, "transform_modified",
                   "session declares camera_transform_modified=true")

    seen_ids = set()
    last_ts = None
    referenced_files = set()
    valid_frames: List[formats.FrameMeta] = []

    for fm, issue in reader.iter_with_issues():
        report.total_lines += 1
        if issue is not None:
            sev = RECOVERABLE if issue.kind == "bad_json" else RECOVERABLE
            report.add(sev, issue.kind,
                       f"line {issue.line_number}: {issue.message}")
            continue

        # duplicate id
        if fm.frame_id in seen_ids:
            report.add(ERROR, "duplicate_id",
                       f"duplicate frame_id {fm.frame_id}", fm.frame_id)
        seen_ids.add(fm.frame_id)

        # monotonic timestamp
        if last_ts is not None and fm.timestamp < last_ts:
            report.add(WARNING, "timestamp_order",
                       f"non-monotonic timestamp {fm.timestamp} < {last_ts}",
                       fm.frame_id)
        last_ts = fm.timestamp

        # matrix finiteness / dims already enforced by parse; double-check dims
        if fm.camera_transform.shape != (4, 4):
            report.add(ERROR, "bad_transform", "camera_transform not 4x4", fm.frame_id)
        if fm.camera_intrinsics.shape != (3, 3):
            report.add(ERROR, "bad_intrinsics", "camera_intrinsics not 3x3", fm.frame_id)

        # rgb existence
        rgb = reader.rgb_path(fm)
        if not rgb.is_file():
            report.add(ERROR, "missing_rgb", f"missing {fm.rgb_path}", fm.frame_id)
        else:
            referenced_files.add(rgb.resolve())
            if rgb.stat().st_size == 0:
                report.add(ERROR, "empty_rgb", f"empty {fm.rgb_path}", fm.frame_id)

        # depth
        if fm.has_depth and fm.depth_path:
            dp = root / fm.depth_path
            if not dp.is_file():
                report.add(ERROR, "missing_depth", f"missing {fm.depth_path}", fm.frame_id)
            else:
                referenced_files.add(dp.resolve())
                expected = fm.depth_width * fm.depth_height * DEPTH_DTYPE.itemsize
                actual = dp.stat().st_size
                if actual != expected:
                    report.add(ERROR, "depth_size",
                               f"{fm.depth_path} is {actual} bytes, expected {expected}",
                               fm.frame_id)
                else:
                    try:
                        d = reader.load_depth(fm)
                        if not np.all(np.isfinite(d[d != 0])):
                            report.add(WARNING, "depth_nan",
                                       f"NaN/inf in depth {fm.depth_path}", fm.frame_id)
                    except FormatError as e:
                        report.add(ERROR, "depth_decode", str(e), fm.frame_id)

            if fm.confidence_path:
                cp = root / fm.confidence_path
                if not cp.is_file():
                    report.add(ERROR, "missing_confidence",
                               f"missing {fm.confidence_path}", fm.frame_id)
                else:
                    referenced_files.add(cp.resolve())
                    exp = fm.depth_width * fm.depth_height * CONFIDENCE_DTYPE.itemsize
                    act = cp.stat().st_size
                    if act != exp:
                        report.add(ERROR, "confidence_size",
                                   f"{fm.confidence_path} is {act} bytes, expected {exp}",
                                   fm.frame_id)
            report.frames_with_depth += 1
        elif fm.depth_status == "unavailable":
            report.add(RECOVERABLE, "no_depth",
                       f"frame {fm.frame_id} has no LiDAR depth", fm.frame_id)

        valid_frames.append(fm)

    report.valid_frames = len(valid_frames)
    if report.valid_frames == 0:
        report.add(ERROR, "no_frames", "no valid frames found")

    # orphan files (present on disk but not referenced)
    for sub in ("frames", "depth", "confidence"):
        d = root / sub
        if d.is_dir():
            for f in d.iterdir():
                if f.is_file() and f.resolve() not in referenced_files:
                    report.add(WARNING, "orphan_file",
                               f"orphan file not referenced by metadata: {sub}/{f.name}")

    return report
