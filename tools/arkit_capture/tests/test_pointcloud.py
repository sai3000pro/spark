"""Phase 0: depth unprojection and point-cloud tests using synthetic geometry."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.arkit_capture.formats import CONFIDENCE_HIGH, CONFIDENCE_LOW
from tools.arkit_capture.pointcloud import (
    cloud_stats,
    read_ply_xyz,
    unproject_frame,
    write_ply,
)


def K(fx, fy, cx, cy):
    return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=float)


class TestUnprojection(unittest.TestCase):
    def test_constant_plane_identity_pose(self):
        # Depth == RGB resolution so intrinsics scale is identity.
        w, h = 8, 6
        d = 2.0
        depth = np.full((h, w), d, dtype=np.float32)
        Kd = K(100, 100, w / 2.0, h / 2.0)
        pts = unproject_frame(
            depth, Kd, (w, h), np.eye(4),
            min_confidence=CONFIDENCE_LOW, min_depth=0.1, max_depth=10.0,
        )
        self.assertEqual(pts.shape[0], w * h)
        # All points sit on the plane z = -d in ARKit camera/world space.
        np.testing.assert_allclose(pts[:, 2], -d, atol=1e-5)

    def test_principal_point_maps_to_axis(self):
        # A pixel at the principal point unprojects to (0,0,-d).
        w, h = 8, 6
        d = 3.0
        depth = np.zeros((h, w), dtype=np.float32)
        cx, cy = 4, 3
        depth[cy, cx] = d
        Kd = K(100, 100, cx, cy)
        pts = unproject_frame(depth, Kd, (w, h), np.eye(4),
                              min_confidence=CONFIDENCE_LOW)
        self.assertEqual(pts.shape[0], 1)
        np.testing.assert_allclose(pts[0], [0, 0, -d], atol=1e-5)

    def test_known_translation_applied(self):
        w, h = 4, 4
        d = 1.0
        depth = np.zeros((h, w), dtype=np.float32)
        depth[2, 2] = d
        Kd = K(100, 100, 2, 2)
        T = np.eye(4)
        T[:3, 3] = [10, 20, 30]
        pts = unproject_frame(depth, Kd, (w, h), T, min_confidence=CONFIDENCE_LOW)
        np.testing.assert_allclose(pts[0], [10, 20, 30 - d], atol=1e-5)

    def test_confidence_filter(self):
        w, h = 4, 4
        depth = np.full((h, w), 2.0, dtype=np.float32)
        conf = np.full((h, w), CONFIDENCE_LOW, dtype=np.uint8)
        conf[0, 0] = CONFIDENCE_HIGH
        Kd = K(100, 100, 2, 2)
        pts = unproject_frame(depth, Kd, (w, h), np.eye(4),
                              confidence=conf, min_confidence=CONFIDENCE_HIGH)
        self.assertEqual(pts.shape[0], 1)

    def test_range_filter(self):
        w, h = 4, 4
        depth = np.full((h, w), 20.0, dtype=np.float32)  # beyond max
        Kd = K(100, 100, 2, 2)
        pts = unproject_frame(depth, Kd, (w, h), np.eye(4),
                              min_confidence=CONFIDENCE_LOW, max_depth=8.0)
        self.assertEqual(pts.shape[0], 0)

    def test_intrinsics_scaled_from_rgb(self):
        # RGB intrinsics 1920x1440, depth 8x6 -> scale factor applied.
        img_w, img_h = 1920, 1440
        w, h = 8, 6
        d = 2.0
        depth = np.zeros((h, w), dtype=np.float32)
        depth[3, 4] = d  # principal point after scaling
        Krgb = K(1000, 1000, img_w / 2.0, img_h / 2.0)
        # scaled cx = 960*(8/1920)=4, cy=720*(6/1440)=3 -> pixel (4,3)
        pts = unproject_frame(depth, Krgb, (img_w, img_h), np.eye(4),
                              min_confidence=CONFIDENCE_LOW)
        np.testing.assert_allclose(pts[0], [0, 0, -d], atol=1e-5)


class TestCloudStatsAndPLY(unittest.TestCase):
    def test_stats(self):
        pts = np.array([[0, 0, 0], [1, 2, 3], [-1, -2, -3]], dtype=float)
        s = cloud_stats(pts)
        self.assertEqual(s.point_count, 3)
        self.assertEqual(s.bbox_min, (-1, -2, -3))
        self.assertEqual(s.bbox_max, (1, 2, 3))

    def test_empty(self):
        s = cloud_stats(np.zeros((0, 3)))
        self.assertEqual(s.point_count, 0)

    def test_ply_roundtrip(self):
        pts = np.array([[0.5, 1.5, 2.5], [-1, -2, -3]], dtype=float)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "cloud.ply"
            write_ply(pts, p)
            back = read_ply_xyz(p)
            np.testing.assert_allclose(back, pts, atol=1e-5)

    def test_ply_with_color(self):
        pts = np.array([[0, 0, 0]], dtype=float)
        colors = np.array([[255, 128, 0]], dtype=np.uint8)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "cloud.ply"
            write_ply(pts, p, colors=colors)
            txt = p.read_text()
            self.assertIn("property uchar red", txt)
            self.assertIn("255 128 0", txt)


if __name__ == "__main__":
    unittest.main()
