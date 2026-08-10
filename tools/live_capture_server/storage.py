"""Server-side session storage.

Writes the SAME on-disk layout the offline recorder produces, so the inspector
runs directly on a received session:

    live_sessions/<session_id>/
        phone/
            frames/ depth/ confidence/ metadata.jsonl
        rover/odometry.jsonl
        sync/clock_sync.jsonl
        server_session.json

Bulk payloads are written atomically (temp -> fsync -> verify size+sha ->
rename).  Re-delivery of the same (frame_id, payload_type, sha256) is
idempotent — it does not create duplicate files or re-append metadata.
Thread-safe (one lock per session).
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.arkit_capture import formats  # noqa: E402
from tools.live_capture_server import protocol  # noqa: E402


class StorageError(Exception):
    pass


@dataclass
class PayloadRecord:
    frame_id: int
    payload_type: str
    sha256: str
    byte_length: int


@dataclass
class OdometryStats:
    device_id: str
    received: int = 0
    duplicates: int = 0
    out_of_order: int = 0
    max_sequence: int = -1
    seen: Set[int] = field(default_factory=set)

    def missing_sequences(self) -> List[int]:
        if self.max_sequence < 0:
            return []
        return [s for s in range(0, self.max_sequence + 1) if s not in self.seen]


class SessionStore:
    def __init__(self, root: Path, session_id: str, device_session_id: Optional[str] = None):
        self.session_id = protocol.sanitize_session_id(session_id)
        self.root = Path(root) / self.session_id
        self.device_session_id = device_session_id
        self.phone_dir = self.root / "phone"
        self.rover_dir = self.root / "rover"
        self.sync_dir = self.root / "sync"
        self.meta_raw_dir = self.phone_dir / "metadata_raw"
        self.audio_dir = self.phone_dir / "audio"
        for d in (self.phone_dir / "frames", self.phone_dir / "depth",
                  self.phone_dir / "confidence", self.meta_raw_dir,
                  self.audio_dir, self.rover_dir, self.sync_dir):
            d.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        # optional capture location (set later via set_place from begin_session)
        self._latitude: Optional[float] = None
        self._longitude: Optional[float] = None
        self._place_name: Optional[str] = None
        # idempotency index: (frame_id, payload_type) -> sha256
        self._payloads: Dict[Tuple[int, str], str] = {}
        self._metadata: Dict[int, dict] = {}
        self._odom: Dict[str, OdometryStats] = {}
        self._bytes_written = 0
        self._errors = 0
        self._odom_fh = open(self.rover_dir / "odometry.jsonl", "a", encoding="utf-8")
        self._sync_fh = open(self.sync_dir / "clock_sync.jsonl", "a", encoding="utf-8")
        self._rebuild_index()
        self._write_server_session()

    def _rebuild_index(self):
        """Repopulate the idempotency index from any payloads already on disk.

        Lets a restarted server RESUME a session without forcing the phone to
        re-upload everything (reconciliation then reports 0 missing).
        """
        for pt, (subdir, ext) in protocol._PAYLOAD_LAYOUT.items():
            d = self.phone_dir / subdir
            if not d.is_dir():
                continue
            for f in d.iterdir():
                if not (f.is_file() and f.name.endswith(ext)):
                    continue
                try:
                    fid = int(f.stem)
                except ValueError:
                    continue
                data = f.read_bytes()
                self._payloads[(fid, pt)] = formats.sha256_hex(data)
        # raw frame_metadata payloads
        if self.meta_raw_dir.is_dir():
            for f in sorted(self.meta_raw_dir.glob("*.json")):
                try:
                    fid = int(f.stem)
                except ValueError:
                    continue
                data = f.read_bytes()
                self._payloads[(fid, protocol.PT_FRAME_METADATA)] = formats.sha256_hex(data)
                try:
                    self._load_metadata_record(fid, data)
                except Exception:
                    pass

    # ------------------------------------------------------------------ #
    def _place_dict(self) -> dict:
        """Optional capture-location keys, only present when explicitly set.

        Omitted entirely when unset so the json files are byte-identical to the
        pre-GPS behavior for clients that never send coords.
        """
        d = {}
        if self._latitude is not None:
            d["latitude"] = self._latitude
        if self._longitude is not None:
            d["longitude"] = self._longitude
        if self._place_name is not None:
            d["place_name"] = self._place_name
        return d

    def _write_server_session(self):
        info = {
            "session_id": self.session_id,
            "device_session_id": self.device_session_id,
            "protocol_version": protocol.PROTOCOL_VERSION,
            "capture_format_version": formats.CAPTURE_FORMAT_VERSION,
        }
        info.update(self._place_dict())
        (self.root / "server_session.json").write_text(json.dumps(info, indent=2))
        # phone/session.json makes the phone/ dir a valid capture for the inspector.
        sess = formats.SessionInfo(
            session_id=self.session_id,
            format_version=formats.CAPTURE_FORMAT_VERSION,
            device_model="live-mirror",
            extra=self._place_dict(),
        )
        (self.phone_dir / "session.json").write_text(
            json.dumps(formats.session_to_dict(sess), indent=2)
        )

    def set_place(self, latitude=None, longitude=None, place_name=None):
        """Persist an optional capture location from the begin_session handshake.

        Additive + defensive: invalid/absent values are ignored, and the two
        session json files are RE-WRITTEN (they were first written at
        construction, before coords arrive). Safe to call once per session.
        """
        with self._lock:
            changed = False
            if latitude is not None:
                try:
                    self._latitude = float(latitude)
                    changed = True
                except (TypeError, ValueError):
                    pass
            if longitude is not None:
                try:
                    self._longitude = float(longitude)
                    changed = True
                except (TypeError, ValueError):
                    pass
            if place_name is not None:
                try:
                    self._place_name = str(place_name)
                    changed = True
                except (TypeError, ValueError):
                    pass
            if changed:
                self._write_server_session()

    def _atomic_write(self, dest: Path, data: bytes):
        tmp_fd, tmp_path = tempfile.mkstemp(dir=str(dest.parent), suffix=".part")
        try:
            with os.fdopen(tmp_fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, dest)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    # ------------------------------------------------------------------ #
    def store_payload(self, frame_id: int, payload_type: str, sha256: str,
                      data: bytes, meta: Optional[dict] = None) -> str:
        """Store a bulk payload idempotently. Returns "stored" | "duplicate".

        Raises StorageError on size/checksum mismatch (caller NACKs).

        ``meta`` carries the bulk_header ``meta`` dict (only used today by audio
        payloads, to persist the PCM format once on the first chunk).
        """
        with self._lock:
            actual_sha = formats.sha256_hex(data)
            if actual_sha != sha256:
                self._errors += 1
                raise StorageError(
                    f"checksum mismatch frame {frame_id} {payload_type}: "
                    f"declared {sha256[:12]} got {actual_sha[:12]}"
                )
            key = (frame_id, payload_type)
            prev = self._payloads.get(key)
            if prev == sha256:
                return "duplicate"

            if payload_type == protocol.PT_FRAME_METADATA:
                self._store_metadata(frame_id, data)
            else:
                rel = protocol.payload_relpath(frame_id, payload_type)
                dest = self.phone_dir / rel
                self._atomic_write(dest, data)
                self._bytes_written += len(data)
                if payload_type == protocol.PT_AUDIO:
                    self._note_audio_format(meta)

            self._payloads[key] = sha256
            return "stored"

    def _note_audio_format(self, meta: Optional[dict]):
        """Persist the live-audio PCM format once (phone/audio.json).

        The transcription sidecar reads this to know the sample rate / dtype.
        Per-chunk PCM files (audio/NNNNNN.pcm) remain the source of truth and
        are concatenated in numeric (== chunk-sequence) order by the worker.
        """
        dest = self.phone_dir / "audio.json"
        if dest.exists():
            return
        m = meta or {}
        info = {
            "sample_rate": int(m.get("sample_rate", protocol.AUDIO_SAMPLE_RATE)),
            "channels": int(m.get("channels", protocol.AUDIO_CHANNELS)),
            "codec": str(m.get("codec", protocol.AUDIO_CODEC)),
            "start_session_time": m.get("start_session_time"),
        }
        self._atomic_write(dest, json.dumps(info, indent=2).encode("utf-8"))

    def _store_metadata(self, frame_id: int, data: bytes):
        # Persist the raw bytes so a restarted server can rebuild the index and
        # reconcile checksums exactly.
        self._atomic_write(self.meta_raw_dir / f"{frame_id:06d}.json", data)
        self._load_metadata_record(frame_id, data)
        self._bytes_written += len(data)

    def _load_metadata_record(self, frame_id: int, data: bytes):
        obj = json.loads(data.decode("utf-8"))
        # Validate + normalise; server owns the on-disk paths.
        fm = formats.parse_frame_meta(obj, strict=False)
        d = formats.frame_meta_to_dict(fm)
        d["rgb_path"] = protocol.payload_relpath(frame_id, protocol.PT_RGB)
        if fm.has_depth:
            d["depth_path"] = protocol.payload_relpath(frame_id, protocol.PT_DEPTH)
            d["confidence_path"] = protocol.payload_relpath(frame_id, protocol.PT_CONFIDENCE)
        self._metadata[frame_id] = d

    def flush_metadata(self):
        """(Re)write metadata.jsonl sorted by frame_id (inspector-ready)."""
        with self._lock:
            path = self.phone_dir / "metadata.jsonl"
            tmp = path.with_suffix(".jsonl.part")
            with open(tmp, "w", encoding="utf-8") as fh:
                for fid in sorted(self._metadata):
                    fh.write(json.dumps(self._metadata[fid]) + "\n")
            os.replace(tmp, path)

    # ------------------------------------------------------------------ #
    def store_odometry(self, msg: dict, server_arrival_ns: int) -> OdometryStats:
        with self._lock:
            device_id = str(msg.get("device_id", "unknown"))
            seq = int(msg["sequence"])
            st = self._odom.setdefault(device_id, OdometryStats(device_id=device_id))
            if seq in st.seen:
                st.duplicates += 1
                return st
            if seq < st.max_sequence:
                st.out_of_order += 1
            st.seen.add(seq)
            st.max_sequence = max(st.max_sequence, seq)
            st.received += 1
            record = dict(msg)
            record["server_arrival_ns"] = server_arrival_ns
            self._odom_fh.write(json.dumps(record) + "\n")
            self._odom_fh.flush()
            return st

    def store_clock_sync(self, device: str, sample: dict):
        with self._lock:
            rec = {"device": device, **sample}
            self._sync_fh.write(json.dumps(rec) + "\n")
            self._sync_fh.flush()

    # ------------------------------------------------------------------ #
    def inventory(self) -> Dict[str, Dict[str, str]]:
        """Return {str(frame_id): {payload_type: sha256}} of stored payloads."""
        with self._lock:
            inv: Dict[str, Dict[str, str]] = {}
            for (fid, pt), sha in self._payloads.items():
                inv.setdefault(str(fid), {})[pt] = sha
            return inv

    def reconcile(self, manifest: dict) -> dict:
        """Compare a phone manifest against stored payloads.

        manifest = {"frames": {frame_id: {payload_type: sha256}}, ...}
        Returns missing/corrupt lists and counts.
        """
        with self._lock:
            expected = manifest.get("frames", {})
            missing: List[dict] = []
            checksum_failures: List[dict] = []
            for fid_s, payloads in expected.items():
                fid = int(fid_s)
                for pt, sha in payloads.items():
                    have = self._payloads.get((fid, pt))
                    if have is None:
                        missing.append({"frame_id": fid, "payload_type": pt})
                    elif have != sha:
                        checksum_failures.append({"frame_id": fid, "payload_type": pt})
            local_frames = len(expected)
            server_frames = len({fid for (fid, _pt) in self._payloads})
            return {
                "type": protocol.T_RECONCILE,
                "protocol_version": protocol.PROTOCOL_VERSION,
                "session_id": self.session_id,
                "local_frames": local_frames,
                "server_frames": server_frames,
                "missing": missing,
                "checksum_failures": checksum_failures,
                "complete": len(missing) == 0 and len(checksum_failures) == 0,
            }

    def finalize(self):
        with self._lock:
            self.flush_metadata()
            summary = self.snapshot()
            (self.root / "reconciliation.json").write_text(json.dumps(summary, indent=2))

    def snapshot(self) -> dict:
        with self._lock:
            odom = {
                dev: {
                    "received": st.received,
                    "duplicates": st.duplicates,
                    "out_of_order": st.out_of_order,
                    "max_sequence": st.max_sequence,
                    "missing_count": len(st.missing_sequences()),
                }
                for dev, st in self._odom.items()
            }
            return {
                "session_id": self.session_id,
                "frames_stored": len({fid for (fid, _pt) in self._payloads}),
                "payloads_stored": len(self._payloads),
                "metadata_records": len(self._metadata),
                "bytes_written": self._bytes_written,
                "errors": self._errors,
                "odometry": odom,
            }

    def close(self):
        with self._lock:
            try:
                self._odom_fh.close()
            except Exception:
                pass
            try:
                self._sync_fh.close()
            except Exception:
                pass
