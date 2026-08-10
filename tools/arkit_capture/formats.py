"""Gauzensplat capture format contract — single source of truth.

This module defines and enforces the on-disk / on-wire contract shared by:

    * the iOS recorder (Swift ``MatrixSerialization`` / ``MetadataWriter``)
    * the Mac inspector (``inspect_capture.py``)
    * the live capture server (``tools/live_capture_server``)
    * the phone / ESP32 simulators

Two independent version numbers are maintained (they are *distinct concepts*):

    CAPTURE_FORMAT_VERSION   -- the on-disk capture directory schema
    NETWORK_PROTOCOL_VERSION -- the Wi-Fi wire protocol

Conventions (documented in FORMAT_SPEC.md, mirrored here so parsers and
serializers cannot drift):

    Matrices        row-major nested arrays.  A 4x4 transform serializes as
                    [[m00,m01,m02,m03],[m10,...],[m20,...],[m30,m31,m32,m33]].
                    ARCamera.transform is stored RAW (camera-to-world), never
                    inverted / axis-flipped on the phone.

    Depth binary    little-endian float32, row-major, length = w*h, meters.
                    File extension ``.f32``.

    Confidence      uint8, row-major, length = w*h.  ARConfidenceLevel:
                    0 = low, 1 = medium, 2 = high.  File extension ``.u8``.

    RGB             JPEG, native ARKit ``capturedImage`` geometry (landscape).

    Identity        session_id (UUID string) + frame_id (monotonic int).
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

import numpy as np

# --------------------------------------------------------------------------- #
# Versions & constants
# --------------------------------------------------------------------------- #

CAPTURE_FORMAT_VERSION = 1
NETWORK_PROTOCOL_VERSION = 1

DEPTH_FORMAT = "float32_le"
DEPTH_UNITS = "meters"
DEPTH_DTYPE = np.dtype("<f4")  # little-endian float32
CONFIDENCE_FORMAT = "uint8"
CONFIDENCE_DTYPE = np.dtype("u1")

DEPTH_EXT = ".f32"
CONFIDENCE_EXT = ".u8"
RGB_EXT = ".jpg"

# ARConfidenceLevel mapping (Apple).
CONFIDENCE_LOW = 0
CONFIDENCE_MEDIUM = 1
CONFIDENCE_HIGH = 2

# Mandatory metadata keys.  Unknown keys are preserved but ignored by strict
# consumers; missing keys here are a hard error.
REQUIRED_FRAME_KEYS = (
    "frame_id",
    "timestamp",
    "rgb_path",
    "image_width",
    "image_height",
    "camera_transform",
    "camera_intrinsics",
    "tracking_state",
)

TRACKING_STATES = ("normal", "limited", "notAvailable")


class FormatError(ValueError):
    """Raised when a capture file violates the format contract."""


# --------------------------------------------------------------------------- #
# Matrix serialization (row-major nested arrays)
# --------------------------------------------------------------------------- #

def matrix_to_rows(mat: np.ndarray) -> List[List[float]]:
    """Serialize an NxN numpy matrix to row-major nested Python lists."""
    arr = np.asarray(mat, dtype=np.float64)
    if arr.ndim != 2 or arr.shape[0] != arr.shape[1]:
        raise FormatError(f"matrix must be square 2-D, got shape {arr.shape}")
    return [[float(v) for v in row] for row in arr]


def rows_to_matrix(rows: Any, expected_n: Optional[int] = None) -> np.ndarray:
    """Parse row-major nested arrays into an NxN float64 numpy matrix.

    Enforces squareness, expected size (if given), and finiteness.
    """
    if not isinstance(rows, (list, tuple)):
        raise FormatError("matrix must be a list of rows")
    n = len(rows)
    if expected_n is not None and n != expected_n:
        raise FormatError(f"expected {expected_n}x{expected_n} matrix, got {n} rows")
    mat = np.empty((n, n), dtype=np.float64)
    for i, row in enumerate(rows):
        if not isinstance(row, (list, tuple)) or len(row) != n:
            raise FormatError(
                f"row {i} must have length {n}, got "
                f"{len(row) if isinstance(row, (list, tuple)) else type(row)}"
            )
        for j, v in enumerate(row):
            mat[i, j] = float(v)
    if not np.all(np.isfinite(mat)):
        raise FormatError("matrix contains non-finite (NaN/inf) values")
    return mat


def parse_transform(rows: Any) -> np.ndarray:
    """Parse a 4x4 camera-to-world transform (row-major)."""
    return rows_to_matrix(rows, expected_n=4)


def parse_intrinsics(rows: Any) -> np.ndarray:
    """Parse a 3x3 camera intrinsics matrix (row-major)."""
    return rows_to_matrix(rows, expected_n=3)


def translation_of(transform: np.ndarray) -> np.ndarray:
    """Return the (x, y, z) translation column of a 4x4 transform."""
    t = np.asarray(transform, dtype=np.float64)
    if t.shape != (4, 4):
        raise FormatError(f"transform must be 4x4, got {t.shape}")
    return t[:3, 3].copy()


# --------------------------------------------------------------------------- #
# Depth / confidence binary codecs
# --------------------------------------------------------------------------- #

def encode_depth(depth: np.ndarray) -> bytes:
    """Encode a (h, w) float32 depth array to little-endian float32 bytes."""
    arr = np.ascontiguousarray(np.asarray(depth, dtype=DEPTH_DTYPE))
    return arr.tobytes()


def decode_depth(raw: bytes, width: int, height: int) -> np.ndarray:
    """Decode little-endian float32 depth bytes into a (height, width) array.

    Raises ``FormatError`` on a wrong byte count (truncated / oversized file).
    """
    expected = width * height * DEPTH_DTYPE.itemsize
    if len(raw) != expected:
        raise FormatError(
            f"depth byte count mismatch: got {len(raw)}, expected {expected} "
            f"({width}x{height} float32)"
        )
    arr = np.frombuffer(raw, dtype=DEPTH_DTYPE)
    return arr.reshape(height, width).astype(np.float32)


def encode_confidence(conf: np.ndarray) -> bytes:
    arr = np.ascontiguousarray(np.asarray(conf, dtype=CONFIDENCE_DTYPE))
    return arr.tobytes()


def decode_confidence(raw: bytes, width: int, height: int) -> np.ndarray:
    """Decode uint8 confidence bytes into a (height, width) array."""
    expected = width * height * CONFIDENCE_DTYPE.itemsize
    if len(raw) != expected:
        raise FormatError(
            f"confidence byte count mismatch: got {len(raw)}, expected {expected} "
            f"({width}x{height} uint8)"
        )
    arr = np.frombuffer(raw, dtype=CONFIDENCE_DTYPE)
    return arr.reshape(height, width).copy()


# --------------------------------------------------------------------------- #
# Frame metadata
# --------------------------------------------------------------------------- #

@dataclass
class FrameMeta:
    """One parsed ``metadata.jsonl`` record.

    Mandatory fields are validated; unknown optional fields are preserved in
    :attr:`extra` so future readers/writers stay forward-compatible.
    """

    frame_id: int
    timestamp: float
    rgb_path: str
    image_width: int
    image_height: int
    camera_transform: np.ndarray  # 4x4 float64
    camera_intrinsics: np.ndarray  # 3x3 float64
    tracking_state: str
    format_version: int = CAPTURE_FORMAT_VERSION
    session_time: Optional[float] = None
    depth_path: Optional[str] = None
    confidence_path: Optional[str] = None
    depth_width: Optional[int] = None
    depth_height: Optional[int] = None
    depth_format: Optional[str] = None
    depth_units: Optional[str] = None
    confidence_format: Optional[str] = None
    depth_status: str = "available"
    tracking_reason: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def has_depth(self) -> bool:
        return self.depth_path is not None and self.depth_status == "available"


def parse_frame_meta(obj: Dict[str, Any], *, strict: bool = True) -> FrameMeta:
    """Parse one metadata record.

    Requires mandatory fields, ignores unknown optional fields (keeping them in
    ``extra``), and warns on incompatible format versions.
    """
    if not isinstance(obj, dict):
        raise FormatError("metadata record must be a JSON object")

    fmt = obj.get("format_version", CAPTURE_FORMAT_VERSION)
    if fmt > CAPTURE_FORMAT_VERSION:
        warnings.warn(
            f"frame {obj.get('frame_id')} format_version {fmt} newer than "
            f"supported {CAPTURE_FORMAT_VERSION}; unknown fields ignored",
            stacklevel=2,
        )

    missing = [k for k in REQUIRED_FRAME_KEYS if k not in obj]
    if missing:
        raise FormatError(f"metadata record missing required keys: {missing}")

    tracking = obj["tracking_state"]
    if strict and tracking not in TRACKING_STATES:
        raise FormatError(
            f"unknown tracking_state {tracking!r} (expected one of {TRACKING_STATES})"
        )

    known = set(FrameMeta.__dataclass_fields__) | {"format_version"}
    extra = {k: v for k, v in obj.items() if k not in known}

    depth_path = obj.get("depth_path")
    depth_status = obj.get("depth_status", "available" if depth_path else "unavailable")

    return FrameMeta(
        frame_id=int(obj["frame_id"]),
        timestamp=float(obj["timestamp"]),
        rgb_path=str(obj["rgb_path"]),
        image_width=int(obj["image_width"]),
        image_height=int(obj["image_height"]),
        camera_transform=parse_transform(obj["camera_transform"]),
        camera_intrinsics=parse_intrinsics(obj["camera_intrinsics"]),
        tracking_state=tracking,
        format_version=int(fmt),
        session_time=(float(obj["session_time"]) if obj.get("session_time") is not None else None),
        depth_path=depth_path,
        confidence_path=obj.get("confidence_path"),
        depth_width=(int(obj["depth_width"]) if obj.get("depth_width") is not None else None),
        depth_height=(int(obj["depth_height"]) if obj.get("depth_height") is not None else None),
        depth_format=obj.get("depth_format"),
        depth_units=obj.get("depth_units"),
        confidence_format=obj.get("confidence_format"),
        depth_status=depth_status,
        tracking_reason=obj.get("tracking_reason"),
        extra=extra,
    )


def frame_meta_to_dict(fm: FrameMeta) -> Dict[str, Any]:
    """Serialize a :class:`FrameMeta` back to a JSON-ready dict."""
    d: Dict[str, Any] = {
        "format_version": fm.format_version,
        "frame_id": fm.frame_id,
        "timestamp": fm.timestamp,
        "session_time": fm.session_time,
        "rgb_path": fm.rgb_path,
        "depth_path": fm.depth_path,
        "confidence_path": fm.confidence_path,
        "image_width": fm.image_width,
        "image_height": fm.image_height,
        "depth_width": fm.depth_width,
        "depth_height": fm.depth_height,
        "depth_format": fm.depth_format,
        "depth_units": fm.depth_units,
        "confidence_format": fm.confidence_format,
        "depth_status": fm.depth_status,
        "camera_transform": matrix_to_rows(fm.camera_transform),
        "camera_intrinsics": matrix_to_rows(fm.camera_intrinsics),
        "tracking_state": fm.tracking_state,
        "tracking_reason": fm.tracking_reason,
    }
    d.update(fm.extra)
    return d


# --------------------------------------------------------------------------- #
# Session info
# --------------------------------------------------------------------------- #

@dataclass
class SessionInfo:
    session_id: str
    format_version: int
    created_at: Optional[str] = None
    device_model: Optional[str] = None
    app_version: Optional[str] = None
    camera_transform_source: str = "ARCamera.transform"
    camera_transform_storage: str = "row-major nested arrays"
    camera_transform_modified: bool = False
    intrinsics_storage: str = "row-major nested arrays"
    sample_rate_hz: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)


def parse_session(obj: Dict[str, Any]) -> SessionInfo:
    if "session_id" not in obj:
        raise FormatError("session.json missing required key 'session_id'")
    fmt = int(obj.get("format_version", CAPTURE_FORMAT_VERSION))
    if fmt > CAPTURE_FORMAT_VERSION:
        warnings.warn(
            f"session format_version {fmt} newer than supported "
            f"{CAPTURE_FORMAT_VERSION}",
            stacklevel=2,
        )
    known = set(SessionInfo.__dataclass_fields__)
    extra = {k: v for k, v in obj.items() if k not in known}
    return SessionInfo(
        session_id=str(obj["session_id"]),
        format_version=fmt,
        created_at=obj.get("created_at"),
        device_model=obj.get("device_model"),
        app_version=obj.get("app_version"),
        camera_transform_source=obj.get("camera_transform_source", "ARCamera.transform"),
        camera_transform_storage=obj.get("camera_transform_storage", "row-major nested arrays"),
        camera_transform_modified=bool(obj.get("camera_transform_modified", False)),
        intrinsics_storage=obj.get("intrinsics_storage", "row-major nested arrays"),
        sample_rate_hz=obj.get("sample_rate_hz"),
        extra=extra,
    )


def session_to_dict(s: SessionInfo) -> Dict[str, Any]:
    d = {
        "format_version": s.format_version,
        "session_id": s.session_id,
        "created_at": s.created_at,
        "device_model": s.device_model,
        "app_version": s.app_version,
        "camera_transform_source": s.camera_transform_source,
        "camera_transform_storage": s.camera_transform_storage,
        "camera_transform_modified": s.camera_transform_modified,
        "intrinsics_storage": s.intrinsics_storage,
        "sample_rate_hz": s.sample_rate_hz,
    }
    d.update(s.extra)
    return d


# --------------------------------------------------------------------------- #
# metadata.jsonl reader (streaming, tolerant of a truncated trailing line)
# --------------------------------------------------------------------------- #

@dataclass
class JsonlIssue:
    line_number: int
    kind: str  # "bad_json" | "invalid_record"
    message: str


def iter_metadata(
    path: Path, *, strict: bool = True
) -> Iterator[Tuple[Optional[FrameMeta], Optional[JsonlIssue]]]:
    """Yield ``(FrameMeta, None)`` for good lines, ``(None, JsonlIssue)`` for bad.

    A truncated final line (common after a crash / interrupted flush) is
    reported as an issue rather than raising, so partial sessions stay
    inspectable.
    """
    with open(path, "r", encoding="utf-8") as fh:
        for i, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                yield None, JsonlIssue(i, "bad_json", str(e))
                continue
            try:
                fm = parse_frame_meta(obj, strict=strict)
            except FormatError as e:
                yield None, JsonlIssue(i, "invalid_record", str(e))
                continue
            yield fm, None


# --------------------------------------------------------------------------- #
# CaptureReader — high-level view over a capture directory
# --------------------------------------------------------------------------- #

class CaptureReader:
    """Bounded-memory reader over a capture directory.

    Loads ``session.json`` eagerly, streams ``metadata.jsonl`` on demand, and
    loads per-frame binaries only when requested — a 10-minute capture reads
    the same way as a 30-second one.
    """

    def __init__(self, root: str | Path, *, strict: bool = True):
        self.root = Path(root)
        self.strict = strict
        if not self.root.is_dir():
            raise FormatError(f"capture directory not found: {self.root}")
        session_path = self.root / "session.json"
        if not session_path.is_file():
            raise FormatError(f"missing session.json in {self.root}")
        with open(session_path, "r", encoding="utf-8") as fh:
            self.session = parse_session(json.load(fh))
        self.metadata_path = self.root / "metadata.jsonl"
        if not self.metadata_path.is_file():
            raise FormatError(f"missing metadata.jsonl in {self.root}")

    def frames(self) -> Iterator[FrameMeta]:
        """Yield valid frames only (skips malformed lines)."""
        for fm, issue in iter_metadata(self.metadata_path, strict=self.strict):
            if fm is not None:
                yield fm

    def iter_with_issues(self):
        return iter_metadata(self.metadata_path, strict=self.strict)

    def load_depth(self, fm: FrameMeta) -> Optional[np.ndarray]:
        if not fm.has_depth or fm.depth_path is None:
            return None
        raw = (self.root / fm.depth_path).read_bytes()
        return decode_depth(raw, fm.depth_width, fm.depth_height)

    def load_confidence(self, fm: FrameMeta) -> Optional[np.ndarray]:
        if fm.confidence_path is None:
            return None
        raw = (self.root / fm.confidence_path).read_bytes()
        return decode_confidence(raw, fm.depth_width, fm.depth_height)

    def rgb_path(self, fm: FrameMeta) -> Path:
        return self.root / fm.rgb_path


# --------------------------------------------------------------------------- #
# Checksums (used by the network layer; kept here so both sides agree)
# --------------------------------------------------------------------------- #

def sha256_hex(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()
