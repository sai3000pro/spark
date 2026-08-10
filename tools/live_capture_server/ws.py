"""Minimal, self-contained RFC 6455 WebSocket (server + client).

Supports text/binary/ping/pong/close, client masking, fragmented messages,
and 7/16/64-bit payload lengths.  Bounded per-message memory (a max frame size
guards against a malicious/huge length).  Blocking sockets; one thread per
connection on the server side.
"""

from __future__ import annotations

import base64
import hashlib
import os
import socket
import struct
from typing import Tuple

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONT = 0x0
OP_TEXT = 0x1
OP_BINARY = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

MAX_MESSAGE_BYTES = 64 * 1024 * 1024  # 64 MiB hard cap per message


class WSError(Exception):
    pass


class WSClosed(Exception):
    pass


def accept_key(sec_websocket_key: str) -> str:
    digest = hashlib.sha1((sec_websocket_key + WS_GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


class WSConnection:
    """A framed WebSocket connection over a blocking socket."""

    def __init__(self, sock: socket.socket, mask_out: bool):
        self.sock = sock
        self.mask_out = mask_out
        self._rf = sock.makefile("rb")
        self._closed = False

    # -- low level --
    def _read_exact(self, n: int) -> bytes:
        buf = self._rf.read(n)
        if buf is None or len(buf) < n:
            raise WSClosed("socket closed during read")
        return buf

    def _send_frame(self, opcode: int, data: bytes) -> None:
        if self._closed:
            raise WSClosed("connection closed")
        b0 = 0x80 | opcode  # FIN + opcode
        length = len(data)
        header = bytearray([b0])
        mask_bit = 0x80 if self.mask_out else 0x00
        if length < 126:
            header.append(mask_bit | length)
        elif length < 65536:
            header.append(mask_bit | 126)
            header += struct.pack("!H", length)
        else:
            header.append(mask_bit | 127)
            header += struct.pack("!Q", length)
        if self.mask_out:
            key = os.urandom(4)
            header += key
            data = bytes(b ^ key[i % 4] for i, b in enumerate(data))
        try:
            self.sock.sendall(bytes(header) + data)
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            self._closed = True
            raise WSClosed(str(e))

    def send_text(self, text: str) -> None:
        self._send_frame(OP_TEXT, text.encode("utf-8"))

    def send_binary(self, data: bytes) -> None:
        self._send_frame(OP_BINARY, data)

    def send_ping(self, data: bytes = b"") -> None:
        self._send_frame(OP_PING, data)

    def send_pong(self, data: bytes = b"") -> None:
        self._send_frame(OP_PONG, data)

    def _read_one_frame(self) -> Tuple[bool, int, bytes]:
        b0, b1 = self._read_exact(2)
        fin = bool(b0 & 0x80)
        opcode = b0 & 0x0F
        masked = bool(b1 & 0x80)
        length = b1 & 0x7F
        if length == 126:
            (length,) = struct.unpack("!H", self._read_exact(2))
        elif length == 127:
            (length,) = struct.unpack("!Q", self._read_exact(8))
        if length > MAX_MESSAGE_BYTES:
            raise WSError(f"frame too large: {length}")
        mask = self._read_exact(4) if masked else None
        payload = self._read_exact(length) if length else b""
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return fin, opcode, payload

    def recv(self) -> Tuple[int, bytes]:
        """Return (opcode, data) for the next TEXT/BINARY message.

        Handles ping (auto-pong), pong (ignored), close (raises WSClosed),
        and fragmentation transparently.  Raises WSClosed on disconnect.
        """
        frag_op = None
        chunks = []
        total = 0
        while True:
            fin, opcode, payload = self._read_one_frame()
            if opcode == OP_CLOSE:
                self._closed = True
                raise WSClosed("peer sent close")
            if opcode == OP_PING:
                self.send_pong(payload)
                continue
            if opcode == OP_PONG:
                continue
            if opcode == OP_CONT:
                if frag_op is None:
                    raise WSError("continuation without start")
                chunks.append(payload)
            elif opcode in (OP_TEXT, OP_BINARY):
                frag_op = opcode
                chunks.append(payload)
            else:
                raise WSError(f"unexpected opcode {opcode}")
            total += len(payload)
            if total > MAX_MESSAGE_BYTES:
                raise WSError("message too large")
            if fin:
                data = b"".join(chunks)
                return frag_op, data

    def recv_text(self) -> str:
        op, data = self.recv()
        if op != OP_TEXT:
            raise WSError("expected text frame")
        return data.decode("utf-8")

    def close(self, code: int = 1000) -> None:
        if self._closed:
            return
        try:
            self._send_frame(OP_CLOSE, struct.pack("!H", code))
        except Exception:
            pass
        self._closed = True
        try:
            self._rf.close()
            self.sock.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Client
# --------------------------------------------------------------------------- #

def ws_connect(host: str, port: int, path: str, timeout: float = 10.0) -> WSConnection:
    """Open a client WebSocket connection (performs the RFC 6455 handshake)."""
    sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(None)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(req.encode("ascii"))
    rf = sock.makefile("rb")
    status_line = rf.readline().decode("iso-8859-1").strip()
    if "101" not in status_line:
        # drain headers for a clearer error
        raise WSError(f"handshake failed: {status_line!r}")
    accept = None
    while True:
        line = rf.readline().decode("iso-8859-1")
        if line in ("\r\n", "\n", ""):
            break
        if line.lower().startswith("sec-websocket-accept:"):
            accept = line.split(":", 1)[1].strip()
    if accept != accept_key(key):
        raise WSError("bad Sec-WebSocket-Accept")
    rf.close()
    return WSConnection(sock, mask_out=True)
