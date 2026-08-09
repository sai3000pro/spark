#!/usr/bin/env python3
"""Gauzensplat live capture server (stdlib HTTP + WebSocket).

Endpoints:
    GET  /health            -> {"status":"ok","server_time_ns":...,"protocol_version":1}
    GET  /                   -> text/HTML dashboard
    GET  /status.json        -> machine-readable dashboard snapshot
    WS   /ws/phone           -> iPhone control + bulk sensor mirroring
    WS   /ws/odometry        -> ESP32 / rover odometry ingest

Run:
    python tools/live_capture_server/server.py --host 0.0.0.0 --port 8765 \
           --root live_sessions
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.live_capture_server import protocol  # noqa: E402
from tools.live_capture_server.clock_sync import ClockSyncEstimator  # noqa: E402
from tools.live_capture_server.dashboard import render_html, snapshot  # noqa: E402
from tools.live_capture_server.session_manager import SessionManager  # noqa: E402
from tools.live_capture_server.storage import StorageError  # noqa: E402
from tools.live_capture_server.ws import WSClosed, WSConnection, accept_key  # noqa: E402


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # injected by make_handler
    manager: SessionManager = None  # type: ignore
    server_start_ns: int = 0
    write_delay_s: float = 0.0  # test hook: artificial slow-server delay

    def log_message(self, fmt, *args):  # quieter
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    # -- HTTP --
    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({
                "status": "ok",
                "server_time_ns": time.time_ns(),
                "protocol_version": protocol.PROTOCOL_VERSION,
                "uptime_s": (time.time_ns() - self.server_start_ns) / 1e9,
            })
            return
        if self.path in ("/ws/phone", "/ws/odometry"):
            self._maybe_upgrade()
            return
        if self.path == "/status.json":
            self._send_json(snapshot(self.manager))
            return
        if self.path == "/" or self.path.startswith("/dashboard"):
            body = render_html(self.manager).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_json({"error": "not found"}, code=404)

    # -- WebSocket upgrade --
    def _maybe_upgrade(self):
        upgrade = self.headers.get("Upgrade", "").lower()
        key = self.headers.get("Sec-WebSocket-Key")
        if upgrade != "websocket" or not key:
            self._send_json({"error": "expected websocket upgrade"}, code=400)
            return
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_key(key)}\r\n\r\n"
        )
        self.wfile.write(resp.encode("ascii"))
        self.wfile.flush()
        ws = WSConnection(self.connection, mask_out=False)
        self.close_connection = True  # don't reuse for HTTP after WS
        try:
            if self.path == "/ws/phone":
                PhoneSession(self.manager, ws, self.write_delay_s).run()
            else:
                OdometrySession(self.manager, ws).run()
        except WSClosed:
            pass
        except Exception as e:  # keep the server alive on any client error
            if getattr(self.server, "verbose", False):
                sys.stderr.write(f"[ws] handler error: {e}\n")


class PhoneSession:
    """One phone WebSocket connection's control + bulk-ingest loop."""

    def __init__(self, manager: SessionManager, ws: WSConnection, write_delay_s: float = 0.0):
        self.manager = manager
        self.ws = ws
        self.write_delay_s = write_delay_s
        self.store = None
        self.pending_header: Optional[dict] = None
        self.clock = ClockSyncEstimator()

    def _send(self, obj):
        self.ws.send_text(json.dumps(obj))

    def run(self):
        while True:
            op, data = self.ws.recv()
            if op == 0x2:  # binary payload
                self._on_binary(data)
            else:
                self._on_text(data.decode("utf-8"))

    def _on_text(self, text: str):
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            self._send({"type": protocol.T_ERROR, "reason": "bad json"})
            return
        t = msg.get("type")
        try:
            protocol.check_protocol_version(msg) if t not in (protocol.T_HELLO,) else None
        except protocol.ProtocolError as e:
            self._send({"type": protocol.T_ERROR, "reason": str(e), "fatal": True})
            return

        if t == protocol.T_HELLO:
            self._handle_hello(msg)
        elif t == protocol.T_PING:
            self._handle_ping(msg)
        elif t == protocol.T_CLOCK_SAMPLE:
            self._handle_clock_sample(msg)
        elif t == protocol.T_BEGIN_SESSION:
            self._handle_begin(msg)
        elif t == protocol.T_BULK_HEADER:
            self._handle_bulk_header(msg)
        elif t == protocol.T_END_SESSION:
            self._handle_end(msg)
        elif t == protocol.T_FINALIZE:
            self._handle_finalize(msg)
        else:
            self._send({"type": protocol.T_ERROR, "reason": f"unknown type {t}"})

    def _handle_hello(self, msg):
        try:
            protocol.check_protocol_version(msg)
        except protocol.ProtocolError as e:
            self._send({"type": protocol.T_HELLO_ACK, "accepted": False, "reason": str(e)})
            return
        if msg.get("client_type") != protocol.CLIENT_PHONE:
            self._send({"type": protocol.T_HELLO_ACK, "accepted": False,
                        "reason": "wrong client_type"})
            return
        self._send({
            "type": protocol.T_HELLO_ACK,
            "protocol_version": protocol.PROTOCOL_VERSION,
            "accepted": True,
            "server_time_ns": time.time_ns(),
        })

    def _handle_ping(self, msg):
        t1 = time.time_ns()
        self._send({
            "type": protocol.T_PONG,
            "protocol_version": protocol.PROTOCOL_VERSION,
            "seq": msg.get("seq"),
            "t0_client_ns": msg.get("t0_client_ns"),
            "t1_server_ns": t1,
            "t2_server_ns": time.time_ns(),
        })

    def _handle_clock_sample(self, msg):
        if self.store is not None:
            self.store.store_clock_sync("phone", {
                k: msg.get(k) for k in
                ("t0_client_ns", "t1_server_ns", "t2_server_ns", "t3_client_ns",
                 "offset_ns", "rtt_ns", "seq")
            })

    def _handle_begin(self, msg):
        sid = msg.get("session_id")
        dsid = msg.get("device_session_id")
        if sid:  # resume existing
            self.store = self.manager.get_or_create(sid, device_session_id=dsid)
        else:
            self.store = self.manager.create(device_session_id=dsid)
        # Optional, additive: persist a capture location if the phone sent one.
        lat = msg.get("latitude")
        lng = msg.get("longitude")
        place = msg.get("place_name")
        if lat is not None or lng is not None or place is not None:
            try:
                self.store.set_place(latitude=lat, longitude=lng, place_name=place)
            except Exception:
                pass
        self._send({
            "type": protocol.T_SESSION_ACK,
            "protocol_version": protocol.PROTOCOL_VERSION,
            "session_id": self.store.session_id,
            "device_session_id": dsid,
        })

    def _handle_bulk_header(self, msg):
        if self.store is None:
            self._send({"type": protocol.T_NACK, "reason": "no session"})
            self.pending_header = None
            return
        try:
            protocol.sanitize_session_id(msg["session_id"])
        except protocol.ProtocolError as e:
            self._send({"type": protocol.T_NACK, "reason": str(e)})
            self.pending_header = None
            return
        self.pending_header = msg

    def _on_binary(self, data: bytes):
        hdr = self.pending_header
        self.pending_header = None
        if hdr is None:
            self._send({"type": protocol.T_NACK, "reason": "binary without header"})
            return
        if self.write_delay_s:
            time.sleep(self.write_delay_s)
        frame_id = hdr["frame_id"]
        ptype = hdr["payload_type"]
        seq = hdr.get("sequence")
        if len(data) != hdr.get("byte_length", len(data)):
            self._send({"type": protocol.T_NACK, "frame_id": frame_id,
                        "payload_type": ptype, "sequence": seq,
                        "reason": "byte_length mismatch"})
            return
        try:
            status = self.store.store_payload(frame_id, ptype, hdr["sha256"], data,
                                              meta=hdr.get("meta"))
        except (StorageError, Exception) as e:
            self._send({"type": protocol.T_NACK, "frame_id": frame_id,
                        "payload_type": ptype, "sequence": seq, "reason": str(e)})
            return
        self._send({"type": protocol.T_ACK, "frame_id": frame_id,
                    "payload_type": ptype, "sequence": seq, "status": status})

    def _handle_end(self, msg):
        if self.store is None:
            self._send({"type": protocol.T_ERROR, "reason": "no session"})
            return
        self.store.flush_metadata()
        result = self.store.reconcile(msg.get("manifest", {"frames": {}}))
        self.manager.fire_end(self.store.session_id)
        self._send(result)

    def _handle_finalize(self, msg):
        if self.store is not None:
            self.store.finalize()
        self._send({"type": protocol.T_OK, "finalized": True})


class OdometrySession:
    def __init__(self, manager: SessionManager, ws: WSConnection):
        self.manager = manager
        self.ws = ws
        self.store = None

    def _send(self, obj):
        self.ws.send_text(json.dumps(obj))

    def run(self):
        while True:
            op, data = self.ws.recv()
            if op != 0x1:
                continue
            self._on_text(data.decode("utf-8"))

    def _on_text(self, text):
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            self._send({"type": protocol.T_ERROR, "reason": "bad json"})
            return
        t = msg.get("type")
        if t == protocol.T_HELLO:
            try:
                protocol.check_protocol_version(msg)
            except protocol.ProtocolError as e:
                self._send({"type": protocol.T_HELLO_ACK, "accepted": False, "reason": str(e)})
                return
            self._send({"type": protocol.T_HELLO_ACK, "accepted": True,
                        "protocol_version": protocol.PROTOCOL_VERSION,
                        "server_time_ns": time.time_ns()})
        elif t == protocol.T_PING:
            self._send({"type": protocol.T_PONG, "seq": msg.get("seq"),
                        "t0_client_ns": msg.get("t0_client_ns"),
                        "t1_server_ns": time.time_ns(),
                        "t2_server_ns": time.time_ns(),
                        "protocol_version": protocol.PROTOCOL_VERSION})
        elif t == protocol.T_ODOMETRY:
            try:
                protocol.check_protocol_version(msg)
                sid = protocol.sanitize_session_id(msg["session_id"])
            except protocol.ProtocolError as e:
                self._send({"type": protocol.T_NACK, "reason": str(e)})
                return
            self.store = self.manager.get_or_create(sid)
            st = self.store.store_odometry(msg, time.time_ns())
            self._send({"type": protocol.T_ACK, "sequence": msg.get("sequence"),
                        "received": st.received})
        elif t == protocol.T_CLOCK_SAMPLE:
            if msg.get("session_id"):
                store = self.manager.get_or_create(protocol.sanitize_session_id(msg["session_id"]))
                store.store_clock_sync(msg.get("device_id", "esp32"), {
                    k: msg.get(k) for k in
                    ("t0_client_ns", "t1_server_ns", "t2_server_ns", "t3_client_ns",
                     "offset_ns", "rtt_ns", "seq")
                })
        else:
            self._send({"type": protocol.T_ERROR, "reason": f"unknown type {t}"})


def make_server(host: str, port: int, root: Path, *, verbose=False,
                write_delay_s: float = 0.0) -> ThreadingHTTPServer:
    manager = SessionManager(root)

    class BoundHandler(Handler):
        pass

    BoundHandler.manager = manager
    BoundHandler.server_start_ns = time.time_ns()
    BoundHandler.write_delay_s = write_delay_s

    httpd = ThreadingHTTPServer((host, port), BoundHandler)
    httpd.daemon_threads = True
    httpd.verbose = verbose  # type: ignore
    httpd.manager = manager  # type: ignore
    return httpd


def main(argv=None):
    ap = argparse.ArgumentParser(description="Gauzensplat live capture server")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--root", default="live_sessions")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--write-delay-ms", type=float, default=0.0,
                    help="artificial per-payload write delay (slow-server test)")
    args = ap.parse_args(argv)

    httpd = make_server(args.host, args.port, Path(args.root),
                        verbose=args.verbose, write_delay_s=args.write_delay_ms / 1000.0)
    ip = lan_ip()
    print("Gauzensplat Live Capture Server\n")
    print(f"Listening:        http://{ip}:{args.port}")
    print(f"Health:           http://{ip}:{args.port}/health")
    print(f"Dashboard:        http://{ip}:{args.port}/")
    print(f"Phone WebSocket:  ws://{ip}:{args.port}/ws/phone")
    print(f"ESP32 WebSocket:  ws://{ip}:{args.port}/ws/odometry")
    print(f"Session root:     {Path(args.root).resolve()}\n")
    print("If the Mac firewall prompts, allow incoming connections for python3.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        httpd.manager.close_all()  # type: ignore
        httpd.server_close()


if __name__ == "__main__":
    main()
