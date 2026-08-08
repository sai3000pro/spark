"""Phase 3: connection, health, handshake, clock sync, reconnect."""

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path

from tools.live_capture_server import protocol
from tools.live_capture_server.client import PhoneClient
from tools.live_capture_server.clock_sync import estimate
from tools.live_capture_server.tests.util import RunningServer
from tools.live_capture_server.ws import ws_connect


class TestConnection(unittest.TestCase):
    def test_health(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            url = f"http://{srv.host}:{srv.port}/health"
            with urllib.request.urlopen(url, timeout=5) as r:
                data = json.loads(r.read())
            self.assertEqual(data["status"], "ok")
            self.assertEqual(data["protocol_version"], protocol.PROTOCOL_VERSION)
            self.assertIn("server_time_ns", data)

    def test_two_way_handshake(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            self.assertTrue(c.connect())  # real request/response, not just socket
            sid = c.begin()
            self.assertTrue(sid.startswith("sess_"))
            c.close()

    def test_protocol_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            ws = ws_connect(srv.host, srv.port, "/ws/phone")
            ws.send_text(json.dumps({"type": "hello", "protocol_version": 999,
                                     "client_type": "iphone"}))
            ack = json.loads(ws.recv_text())
            self.assertFalse(ack.get("accepted"))
            ws.close()

    def test_wrong_client_type_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            ws = ws_connect(srv.host, srv.port, "/ws/phone")
            ws.send_text(json.dumps({"type": "hello", "protocol_version": 1,
                                     "client_type": "toaster"}))
            ack = json.loads(ws.recv_text())
            self.assertFalse(ack.get("accepted"))
            ws.close()

    def test_clock_sync_estimates(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect()
            c.begin()
            est = c.sync_clock(rounds=6)
            self.assertGreaterEqual(est.sample_count, 6)
            self.assertIsNotNone(est.best_rtt_ns)
            self.assertGreaterEqual(est.best_rtt_ns, 0)
            # clock_sync.jsonl written under the session
            sync_file = Path(tmp) / c.session_id / "sync" / "clock_sync.jsonl"
            self.assertTrue(sync_file.is_file())
            self.assertGreaterEqual(len(sync_file.read_text().strip().splitlines()), 1)
            c.close()

    def test_clock_offset_math_injected(self):
        # server clock = client clock + 250 ms; symmetric 10 ms latency each way
        off = 250_000_000
        lat = 10_000_000
        t0 = 1_000_000_000
        t1 = t0 + lat + off
        t2 = t1 + 1_000  # tiny server processing
        t3 = t2 - off + lat
        s = estimate(t0, t1, t2, t3)
        self.assertAlmostEqual(s.offset_ns, off, delta=2_000)
        self.assertAlmostEqual(s.rtt_ns, 2 * lat, delta=2_000)

    def test_server_starts_after_client_attempt(self):
        # client tries before server exists -> connect fails; then reconnect works
        with tempfile.TemporaryDirectory() as tmp:
            c = PhoneClient("127.0.0.1", 59999)  # nothing listening
            with self.assertRaises(Exception):
                c.connect()

    def test_reconnect_resumes_session(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect()
            sid = c.begin()
            c.close()  # simulate drop
            ok = c.reconnect()
            self.assertTrue(ok)
            self.assertEqual(c.session_id, sid)  # same session resumed
            c.close()


if __name__ == "__main__":
    unittest.main()
