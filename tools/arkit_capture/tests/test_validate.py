"""Phase 2: corruption / validation tests."""

import tempfile
import unittest
from pathlib import Path


from tools.arkit_capture.fixtures import make_synthetic_session
from tools.arkit_capture.validate import RECOVERABLE, validate_capture


class TestValidation(unittest.TestCase):
    def _make(self, tmp, **kw):
        cap = Path(tmp) / "cap"
        make_synthetic_session(cap, **kw)
        return cap

    def test_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=4)
            r = validate_capture(cap)
            self.assertTrue(r.ok)
            self.assertEqual(r.valid_frames, 4)

    def test_missing_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2)
            (cap / "session.json").unlink()
            r = validate_capture(cap)
            self.assertFalse(r.ok)

    def test_truncated_jsonl(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=3)
            mp = cap / "metadata.jsonl"
            txt = mp.read_text().splitlines()
            txt[-1] = txt[-1][: len(txt[-1]) // 2]  # truncate last line
            mp.write_text("\n".join(txt) + "\n")
            r = validate_capture(cap)
            # partial session still inspectable, bad line flagged recoverable
            self.assertTrue(any(i.severity == RECOVERABLE for i in r.issues))
            self.assertGreaterEqual(r.valid_frames, 2)

    def test_missing_rgb(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2)
            (cap / "frames" / "000000.jpg").unlink()
            r = validate_capture(cap)
            self.assertTrue(any(i.code == "missing_rgb" for i in r.issues))
            self.assertFalse(r.ok)

    def test_wrong_depth_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2, depth_w=8, depth_h=6)
            (cap / "depth" / "000000.f32").write_bytes(b"\x00" * 10)  # wrong size
            r = validate_capture(cap)
            self.assertTrue(any(i.code == "depth_size" for i in r.issues))
            self.assertFalse(r.ok)

    def test_bad_json_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2)
            mp = cap / "metadata.jsonl"
            with open(mp, "a") as fh:
                fh.write("{not valid json\n")
            r = validate_capture(cap)
            self.assertTrue(any(i.code == "bad_json" for i in r.issues))

    def test_nan_matrix_rejected_as_recoverable(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2)
            mp = cap / "metadata.jsonl"
            lines = mp.read_text().splitlines()
            # Corrupt a matrix with NaN -> parse fails -> invalid_record (recoverable)
            lines[0] = lines[0].replace('"tracking_state": "normal"',
                                        '"tracking_state": "normal"').replace(
                "[[1.0, 0.0, 0.0, 0.0]", '[["nan", 0.0, 0.0, 0.0]')
            mp.write_text("\n".join(lines) + "\n")
            r = validate_capture(cap)
            self.assertTrue(any(i.code in ("invalid_record", "bad_json") for i in r.issues))

    def test_orphan_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2)
            (cap / "frames" / "999999.jpg").write_bytes(b"x")
            r = validate_capture(cap)
            self.assertTrue(any(i.code == "orphan_file" for i in r.issues))

    def test_duplicate_frame_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = self._make(tmp, n_frames=2)
            mp = cap / "metadata.jsonl"
            lines = mp.read_text().splitlines()
            lines.append(lines[0])  # duplicate first record
            mp.write_text("\n".join(lines) + "\n")
            r = validate_capture(cap)
            self.assertTrue(any(i.code == "duplicate_id" for i in r.issues))


if __name__ == "__main__":
    unittest.main()
