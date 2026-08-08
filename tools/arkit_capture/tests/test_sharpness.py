"""Sharpness (variance-of-Laplacian) tests + inspector integration."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.arkit_capture.fixtures import make_synthetic_session
from tools.arkit_capture.inspect_capture import inspect
from tools.arkit_capture.sharpness import classify, laplacian_variance


class TestSharpness(unittest.TestCase):
    def test_sharp_beats_blurry(self):
        rng = np.random.default_rng(0)
        sharp = rng.integers(0, 255, (64, 64)).astype(np.float64)  # high-freq noise
        blurry = np.full((64, 64), 128.0)                          # flat = no detail
        self.assertGreater(laplacian_variance(sharp), laplacian_variance(blurry))

    def test_flat_image_zero(self):
        self.assertEqual(laplacian_variance(np.full((10, 10), 50.0)), 0.0)

    def test_classify_threshold(self):
        scores = [100.0, 5.0, 80.0, 2.0]
        thr, mask = classify(scores)  # default 0.5*median
        self.assertEqual(len(mask), 4)
        self.assertTrue(mask[0])       # 100 is sharp
        self.assertFalse(mask[3])      # 2 is blurry

    def test_inspector_emits_sharpness(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = Path(tmp) / "cap"
            make_synthetic_session(cap, n_frames=3, depth_w=8, depth_h=6)
            out = Path(tmp) / "report"
            summary = inspect(cap, out, subsample=1)
            self.assertIn("sharpness", summary)
            self.assertIn("blurry_count", summary["sharpness"])
            self.assertTrue((out / "sharpness.csv").is_file())
            self.assertTrue((out / "keyframes_sharp.txt").is_file())


if __name__ == "__main__":
    unittest.main()
