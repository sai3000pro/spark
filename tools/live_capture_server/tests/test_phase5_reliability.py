"""Phase 5: reliability, retry, reconciliation, restart, corruption, stress."""

import gc
import json
import tempfile
import unittest
from pathlib import Path

try:
    import resource
except ImportError:
    resource = None

from tools.live_capture_server import protocol
from tools.live_capture_server.client import PhoneClient
from tools.live_capture_server.synth import synth_frames
from tools.live_capture_server.tests.util import RunningServer


class TestReliability(unittest.TestCase):
    def test_disconnect_midsession_reconnect_completes(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(10, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            for fr in frames[:5]:
                c.send_frame(fr)
            c.ws.close()          # simulate Wi-Fi drop mid-session
            self.assertTrue(c.reconnect())
            for fr in frames[5:]:
                c.send_frame(fr)
            result = c.reconcile({f.frame_id: f for f in frames})
            self.assertTrue(result["complete"])
            self.assertEqual(result["missing"], [])
            c.close()

    def test_server_restart_recovers(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(8, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            for fr in frames[:4]:
                c.send_frame(fr)
            # Kill + restart server (in-memory state lost, disk persists).
            srv.restart()
            self.assertTrue(c.reconnect())
            for fr in frames[4:]:
                c.send_frame(fr)
            result = c.reconcile({f.frame_id: f for f in frames})
            # index rebuilt from disk => earlier frames not re-counted as missing
            self.assertTrue(result["complete"], result)
            self.assertEqual(result["missing"], [])
            self.assertEqual(result["checksum_failures"], [])
            c.close()

    def test_reconciliation_reuploads_missing(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(6, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            # Send all but one payload (simulate a lost depth for frame 3).
            for fr in frames:
                meta = json.dumps(fr.metadata).encode()
                c.send_payload(fr.frame_id, protocol.PT_FRAME_METADATA, meta)
                c.send_payload(fr.frame_id, protocol.PT_RGB, fr.rgb)
                if fr.frame_id != 3:
                    c.send_payload(fr.frame_id, protocol.PT_DEPTH, fr.depth)
                    c.send_payload(fr.frame_id, protocol.PT_CONFIDENCE, fr.confidence)
                else:
                    # record in manifest as if locally persisted but not yet sent
                    from tools.arkit_capture.formats import sha256_hex
                    c.manifest.setdefault("3", {})[protocol.PT_DEPTH] = sha256_hex(fr.depth)
                    c.manifest["3"][protocol.PT_CONFIDENCE] = sha256_hex(fr.confidence)
            result = c.reconcile({f.frame_id: f for f in frames})
            self.assertTrue(result["complete"])
            self.assertEqual(result["missing"], [])
            c.close()

    def test_corrupted_payload_retried(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            fr = synth_frames(1, depth_w=8, depth_h=6)[0]
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            # First send corrupt (declared sha != bytes) -> NACK; then correct.
            good = fr.depth
            bad_hdr = protocol.bulk_header(c.session_id, 0, protocol.PT_DEPTH, 1,
                                           len(good), "00" * 32)
            c.ws.send_text(json.dumps(bad_hdr))
            c.ws.send_binary(good)
            resp = json.loads(c.ws.recv_text())
            self.assertEqual(resp["type"], protocol.T_NACK)
            # correct retry
            status = c.send_payload(0, protocol.PT_DEPTH, good)
            self.assertEqual(status, "stored")
            c.close()

    def test_disconnect_near_stop(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(5, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            for fr in frames:
                c.send_frame(fr)
            c.ws.close()  # drop right before reconcile
            self.assertTrue(c.reconnect())
            result = c.reconcile({f.frame_id: f for f in frames})
            self.assertTrue(result["complete"])
            c.close()

    def test_long_stream_bounded_memory(self):
        # 300 frames streamed; server RAM must not grow with backlog because
        # payloads are written to disk immediately (not buffered).
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            gc.collect()
            rss_before = _rss_kb()
            frames = synth_frames(300, depth_w=8, depth_h=6)
            for fr in frames:
                c.send_frame(fr)
            result = c.reconcile({f.frame_id: f for f in frames})
            self.assertEqual(result["server_frames"], 300)
            self.assertTrue(result["complete"])
            gc.collect()
            rss_after = _rss_kb()
            if rss_before and rss_after:
                # allow generous slack; must not blow up ~linearly with payloads
                self.assertLess(rss_after - rss_before, 300_000)  # < ~300 MB
            c.close()


def _rss_kb():
    if resource is None:
        return None
    # ru_maxrss is bytes on macOS, kB on Linux; only used for a coarse bound.
    val = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return val // 1024 if val > 10_000_000 else val


if __name__ == "__main__":
    unittest.main()
