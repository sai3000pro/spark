"""Phase 7: full synchronized session end-to-end.

phone (local-first mirror, with a mid-session disconnect + duplicate) +
esp32 odometry + clock sync, all under ONE server session, then the offline
inspector runs directly on the server-received phone capture.
"""

import tempfile
import threading
import unittest
from pathlib import Path

from tools.arkit_capture.inspect_capture import inspect
from tools.live_capture_server import protocol
from tools.live_capture_server.client import PhoneClient
from tools.live_capture_server.odometry_client import OdometryClient
from tools.live_capture_server.synth import odometry_payload, synth_frames
from tools.live_capture_server.tests.util import RunningServer


class TestFullE2E(unittest.TestCase):
    def test_synchronized_session(self):
        sid = "sess_e2e_0001"
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            # --- phone: connect, fixed session id, clock sync ---
            pc = PhoneClient(srv.host, srv.port)
            pc.connect()
            pc.begin(sid)
            pc.sync_clock(5)

            frames = synth_frames(30, step_m=0.2, depth_w=16, depth_h=12)
            fdict = {f.frame_id: f for f in frames}

            # --- esp32: attach to same session, stream odometry in a thread ---
            odo = OdometryClient(srv.host, srv.port)
            odo.connect()
            odo.sync_clock(sid, 5)
            odo_error = []

            def pump_odometry():
                try:
                    for seq in range(100):
                        odo.send(sid, seq, seq * 20000,
                                 odometry_payload("circle", seq, 0.02))
                except Exception as e:  # pragma: no cover
                    odo_error.append(e)

            t = threading.Thread(target=pump_odometry)
            t.start()

            # --- phone streams with a disconnect at frame 12 + a duplicate ---
            for fr in frames:
                if fr.frame_id == 12:
                    pc.ws.close()
                    self.assertTrue(pc.reconnect())  # resumes same session
                pc.send_frame(fr)
                if fr.frame_id == 7:
                    pc.send_payload(7, protocol.PT_RGB, fr.rgb)  # duplicate

            t.join()
            self.assertEqual(odo_error, [])

            # --- reconciliation: 0 missing final payloads ---
            result = pc.reconcile(fdict)
            self.assertTrue(result["complete"], result)
            self.assertEqual(result["missing"], [])
            self.assertEqual(result["checksum_failures"], [])
            self.assertEqual(result["server_frames"], 30)
            pc.finalize()
            pc.close()
            odo.close()

            base = Path(tmp) / sid

            # --- inspector on the server-received phone capture ---
            out = Path(tmp) / "report"
            summary = inspect(base / "phone", out, subsample=1)
            self.assertTrue(summary["validation"]["ok"], summary["validation"])
            self.assertEqual(summary["trajectory"]["frame_count"], 30)
            self.assertAlmostEqual(summary["trajectory"]["path_length_m"],
                                   0.2 * 29, places=3)
            self.assertEqual(summary["lidar_cloud"]["point_count"], 30 * 16 * 12)

            # --- odometry stored under the SAME session ---
            odo_file = base / "rover" / "odometry.jsonl"
            self.assertEqual(len(odo_file.read_text().strip().splitlines()), 100)
            st = srv.manager.get(sid).snapshot()["odometry"]
            self.assertEqual(st["esp32-sim-01"]["received"], 100)
            self.assertEqual(st["esp32-sim-01"]["missing_count"], 0)

            # --- clock sync records for BOTH devices ---
            sync = (base / "sync" / "clock_sync.jsonl").read_text().strip().splitlines()
            devices = {__import__("json").loads(l)["device"] for l in sync}
            self.assertTrue(any("phone" in d for d in devices))
            self.assertTrue(any("esp32" in d for d in devices))

            # --- raw device timestamps preserved (never overwritten) ---
            import json as _json
            rec = _json.loads(odo_file.read_text().splitlines()[5])
            self.assertIn("device_time_us", rec)
            self.assertIn("server_arrival_ns", rec)


if __name__ == "__main__":
    unittest.main()
