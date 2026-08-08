"""Phase 2: synthetic end-to-end integration test of the Mac inspector."""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.arkit_capture.fixtures import make_synthetic_session
from tools.arkit_capture.inspect_capture import inspect
from tools.arkit_capture.pointcloud import read_ply_xyz


class TestSyntheticInspection(unittest.TestCase):
    def test_known_trajectory_and_cloud(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = Path(tmp) / "capture_test"
            make_synthetic_session(cap, n_frames=3, rate_hz=5.0, step_m=0.5,
                                   depth_value=2.0, depth_w=8, depth_h=6)
            out = Path(tmp) / "report"
            summary = inspect(cap, out, subsample=1)

            # Validation clean.
            self.assertTrue(summary["validation"]["ok"], summary["validation"])
            self.assertEqual(summary["validation"]["valid_frames"], 3)

            # Known trajectory: 3 frames @ 0.5 m step => 1.0 m path over 0.4 s.
            traj = summary["trajectory"]
            self.assertEqual(traj["frame_count"], 3)
            self.assertAlmostEqual(traj["path_length_m"], 1.0, places=4)
            self.assertAlmostEqual(traj["start_end_distance_m"], 1.0, places=4)
            self.assertAlmostEqual(traj["duration_s"], 0.4, places=4)

            # Known cloud: 3 frames * 48 px = 144 points, all on plane z=-2.
            self.assertEqual(summary["lidar_cloud"]["point_count"], 3 * 8 * 6)
            cloud = read_ply_xyz(out / "lidar_cloud.ply")
            np.testing.assert_allclose(cloud[:, 2], -2.0, atol=1e-4)

            # Output files exist.
            self.assertTrue((out / "trajectory.csv").is_file())
            self.assertTrue((out / "summary.json").is_file())
            self.assertTrue((out / "lidar_cloud.ply").is_file())
            self.assertTrue((out / "validation.txt").is_file())

            # CSV has header + 3 rows.
            rows = (out / "trajectory.csv").read_text().strip().splitlines()
            self.assertEqual(len(rows), 4)

    def test_missing_depth_frame_still_inspectable(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = Path(tmp) / "capture_test"
            make_synthetic_session(cap, n_frames=3, missing_depth_frames=[1])
            out = Path(tmp) / "report"
            summary = inspect(cap, out, subsample=1)
            # Still valid overall; 2 depth frames unprojected.
            self.assertTrue(summary["validation"]["ok"])
            self.assertEqual(summary["validation"]["frames_with_depth"], 2)
            self.assertEqual(summary["depth"]["frames_unprojected"], 2)

    def test_summary_json_parseable(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = Path(tmp) / "capture_test"
            make_synthetic_session(cap, n_frames=2)
            out = Path(tmp) / "report"
            inspect(cap, out, subsample=1)
            data = json.loads((out / "summary.json").read_text())
            self.assertIn("trajectory", data)
            self.assertIn("lidar_cloud", data)


if __name__ == "__main__":
    unittest.main()
