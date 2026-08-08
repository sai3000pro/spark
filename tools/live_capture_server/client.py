"""Reference phone client for the live capture protocol.

Shared by ``simulate_phone.py`` and the test-suite so there is ONE protocol
contract (the iOS app implements the same message sequence).  Implements:
hello handshake, clock sync (ping/pong), session begin/resume, local-first
bulk mirroring with per-payload checksum + ACK, reconnect with backoff, and
end-of-session manifest reconciliation with retry of missing/corrupt payloads.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from tools.arkit_capture.formats import sha256_hex
from tools.live_capture_server import protocol
from tools.live_capture_server.clock_sync import ClockSyncEstimator, estimate
from tools.live_capture_server.ws import WSClosed, ws_connect


@dataclass
class Frame:
    frame_id: int
    rgb: bytes
    depth: Optional[bytes]
    confidence: Optional[bytes]
    metadata: dict  # inspector-format frame metadata dict


class PhoneClient:
    def __init__(self, host: str, port: int, device_session_id: str = "dev-sim-0001",
                 app_version: str = "sim-1.0"):
        self.host = host
        self.port = port
        self.device_session_id = device_session_id
        self.app_version = app_version
        self.ws = None
        self.session_id: Optional[str] = None
        self.clock = ClockSyncEstimator()
        self._seq = 0
        # local manifest of what we intend the server to hold (source of truth)
        self.manifest: Dict[str, Dict[str, str]] = {}
        self.acked: set = set()  # (frame_id, payload_type)
        self.retries = 0

    # -- connection lifecycle --
    def connect(self) -> bool:
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
        self.ws = ws_connect(self.host, self.port, "/ws/phone")
        self._send(protocol.hello(self.device_session_id, protocol.CLIENT_PHONE,
                                  self.app_version))
        ack = self._recv_json()
        return bool(ack.get("accepted"))

    def reconnect(self, max_attempts: int = 8, base_delay: float = 0.05) -> bool:
        """Exponential backoff reconnect + session resume."""
        delay = base_delay
        for attempt in range(max_attempts):
            try:
                if self.connect():
                    if self.session_id:
                        self.begin(self.session_id)  # resume
                    return True
            except (WSClosed, OSError, ConnectionError):
                pass
            time.sleep(min(delay, 2.0))
            delay *= 2
        return False

    def _send(self, obj):
        self.ws.send_text(json.dumps(obj))

    def _recv_json(self) -> dict:
        return json.loads(self.ws.recv_text())

    # -- clock sync --
    def sync_clock(self, rounds: int = 5) -> ClockSyncEstimator:
        for i in range(rounds):
            t0 = time.time_ns()
            self._send({"type": protocol.T_PING, "protocol_version": protocol.PROTOCOL_VERSION,
                        "seq": i, "t0_client_ns": t0})
            pong = self._recv_json()
            t3 = time.time_ns()
            t1 = pong["t1_server_ns"]
            t2 = pong["t2_server_ns"]
            s = self.clock.add(t0, t1, t2, t3)
            self._send({"type": protocol.T_CLOCK_SAMPLE,
                        "protocol_version": protocol.PROTOCOL_VERSION,
                        "session_id": self.session_id,
                        "seq": i, "t0_client_ns": t0, "t1_server_ns": t1,
                        "t2_server_ns": t2, "t3_client_ns": t3,
                        "offset_ns": s.offset_ns, "rtt_ns": s.rtt_ns})
        return self.clock

    # -- session --
    def begin(self, session_id: Optional[str] = None) -> str:
        msg = {"type": protocol.T_BEGIN_SESSION,
               "protocol_version": protocol.PROTOCOL_VERSION,
               "device_session_id": self.device_session_id}
        if session_id:
            msg["session_id"] = session_id
        self._send(msg)
        ack = self._recv_json()
        self.session_id = ack["session_id"]
        return self.session_id

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def send_payload(self, frame_id: int, payload_type: str, data: bytes,
                     retries: int = 3) -> str:
        """Send one bulk payload; block for ACK. Returns 'stored'|'duplicate'.

        Records the payload in the local manifest first (local-first).  Retries
        on NACK / transient disconnect.
        """
        sha = sha256_hex(data)
        self.manifest.setdefault(str(frame_id), {})[payload_type] = sha
        for attempt in range(retries + 1):
            try:
                hdr = protocol.bulk_header(self.session_id, frame_id, payload_type,
                                           self._next_seq(), len(data), sha)
                self._send(hdr)
                self.ws.send_binary(data)
                resp = self._recv_json()
                if resp.get("type") == protocol.T_ACK:
                    self.acked.add((frame_id, payload_type))
                    return resp.get("status", "stored")
                # NACK -> retry
                self.retries += 1
            except (WSClosed, OSError, ConnectionError):
                self.retries += 1
                if not self.reconnect():
                    raise
        raise RuntimeError(f"payload {frame_id}/{payload_type} failed after retries")

    def send_frame(self, frame: Frame) -> Dict[str, str]:
        """Mirror a fully-persisted frame: metadata + rgb + depth + confidence."""
        results = {}
        meta_bytes = json.dumps(frame.metadata).encode("utf-8")
        results[protocol.PT_FRAME_METADATA] = self.send_payload(
            frame.frame_id, protocol.PT_FRAME_METADATA, meta_bytes)
        results[protocol.PT_RGB] = self.send_payload(
            frame.frame_id, protocol.PT_RGB, frame.rgb)
        if frame.depth is not None:
            results[protocol.PT_DEPTH] = self.send_payload(
                frame.frame_id, protocol.PT_DEPTH, frame.depth)
        if frame.confidence is not None:
            results[protocol.PT_CONFIDENCE] = self.send_payload(
                frame.frame_id, protocol.PT_CONFIDENCE, frame.confidence)
        return results

    # -- reconciliation --
    def end_session(self) -> dict:
        self._send({"type": protocol.T_END_SESSION,
                    "protocol_version": protocol.PROTOCOL_VERSION,
                    "session_id": self.session_id,
                    "manifest": {"frames": self.manifest}})
        return self._recv_json()

    def reconcile(self, frames_by_id: Dict[int, Frame], max_rounds: int = 5) -> dict:
        """Run end-of-session reconciliation, retrying missing/corrupt payloads."""
        result = self.end_session()
        rounds = 0
        while not result.get("complete") and rounds < max_rounds:
            rounds += 1
            for item in result.get("missing", []) + result.get("checksum_failures", []):
                fid = item["frame_id"]
                pt = item["payload_type"]
                fr = frames_by_id.get(fid)
                if fr is None:
                    continue
                data = self._payload_bytes(fr, pt)
                if data is not None:
                    self.send_payload(fid, pt, data)
            result = self.end_session()
        return result

    @staticmethod
    def _payload_bytes(frame: Frame, payload_type: str) -> Optional[bytes]:
        if payload_type == protocol.PT_RGB:
            return frame.rgb
        if payload_type == protocol.PT_DEPTH:
            return frame.depth
        if payload_type == protocol.PT_CONFIDENCE:
            return frame.confidence
        if payload_type == protocol.PT_FRAME_METADATA:
            return json.dumps(frame.metadata).encode("utf-8")
        return None

    def finalize(self) -> dict:
        self._send({"type": protocol.T_FINALIZE,
                    "protocol_version": protocol.PROTOCOL_VERSION,
                    "session_id": self.session_id})
        return self._recv_json()

    def close(self):
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None
