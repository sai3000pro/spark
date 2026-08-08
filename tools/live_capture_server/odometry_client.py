"""Reference odometry (ESP32) client for the live capture protocol.

The real ESP32 firmware will implement the SAME message sequence, so it drops
in without changing the server's session model.
"""

from __future__ import annotations

import json
import time
from typing import Optional

from tools.live_capture_server import protocol
from tools.live_capture_server.clock_sync import ClockSyncEstimator
from tools.live_capture_server.ws import ws_connect


class OdometryClient:
    def __init__(self, host: str, port: int, device_id: str = "esp32-sim-01"):
        self.host = host
        self.port = port
        self.device_id = device_id
        self.ws = None
        self.clock = ClockSyncEstimator()

    def connect(self) -> bool:
        self.ws = ws_connect(self.host, self.port, "/ws/odometry")
        self._send(protocol.hello("odo-" + self.device_id, protocol.CLIENT_ESP32))
        ack = self._recv()
        return bool(ack.get("accepted"))

    def _send(self, obj):
        self.ws.send_text(json.dumps(obj))

    def _recv(self) -> dict:
        return json.loads(self.ws.recv_text())

    def sync_clock(self, session_id: str, rounds: int = 5) -> ClockSyncEstimator:
        for i in range(rounds):
            t0 = time.time_ns()
            self._send({"type": protocol.T_PING, "protocol_version": protocol.PROTOCOL_VERSION,
                        "seq": i, "t0_client_ns": t0})
            pong = self._recv()
            t3 = time.time_ns()
            s = self.clock.add(t0, pong["t1_server_ns"], pong["t2_server_ns"], t3)
            self._send({"type": protocol.T_CLOCK_SAMPLE,
                        "protocol_version": protocol.PROTOCOL_VERSION,
                        "session_id": session_id, "device_id": self.device_id,
                        "seq": i, "t0_client_ns": t0, "t1_server_ns": pong["t1_server_ns"],
                        "t2_server_ns": pong["t2_server_ns"], "t3_client_ns": t3,
                        "offset_ns": s.offset_ns, "rtt_ns": s.rtt_ns})
        return self.clock

    def send(self, session_id: str, sequence: int, device_time_us: int,
             payload: dict, expect_ack: bool = True) -> Optional[dict]:
        self._send(protocol.odometry_msg(session_id, self.device_id, sequence,
                                         device_time_us, payload))
        if expect_ack:
            return self._recv()
        return None

    def close(self):
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None
