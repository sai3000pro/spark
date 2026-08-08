"""Test helpers: spin up a real server on an ephemeral port in a thread."""

from __future__ import annotations

import threading
from pathlib import Path

from tools.live_capture_server.server import make_server


class RunningServer:
    def __init__(self, root: Path, write_delay_s: float = 0.0):
        self.httpd = make_server("127.0.0.1", 0, Path(root), write_delay_s=write_delay_s)
        self.host, self.port = self.httpd.server_address
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop()

    @property
    def manager(self):
        return self.httpd.manager  # type: ignore

    def restart(self):
        """Stop and start a NEW server on the SAME port + root (server-crash test)."""
        root = self.httpd.manager.root  # type: ignore
        self.httpd.shutdown()
        self.httpd.manager.close_all()  # type: ignore
        self.httpd.server_close()
        self.httpd = make_server(self.host, self.port, root)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        try:
            self.httpd.shutdown()
            self.httpd.manager.close_all()  # type: ignore
            self.httpd.server_close()
        except Exception:
            pass
