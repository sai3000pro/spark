"""Cross-language golden test.

These exact byte/JSON goldens are ALSO asserted by the Swift unit test
`GoldenFormatTests` (ios/GauzensplatCaptureTests). Both languages producing /
parsing the same bytes here is the guard against iOS<->Mac format drift.

If you change any golden below, update GoldenFormatTests.swift identically.
"""

import json
import struct
import unittest

import numpy as np

from tools.arkit_capture.formats import (
    decode_confidence,
    decode_depth,
    matrix_to_rows,
    parse_transform,
    sha256_hex,
)


class TestGoldenSha(unittest.TestCase):
    # Cross-checked against Swift GoldenFormatTests.testGoldenSha256.
    def test_sha256_gauzensplat(self):
        self.assertEqual(
            sha256_hex(b"gauzensplat"),
            "3f07e5a08fcf0d2922570c05aba5c6e553add9569394891afe575469eb293d88",
        )


class TestGoldenMatrix(unittest.TestCase):
    # A known rigid transform: rotate 90deg about Y, translate (1,2,3).
    # column-major SIMD (Swift) storage -> row-major nested arrays (contract).
    GOLDEN_ROWS = [
        [0.0, 0.0, 1.0, 1.0],
        [0.0, 1.0, 0.0, 2.0],
        [-1.0, 0.0, 0.0, 3.0],
        [0.0, 0.0, 0.0, 1.0],
    ]

    def test_parse_translation(self):
        T = parse_transform(self.GOLDEN_ROWS)
        np.testing.assert_allclose(T[:3, 3], [1, 2, 3])

    def test_json_roundtrip_matches_golden(self):
        T = parse_transform(self.GOLDEN_ROWS)
        rows = matrix_to_rows(T)
        self.assertEqual(json.loads(json.dumps(rows)), self.GOLDEN_ROWS)


class TestGoldenDepth(unittest.TestCase):
    # 2x2 depth: [[1.0, 2.0],[3.0, 4.0]] as little-endian float32.
    GOLDEN_BYTES = (
        struct.pack("<f", 1.0) + struct.pack("<f", 2.0)
        + struct.pack("<f", 3.0) + struct.pack("<f", 4.0)
    )
    GOLDEN_HEX = "0000803f000000400000404000008040"

    def test_hex(self):
        self.assertEqual(self.GOLDEN_BYTES.hex(), self.GOLDEN_HEX)

    def test_decode(self):
        d = decode_depth(self.GOLDEN_BYTES, 2, 2)
        np.testing.assert_allclose(d, [[1.0, 2.0], [3.0, 4.0]])


class TestGoldenConfidence(unittest.TestCase):
    # 2x2 confidence: low, medium, high, low
    GOLDEN_BYTES = bytes([0, 1, 2, 0])
    GOLDEN_HEX = "00010200"

    def test_hex(self):
        self.assertEqual(self.GOLDEN_BYTES.hex(), self.GOLDEN_HEX)

    def test_decode(self):
        c = decode_confidence(self.GOLDEN_BYTES, 2, 2)
        np.testing.assert_array_equal(c, [[0, 1], [2, 0]])


if __name__ == "__main__":
    unittest.main()
