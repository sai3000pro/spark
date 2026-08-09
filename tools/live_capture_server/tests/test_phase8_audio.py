"""Phase 8: live audio streaming — PCM chunk storage, format sidecar, idempotency,
isolation from frame reconciliation, resume, and frame+audio interleaving."""

import json
import struct
import tempfile
import unittest
from pathlib import Path

from tools.arkit_capture.formats import sha256_hex
from tools.live_capture_server import protocol
from tools.live_capture_server.client import PhoneClient
from tools.live_capture_server.synth import synth_frames
from tools.live_capture_server.tests.util import RunningServer


def _pcm(seq: int, n: int = 800) -> bytes:
    """Deterministic 16-bit LE PCM chunk (small, so tests stay fast)."""
    return b"".join(struct.pack("<h", ((seq * 31 + i) % 1000) - 500) for i in range(n))


class TestAudioStreaming(unittest.TestCase):
    def test_chunks_stored_byte_for_byte_and_format_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            chunks = [_pcm(i) for i in range(3)]
            for i, ch in enumerate(chunks):
                status = c.send_audio_chunk(i, ch, start_session_time=float(i))
                self.assertEqual(status, "stored")
            adir = Path(tmp) / c.session_id / "phone" / "audio"
            for i, ch in enumerate(chunks):
                p = adir / f"{i:06d}.pcm"
                self.assertTrue(p.is_file(), f"missing chunk {i}")
                self.assertEqual(sha256_hex(p.read_bytes()), sha256_hex(ch))
            # audio.json written once, with the declared PCM format.
            fmt = json.loads((Path(tmp) / c.session_id / "phone" / "audio.json").read_text())
            self.assertEqual(fmt["sample_rate"], protocol.AUDIO_SAMPLE_RATE)
            self.assertEqual(fmt["channels"], protocol.AUDIO_CHANNELS)
            self.assertEqual(fmt["codec"], protocol.AUDIO_CODEC)
            self.assertEqual(fmt["start_session_time"], 0.0)
            c.close()

    def test_duplicate_chunk_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            ch = _pcm(0)
            self.assertEqual(c.send_audio_chunk(0, ch), "stored")
            self.assertEqual(c.send_audio_chunk(0, ch), "duplicate")  # exact resend
            snap = srv.manager.get(c.session_id).snapshot()
            self.assertEqual(snap["payloads_stored"], 1)
            c.close()

    def test_audio_absent_from_frame_manifest(self):
        # Audio is a best-effort live stream: it must NOT enter the frame manifest,
        # so end-of-session frame reconciliation is unaffected by audio.
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            c.send_audio_chunk(0, _pcm(0))
            c.send_audio_chunk(1, _pcm(1))
            self.assertEqual(c.manifest, {})  # nothing frame-side recorded
            frames = synth_frames(4, depth_w=8, depth_h=6)
            for fr in frames:
                c.send_frame(fr)
            result = c.reconcile({f.frame_id: f for f in frames})
            self.assertTrue(result["complete"])
            self.assertEqual(result["local_frames"], 4)
            c.close()

    def test_frames_and_audio_interleaved(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            frames = synth_frames(3, depth_w=8, depth_h=6)
            for i, fr in enumerate(frames):
                c.send_frame(fr)
                c.send_audio_chunk(i, _pcm(i))       # audio_seq collides with frame_id: fine
            result = c.reconcile({f.frame_id: f for f in frames})
            self.assertTrue(result["complete"])
            root = Path(tmp) / c.session_id / "phone"
            self.assertEqual(len(list((root / "frames").glob("*.jpg"))), 3)
            self.assertEqual(len(list((root / "audio").glob("*.pcm"))), 3)
            c.close()

    def test_audio_meta_defaults_when_absent(self):
        # A chunk sent with no meta still yields a valid audio.json (server defaults).
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            c.send_payload(0, protocol.PT_AUDIO, _pcm(0), record_manifest=False)  # no meta
            fmt = json.loads((Path(tmp) / c.session_id / "phone" / "audio.json").read_text())
            self.assertEqual(fmt["sample_rate"], protocol.AUDIO_SAMPLE_RATE)
            self.assertIsNone(fmt["start_session_time"])
            c.close()

    def test_resume_rebuilds_audio_index(self):
        # After a server restart, previously-stored audio chunks are recognised as
        # duplicates (idempotency index rebuilt from audio/*.pcm on disk).
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            sid = c.session_id
            ch = _pcm(0)
            self.assertEqual(c.send_audio_chunk(0, ch), "stored")
            c.close()
            srv.restart()
            c2 = PhoneClient(srv.host, srv.port)
            c2.connect(); c2.begin(sid)                     # resume same session
            self.assertEqual(c2.send_audio_chunk(0, ch), "duplicate")
            c2.close()


if __name__ == "__main__":
    unittest.main()
