"""Phase 0: trajectory extraction and metrics tests."""

import unittest

import numpy as np

from tools.arkit_capture.formats import matrix_to_rows, parse_frame_meta
from tools.arkit_capture.trajectory import build_trajectory, compute_metrics


def frame(fid, t, pos, tracking="normal"):
    T = np.eye(4)
    T[:3, 3] = pos
    return parse_frame_meta({
        "frame_id": fid,
        "timestamp": t,
        "rgb_path": f"frames/{fid:06d}.jpg",
        "image_width": 1920,
        "image_height": 1440,
        "camera_transform": matrix_to_rows(T),
        "camera_intrinsics": matrix_to_rows(np.eye(3)),
        "tracking_state": tracking,
    })


class TestTrajectory(unittest.TestCase):
    def test_identity_pose_at_origin(self):
        pts = build_trajectory([frame(0, 0.0, [0, 0, 0])])
        self.assertEqual((pts[0].x, pts[0].y, pts[0].z), (0, 0, 0))

    def test_known_translation(self):
        pts = build_trajectory([frame(0, 0.0, [1.0, 2.0, 3.0])])
        self.assertAlmostEqual(pts[0].x, 1.0)
        self.assertAlmostEqual(pts[0].y, 2.0)
        self.assertAlmostEqual(pts[0].z, 3.0)

    def test_straight_line_metrics(self):
        frames = [frame(i, i * 0.2, [i * 0.5, 0, 0]) for i in range(3)]
        m = compute_metrics(frames)
        self.assertEqual(m.frame_count, 3)
        self.assertAlmostEqual(m.duration_s, 0.4, places=5)
        self.assertAlmostEqual(m.path_length_m, 1.0, places=5)
        self.assertAlmostEqual(m.start_end_distance_m, 1.0, places=5)
        self.assertAlmostEqual(m.max_frame_translation_m, 0.5, places=5)
        self.assertAlmostEqual(m.average_velocity_mps, 2.5, places=5)

    def test_loop_has_drift(self):
        # square loop returning near-but-not-exactly to start
        frames = [
            frame(0, 0.0, [0, 0, 0]),
            frame(1, 1.0, [1, 0, 0]),
            frame(2, 2.0, [1, 0, 1]),
            frame(3, 3.0, [0, 0, 1]),
            frame(4, 4.0, [0.05, 0, 0.02]),
        ]
        m = compute_metrics(frames)
        self.assertGreater(m.path_length_m, m.start_end_distance_m)
        self.assertGreater(m.start_end_distance_m, 0.0)

    def test_rotation_metric(self):
        R = np.eye(4)
        th = 0.5
        R[0, 0], R[0, 2] = np.cos(th), np.sin(th)
        R[2, 0], R[2, 2] = -np.sin(th), np.cos(th)
        f0 = frame(0, 0.0, [0, 0, 0])
        f1 = parse_frame_meta({
            "frame_id": 1, "timestamp": 1.0, "rgb_path": "frames/000001.jpg",
            "image_width": 1920, "image_height": 1440,
            "camera_transform": matrix_to_rows(R),
            "camera_intrinsics": matrix_to_rows(np.eye(3)),
            "tracking_state": "normal",
        })
        m = compute_metrics([f0, f1])
        self.assertAlmostEqual(m.max_frame_rotation_rad, th, places=5)

    def test_non_monotonic_warns(self):
        frames = [frame(0, 1.0, [0, 0, 0]), frame(1, 0.5, [1, 0, 0])]
        m = compute_metrics(frames)
        self.assertTrue(any("monotonic" in w for w in m.warnings))

    def test_large_jump_flagged(self):
        frames = [frame(0, 0.0, [0, 0, 0]), frame(1, 0.2, [50, 0, 0])]
        m = compute_metrics(frames)
        self.assertTrue(any("jump" in w or "translation" in w for w in m.warnings))


if __name__ == "__main__":
    unittest.main()
