"""Dashboard snapshot / HTML tests + /status.json endpoint."""

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path

from tools.live_capture_server.client import PhoneClient
from tools.live_capture_server.dashboard import render_html, render_text, snapshot
from tools.live_capture_server.synth import synth_frames
from tools.live_capture_server.tests.util import RunningServer


class TestDashboard(unittest.TestCase):
    def test_snapshot_reflects_stored(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            frames = synth_frames(5, depth_w=8, depth_h=6)
            c = PhoneClient(srv.host, srv.port)
            c.connect(); c.begin()
            for fr in frames:
                c.send_frame(fr)
            snap = snapshot(srv.manager)
            self.assertIn(c.session_id, snap["sessions"])
            self.assertEqual(snap["sessions"][c.session_id]["frames_stored"], 5)
            self.assertIn("Gauzensplat", render_text(srv.manager))
            self.assertIn("<html", render_html(srv.manager))
            c.close()

    def test_status_json_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            url = f"http://{srv.host}:{srv.port}/status.json"
            with urllib.request.urlopen(url, timeout=5) as r:
                data = json.loads(r.read())
            self.assertIn("sessions", data)

    def test_dashboard_html_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp, RunningServer(Path(tmp)) as srv:
            url = f"http://{srv.host}:{srv.port}/"
            with urllib.request.urlopen(url, timeout=5) as r:
                html = r.read().decode()
            self.assertIn("Gauzensplat Live Capture Server", html)


if __name__ == "__main__":
    unittest.main()
