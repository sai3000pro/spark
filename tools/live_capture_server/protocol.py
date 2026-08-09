"""Wire protocol contract for the live capture server.

Distinct from the on-disk capture ``format_version``: this is
``PROTOCOL_VERSION`` (== ``NETWORK_PROTOCOL_VERSION`` in the capture formats).

All control/telemetry/odometry messages are JSON text frames with a ``type``
and ``protocol_version``.  Bulk payloads are a JSON ``bulk_header`` text frame
immediately followed by one binary frame carrying the bytes.

Payload identity (never inferred from arrival order):
    session_id + frame_id + payload_type (+ sequence, byte_length, sha256)

Security: the server NEVER writes to a client-provided path.  The on-disk path
is derived solely from ``frame_id`` + ``payload_type`` inside the session root.
"""

from __future__ import annotations

import re
from typing import Optional

PROTOCOL_VERSION = 1

# client_type values
CLIENT_PHONE = "iphone"
CLIENT_ESP32 = "esp32"

# payload types
PT_RGB = "rgb"
PT_DEPTH = "depth"
PT_CONFIDENCE = "confidence"
PT_FRAME_METADATA = "frame_metadata"
# Audio is streamed as sequential fixed-format PCM chunks.  It reuses the
# (frame_id, payload_type) identity model where frame_id == chunk sequence, so
# idempotency / resume / reconciliation all work exactly as for image frames.
PT_AUDIO = "audio"

_PAYLOAD_LAYOUT = {
    PT_RGB: ("frames", ".jpg"),
    PT_DEPTH: ("depth", ".f32"),
    PT_CONFIDENCE: ("confidence", ".u8"),
    PT_AUDIO: ("audio", ".pcm"),
}

# Default live-audio wire format (16 kHz mono signed 16-bit LE PCM — Whisper's
# native rate, cheapest downstream).  The actual values ride in the audio
# bulk_header ``meta`` and are persisted to phone/audio.json on first chunk.
AUDIO_SAMPLE_RATE = 16000
AUDIO_CHANNELS = 1
AUDIO_CODEC = "pcm_s16le"

# message type strings
T_HELLO = "hello"
T_HELLO_ACK = "hello_ack"
T_BEGIN_SESSION = "begin_session"
T_SESSION_ACK = "session_ack"
T_PING = "ping"
T_PONG = "pong"
T_BULK_HEADER = "bulk_header"
T_ACK = "ack"
T_NACK = "nack"
T_END_SESSION = "end_session"
T_RECONCILE = "reconcile"
T_ODOMETRY = "odometry"
T_CLOCK_SAMPLE = "clock_sample"
T_FINALIZE = "finalize"
T_OK = "ok"
T_ERROR = "error"

_SAFE_SESSION = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")


class ProtocolError(Exception):
    pass


def check_protocol_version(msg: dict) -> None:
    v = msg.get("protocol_version")
    if v is None:
        raise ProtocolError("missing protocol_version")
    if int(v) != PROTOCOL_VERSION:
        raise ProtocolError(
            f"unsupported protocol_version {v} (server supports {PROTOCOL_VERSION})"
        )


def sanitize_session_id(session_id: str) -> str:
    """Reject anything that could escape the capture root."""
    if not isinstance(session_id, str) or not _SAFE_SESSION.match(session_id):
        raise ProtocolError(f"invalid session_id {session_id!r}")
    return session_id


def payload_relpath(frame_id: int, payload_type: str) -> str:
    """Server-derived on-disk relative path for a bulk payload.

    Raises for unknown / non-file payload types (e.g. frame_metadata).
    """
    if not isinstance(frame_id, int) or frame_id < 0:
        raise ProtocolError(f"invalid frame_id {frame_id!r}")
    if payload_type not in _PAYLOAD_LAYOUT:
        raise ProtocolError(f"payload_type {payload_type!r} is not a file payload")
    subdir, ext = _PAYLOAD_LAYOUT[payload_type]
    return f"{subdir}/{frame_id:06d}{ext}"


def hello(device_session_id: str, client_type: str = CLIENT_PHONE,
          app_version: str = "sim") -> dict:
    return {
        "type": T_HELLO,
        "protocol_version": PROTOCOL_VERSION,
        "client_type": client_type,
        "device_session_id": device_session_id,
        "app_version": app_version,
    }


def bulk_header(session_id: str, frame_id: int, payload_type: str,
                sequence: int, byte_length: int, sha256: str,
                meta: Optional[dict] = None) -> dict:
    d = {
        "type": T_BULK_HEADER,
        "protocol_version": PROTOCOL_VERSION,
        "session_id": session_id,
        "frame_id": frame_id,
        "payload_type": payload_type,
        "sequence": sequence,
        "byte_length": byte_length,
        "sha256": sha256,
    }
    if meta is not None:
        d["meta"] = meta
    return d


def odometry_msg(session_id: str, device_id: str, sequence: int,
                 device_time_us: int, payload: dict) -> dict:
    return {
        "type": T_ODOMETRY,
        "protocol_version": PROTOCOL_VERSION,
        "session_id": session_id,
        "device_id": device_id,
        "sequence": sequence,
        "device_time_us": device_time_us,
        "payload": payload,
    }
