"""Phase 0: intrinsics scaling tests."""

import unittest

import numpy as np

from tools.arkit_capture.formats import FormatError
from tools.arkit_capture.intrinsics import intrinsic_params, scale_intrinsics


def K(fx, fy, cx, cy):
    return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=float)


class TestIntrinsicsScaling(unittest.TestCase):
    def test_same_resolution(self):
        k = K(1000, 1000, 960, 720)
        out = scale_intrinsics(k, (1920, 1440), (1920, 1440))
        np.testing.assert_allclose(out, k)

    def test_uniform_scale(self):
        k = K(1000, 1000, 960, 720)
        out = scale_intrinsics(k, (1920, 1440), (960, 720))  # 0.5x
        fx, fy, cx, cy = intrinsic_params(out)
        self.assertAlmostEqual(fx, 500)
        self.assertAlmostEqual(fy, 500)
        self.assertAlmostEqual(cx, 480)
        self.assertAlmostEqual(cy, 360)

    def test_non_uniform_scale(self):
        k = K(1000, 1200, 960, 720)
        # 1920x1440 -> 256x192 : sx=256/1920, sy=192/1440
        out = scale_intrinsics(k, (1920, 1440), (256, 192))
        fx, fy, cx, cy = intrinsic_params(out)
        self.assertAlmostEqual(fx, 1000 * 256 / 1920)
        self.assertAlmostEqual(fy, 1200 * 192 / 1440)
        self.assertAlmostEqual(cx, 960 * 256 / 1920)
        self.assertAlmostEqual(cy, 720 * 192 / 1440)

    def test_principal_point_scales(self):
        k = K(1000, 1000, 1000, 500)
        out = scale_intrinsics(k, (2000, 1000), (1000, 500))
        _, _, cx, cy = intrinsic_params(out)
        self.assertAlmostEqual(cx, 500)
        self.assertAlmostEqual(cy, 250)

    def test_invalid_dimensions(self):
        k = K(1000, 1000, 960, 720)
        with self.assertRaises(FormatError):
            scale_intrinsics(k, (0, 1440), (256, 192))
        with self.assertRaises(FormatError):
            scale_intrinsics(k, (1920, 1440), (256, -1))

    def test_bad_shape(self):
        with self.assertRaises(FormatError):
            scale_intrinsics(np.eye(4), (1920, 1440), (256, 192))


if __name__ == "__main__":
    unittest.main()
