"""Phase 0 contract tests: matrices, depth/confidence codecs, metadata parsing."""

import json
import unittest
import warnings

import numpy as np

from tools.arkit_capture import formats
from tools.arkit_capture.formats import (
    FormatError,
    decode_confidence,
    decode_depth,
    encode_confidence,
    encode_depth,
    matrix_to_rows,
    parse_frame_meta,
    rows_to_matrix,
)


class TestMatrixSerialization(unittest.TestCase):
    def _roundtrip(self, mat):
        rows = matrix_to_rows(mat)
        # JSON round-trip to mimic on-wire storage.
        rows2 = json.loads(json.dumps(rows))
        back = rows_to_matrix(rows2, expected_n=mat.shape[0])
        np.testing.assert_allclose(back, mat, atol=1e-9)

    def test_identity(self):
        self._roundtrip(np.eye(4))

    def test_translation(self):
        T = np.eye(4)
        T[:3, 3] = [1.5, -2.0, 3.25]
        self._roundtrip(T)

    def test_rotation(self):
        th = 0.7
        R = np.eye(4)
        R[0, 0], R[0, 2] = math_cos(th), math_sin(th)
        R[2, 0], R[2, 2] = -math_sin(th), math_cos(th)
        self._roundtrip(R)

    def test_random_rigid(self):
        rng = np.random.default_rng(42)
        for _ in range(20):
            A = rng.standard_normal((3, 3))
            Q, _ = np.linalg.qr(A)
            if np.linalg.det(Q) < 0:
                Q[:, 0] *= -1
            T = np.eye(4)
            T[:3, :3] = Q
            T[:3, 3] = rng.standard_normal(3) * 5
            self._roundtrip(T)

    def test_intrinsics_3x3(self):
        K = np.array([[1000, 0, 960], [0, 1000, 720], [0, 0, 1]], dtype=float)
        self._roundtrip(K)

    def test_row_major_ordering(self):
        # Ensure [0][3] is the x-translation (row-major, not column-major).
        T = np.eye(4)
        T[0, 3] = 7.0
        rows = matrix_to_rows(T)
        self.assertEqual(rows[0][3], 7.0)
        self.assertEqual(rows[3][0], 0.0)

    def test_non_square_rejected(self):
        with self.assertRaises(FormatError):
            matrix_to_rows(np.zeros((3, 4)))

    def test_wrong_size_rejected(self):
        with self.assertRaises(FormatError):
            rows_to_matrix([[1, 0], [0, 1]], expected_n=4)

    def test_nan_rejected(self):
        with self.assertRaises(FormatError):
            rows_to_matrix([[float("nan"), 0, 0], [0, 1, 0], [0, 0, 1]], expected_n=3)


def math_cos(x):
    import math
    return math.cos(x)


def math_sin(x):
    import math
    return math.sin(x)


class TestDepthCodec(unittest.TestCase):
    def test_roundtrip(self):
        rng = np.random.default_rng(1)
        depth = rng.random((6, 8)).astype(np.float32) * 5
        raw = encode_depth(depth)
        self.assertEqual(len(raw), 6 * 8 * 4)
        back = decode_depth(raw, 8, 6)
        np.testing.assert_allclose(back, depth, atol=1e-6)

    def test_little_endian(self):
        depth = np.array([[1.0]], dtype=np.float32)
        raw = encode_depth(depth)
        self.assertEqual(raw, b"\x00\x00\x80\x3f")  # 1.0f LE

    def test_wrong_byte_count(self):
        with self.assertRaises(FormatError):
            decode_depth(b"\x00" * 10, 8, 6)


class TestConfidenceCodec(unittest.TestCase):
    def test_roundtrip(self):
        conf = np.array([[0, 1, 2], [2, 1, 0]], dtype=np.uint8)
        raw = encode_confidence(conf)
        self.assertEqual(len(raw), 6)
        back = decode_confidence(raw, 3, 2)
        np.testing.assert_array_equal(back, conf)

    def test_wrong_byte_count(self):
        with self.assertRaises(FormatError):
            decode_confidence(b"\x00" * 5, 3, 2)


class TestMetadataParsing(unittest.TestCase):
    def _base(self):
        return {
            "format_version": 1,
            "frame_id": 12,
            "timestamp": 42.184,
            "session_time": 12.042,
            "rgb_path": "frames/000012.jpg",
            "depth_path": "depth/000012.f32",
            "confidence_path": "confidence/000012.u8",
            "image_width": 1920,
            "image_height": 1440,
            "depth_width": 256,
            "depth_height": 192,
            "depth_format": "float32_le",
            "depth_units": "meters",
            "confidence_format": "uint8",
            "camera_transform": matrix_to_rows(np.eye(4)),
            "camera_intrinsics": matrix_to_rows(np.eye(3)),
            "tracking_state": "normal",
        }

    def test_parse_ok(self):
        fm = parse_frame_meta(self._base())
        self.assertEqual(fm.frame_id, 12)
        self.assertTrue(fm.has_depth)
        self.assertEqual(fm.camera_transform.shape, (4, 4))

    def test_missing_required(self):
        obj = self._base()
        del obj["camera_transform"]
        with self.assertRaises(FormatError):
            parse_frame_meta(obj)

    def test_unknown_optional_preserved(self):
        obj = self._base()
        obj["exposure"] = 0.5
        obj["rover"] = {"pose": None}
        fm = parse_frame_meta(obj)
        self.assertEqual(fm.extra["exposure"], 0.5)
        self.assertIn("rover", fm.extra)

    def test_missing_depth_frame(self):
        obj = self._base()
        obj["depth_path"] = None
        obj["depth_status"] = "unavailable"
        fm = parse_frame_meta(obj)
        self.assertFalse(fm.has_depth)

    def test_newer_version_warns(self):
        obj = self._base()
        obj["format_version"] = 999
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            parse_frame_meta(obj)
            self.assertTrue(any("newer" in str(x.message) for x in w))

    def test_roundtrip_dict(self):
        fm = parse_frame_meta(self._base())
        d = formats.frame_meta_to_dict(fm)
        fm2 = parse_frame_meta(d)
        self.assertEqual(fm2.frame_id, fm.frame_id)
        np.testing.assert_allclose(fm2.camera_transform, fm.camera_transform)


if __name__ == "__main__":
    unittest.main()
