"""Phase 4: live sensor mirroring — checksum equality, ordering, duplicates,
slow server, and inspector-on-received-session."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.arkit_capture.formats import CaptureReader, decode_depth, sha256_hex
from tools.arkit_capture.inspect_capture import inspect
from tools.live_capture_server import protocol
from tools.live_capture_server.client import PhoneClient
from tools.live_capture_server.synth import synth_frame, synth_frames
from tools.live_capture_server.tests.util import RunningServer


def mirror_session(host, port, frames, sync=False):
    c = PhoneClient(host, port)
    c.connect()
    c.begin()
    if sync:
        c.sync_clock(3)
    for fr in frames:
        c.send_frame(fr)
    result = c.reconcile({f.frame_id: f for f in frames})
    c.finalize()
    sid = c.session_id
    c.close()
    return sid, result


class TestMirroring(unittest.TestCase):
    def test_one_frame_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            fr = synth_frame(0, depth_w=16, depth_h=12)
            sid, result = mirror_session(srv.host, srv.port, [fr])
            self.assertTrue(result["complete"])
            # Depth bytes on disk identical to what we sent.
            depth_path = Path(tmp) / sid / "phone" / "depth" / "000000.f32"
            self.assertEqual(sha256_hex(depth_path.read_bytes()), sha256_hex(fr.depth))
            rgb_path = Path(tmp) / sid / "phone" / "frames" / "000000.jpg"
            self.assertEqual(rgb_path.read_bytes(), fr.rgb)

    def test_100_frames(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(100, depth_w=8, depth_h=6)
            sid, result = mirror_session(srv.host, srv.port, frames)
            self.assertEqual(result["local_frames"], 100)
            self.assertEqual(result["server_frames"], 100)
            self.assertEqual(result["missing"], [])
            self.assertEqual(result["checksum_failures"], [])
            self.assertTrue(result["complete"])
            snap = srv.manager.get(sid).snapshot()
            self.assertEqual(snap["frames_stored"], 100)

    def test_out_of_order_delivery(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(5, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            # send frame 2 before 1, etc.
            order = [0, 2, 1, 4, 3]
            for i in order:
                c.send_frame(frames[i])
            result = c.reconcile({f.frame_id: f for f in frames})
            c.finalize()
            self.assertTrue(result["complete"])
            # metadata.jsonl is sorted by frame_id despite arrival order.
            reader = CaptureReader(Path(tmp) / c.session_id / "phone", strict=False)
            ids = [fm.frame_id for fm in reader.frames()]
            self.assertEqual(ids, [0, 1, 2, 3, 4])
            c.close()

    def test_duplicate_delivery_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            fr = synth_frame(0, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            s1 = c.send_payload(0, protocol.PT_DEPTH, fr.depth)
            s2 = c.send_payload(0, protocol.PT_DEPTH, fr.depth)  # exact duplicate
            self.assertEqual(s1, "stored")
            self.assertEqual(s2, "duplicate")
            snap = srv.manager.get(c.session_id).snapshot()
            # only one depth payload stored
            self.assertEqual(snap["payloads_stored"], 1)
            c.close()

    def test_checksum_mismatch_nacked(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            import json
            data = b"hello depth bytes"
            bad = protocol.bulk_header(c.session_id, 0, protocol.PT_DEPTH, 1,
                                       len(data), "deadbeef" * 8)
            c.ws.send_text(json.dumps(bad))
            c.ws.send_binary(data)
            resp = json.loads(c.ws.recv_text())
            self.assertEqual(resp["type"], protocol.T_NACK)
            c.close()

    def test_slow_server_still_completes(self):
        with tempfile.TemporaryDirectory() as tmp, \
                RunningServer(Path(tmp), write_delay_s=0.01) as srv:
            frames = synth_frames(10, depth_w=8, depth_h=6)
            sid, result = mirror_session(srv.host, srv.port, frames)
            self.assertTrue(result["complete"])

    def test_inspector_runs_on_received_session(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(6, step_m=0.25, depth_value=2.0,
                                  depth_w=16, depth_h=12)
            sid, result = mirror_session(srv.host, srv.port, frames)
            self.assertTrue(result["complete"])
            # Run the OFFLINE inspector directly on the server-received session.
            phone_dir = Path(tmp) / sid / "phone"
            out = Path(tmp) / "report"
            summary = inspect(phone_dir, out, subsample=1)
            self.assertTrue(summary["validation"]["ok"], summary["validation"])
            self.assertEqual(summary["trajectory"]["frame_count"], 6)
            self.assertAlmostEqual(summary["trajectory"]["path_length_m"],
                                   0.25 * 5, places=4)
            self.assertEqual(summary["lidar_cloud"]["point_count"], 6 * 16 * 12)


if __name__ == "__main__":
    unittest.main()
