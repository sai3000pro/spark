"""In-memory registry of live sessions (thread-safe)."""

from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Callable, Dict, Optional

from tools.live_capture_server.storage import SessionStore


class SessionManager:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._sessions: Dict[str, SessionStore] = {}
        # Optional observer, fired (outside the lock) with the session_id whenever a
        # session is created or resumed. Lets a host (e.g. the studio server) start a
        # per-session LiveReconManager on first phone activity without coupling this
        # module to it. Exceptions in the callback are swallowed.
        self.on_activity: Optional[Callable[[str], None]] = None
        # Fired (outside the lock) when a session ends — lets a host kick off a final
        # higher-quality reconstruction pass. Exceptions swallowed.
        self.on_end: Optional[Callable[[str], None]] = None

    def _fire(self, sid: str):
        cb = self.on_activity
        if cb is not None:
            try:
                cb(sid)
            except Exception:
                pass

    def fire_end(self, sid: str):
        cb = self.on_end
        if cb is not None:
            try:
                cb(sid)
            except Exception:
                pass

    def create(self, device_session_id: Optional[str] = None,
               session_id: Optional[str] = None) -> SessionStore:
        with self._lock:
            sid = session_id or ("sess_" + uuid.uuid4().hex[:16])
            if sid in self._sessions:
                return self._sessions[sid]
            store = SessionStore(self.root, sid, device_session_id=device_session_id)
            self._sessions[sid] = store
        self._fire(sid)
        return store

    def get(self, session_id: str) -> Optional[SessionStore]:
        with self._lock:
            return self._sessions.get(session_id)

    def get_or_create(self, session_id: str,
                      device_session_id: Optional[str] = None) -> SessionStore:
        with self._lock:
            s = self._sessions.get(session_id)
            if s is None:
                s = SessionStore(self.root, session_id, device_session_id=device_session_id)
                self._sessions[session_id] = s
        self._fire(session_id)
        return s

    def all_snapshots(self):
        with self._lock:
            return {sid: s.snapshot() for sid, s in self._sessions.items()}

    def close_all(self):
        with self._lock:
            for s in self._sessions.values():
                s.close()
