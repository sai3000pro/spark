"""Phase 6: ESP32 odometry ingest — sequences, gaps, duplicates, order, rates."""

import json
import tempfile
import unittest
from pathlib import Path

from tools.live_capture_server import protocol
from tools.live_capture_server.odometry_client import OdometryClient
from tools.live_capture_server.synth import odometry_payload
from tools.live_capture_server.tests.util import RunningServer


class TestOdometry(unittest.TestCase):
    def _client(self, srv):
        c = OdometryClient(srv.host, srv.port)
        self.assertTrue(c.connect())
        return c

    def test_basic_ingest_stored_independently(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            store = srv.manager.create()
            sid = store.session_id
            c = self._client(srv)
            for seq in range(20):
                c.send(sid, seq, seq * 50000, odometry_payload("circle", seq, 0.05))
            st = srv.manager.get(sid).snapshot()["odometry"]
            self.assertEqual(st["esp32-sim-01"]["received"], 20)
            # rover/odometry.jsonl exists and has 20 lines
            odo = Path(tmp) / sid / "rover" / "odometry.jsonl"
            self.assertEqual(len(odo.read_text().strip().splitlines()), 20)
            c.close()

    def test_sequence_gap_detected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            sid = srv.manager.create().session_id
            c = self._client(srv)
            for seq in [0, 1, 2, 5, 6]:  # missing 3,4
                c.send(sid, seq, seq, {"x_m": 0})
            st = srv.manager.get(sid)._odom["esp32-sim-01"]
            self.assertEqual(sorted(st.missing_sequences()), [3, 4])
            c.close()

    def test_duplicate_detected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            sid = srv.manager.create().session_id
            c = self._client(srv)
            c.send(sid, 0, 0, {"x_m": 0})
            c.send(sid, 0, 0, {"x_m": 0})  # duplicate
            st = srv.manager.get(sid).snapshot()["odometry"]["esp32-sim-01"]
            self.assertEqual(st["received"], 1)
            self.assertEqual(st["duplicates"], 1)
            c.close()

    def test_out_of_order_detected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            sid = srv.manager.create().session_id
            c = self._client(srv)
            for seq in [0, 1, 3, 2, 4]:
                c.send(sid, seq, seq, {"x_m": 0})
            st = srv.manager.get(sid).snapshot()["odometry"]["esp32-sim-01"]
            self.assertEqual(st["out_of_order"], 1)  # seq 2 after 3
            c.close()

    def test_high_rate_stream(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            sid = srv.manager.create().session_id
            c = self._client(srv)
            n = 500  # ~100 Hz for 5 s worth
            for seq in range(n):
                c.send(sid, seq, seq * 10000, odometry_payload("straight", seq, 0.01))
            st = srv.manager.get(sid).snapshot()["odometry"]["esp32-sim-01"]
            self.assertEqual(st["received"], n)
            self.assertEqual(st["missing_count"], 0)
            c.close()

    def test_protocol_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            sid = srv.manager.create().session_id
            c = self._client(srv)
            c.ws.send_text(json.dumps({"type": protocol.T_ODOMETRY,
                                       "protocol_version": 999, "session_id": sid,
                                       "device_id": "x", "sequence": 0,
                                       "device_time_us": 0, "payload": {}}))
            resp = json.loads(c.ws.recv_text())
            self.assertEqual(resp["type"], protocol.T_NACK)
            c.close()

    def test_wrong_session_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = self._client(srv)
            # path traversal / invalid session id
            c.ws.send_text(json.dumps({"type": protocol.T_ODOMETRY,
                                       "protocol_version": 1, "session_id": "../evil",
                                       "device_id": "x", "sequence": 0,
                                       "device_time_us": 0, "payload": {}}))
            resp = json.loads(c.ws.recv_text())
            self.assertEqual(resp["type"], protocol.T_NACK)
            c.close()

    def test_clock_sync_records_stored(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            sid = srv.manager.create().session_id
            c = self._client(srv)
            c.sync_clock(sid, rounds=4)
            sync = Path(tmp) / sid / "sync" / "clock_sync.jsonl"
            self.assertTrue(sync.is_file())
            lines = sync.read_text().strip().splitlines()
            self.assertGreaterEqual(len(lines), 4)
            self.assertIn("esp32", json.loads(lines[0])["device"])
            c.close()

    def test_esp32_absent_phone_still_works(self):
        # simulator not run at all; a phone session is unaffected (independence)
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            store = srv.manager.create()
            self.assertEqual(store.snapshot()["odometry"], {})


if __name__ == "__main__":
    unittest.main()
