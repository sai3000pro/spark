"""The companion server - what `web/lib/studio.ts` has always been a client for.

That client was written against a studio that lived in a 125 GB ComfyUI checkout
on a machine none of us have. This serves the same endpoints out of this
package, owes nothing to ComfyUI, and depends on nothing beyond the standard
library plus the three binaries `doctor` checks for.

    GET  /health                     -> {status, protocol_version}
    GET  /api/capture/status         -> {lan_ip, port, sessions}
    GET  /api/live/list              -> {runs: [...]}        live sessions
    GET  /api/live_splat?session=ID  -> one live session's status
    POST /api/live/delete            -> {session: ID}
    GET  /api/runs                   -> {runs: [...]}        finished splats
    GET  /file?path=ABS              -> serve a produced file

THE WATCHER IS THE WHOLE INTEGRATION

`web/lib/splatJobs.ts` writes an uploaded clip to `web/.uploads/<jobId>.mp4`
with a `<jobId>.job.json` beside it, and derives "ready" from
`web/public/mock/splats/<jobId>.ply` existing. So this server needs no protocol
with the web app at all: it watches one directory and writes to another. That is
why nothing here POSTs anything back, and why a restart of either side loses
nothing - the files are the state.

/file?path= IS DELIBERATELY FENCED

It takes an absolute path, which is exactly the shape of an arbitrary-file-read
bug. Every request is resolved and checked to be inside a directory this server
owns; anything else is a 403. The web app only ever passes back paths this
server produced, so the fence costs nothing legitimate.
"""

from __future__ import annotations

import json
import mimetypes
import re
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from .live import LiveRegistry
from .pipeline import RunPaths

#: The CLI's non-tty progress line: two spaces, a percentage, then the message.
_PROGRESS_RE = re.compile(r"^\s*(\d{1,3})%\s+(.*)$")

#: Matches tools/live_capture_server/protocol.py so a phone that speaks to one
#: speaks to the other.
PROTOCOL_VERSION = 1
DEFAULT_PORT = 8899


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@dataclass
class Paths:
    """Where the web app keeps its half of the contract."""

    web: Path
    work: Path

    @property
    def uploads(self) -> Path:
        return self.web / ".uploads"

    @property
    def splats(self) -> Path:
        return self.web / "public" / "mock" / "splats"

    @property
    def runs(self) -> Path:
        return self.work / "runs"

    @property
    def sessions(self) -> Path:
        return self.work / "live_sessions"

    def owns(self, candidate: Path) -> bool:
        """Is this a file we produced? The fence for /file?path=."""
        try:
            resolved = candidate.resolve()
        except OSError:
            return False
        for base in (self.runs, self.sessions, self.splats):
            try:
                resolved.relative_to(base.resolve())
                return True
            except (ValueError, OSError):
                continue
        return False


class Watcher(threading.Thread):
    """Turn queued clips into splats, one at a time, each in its own process.

    Serial on purpose. Two reconstructions on one GPU do not go twice as fast;
    they go slower than one after the other and can exhaust VRAM, turning two
    recoverable waits into two failures.

    SUBPROCESS, NOT A THREAD, AND THAT IS THE LOAD-BEARING DECISION HERE.

    Every expensive thing this does is native code called through a binding -
    COLMAP through pycolmap, Brush through a binary. Native code can die in ways
    Python cannot catch: an access violation, an OOM kill, a driver reset during
    a long GPU run. In a thread, any of those takes the whole server down with
    it, and a server that dies on one bad clip loses the queue behind it.

    Run as a child process, the worst case becomes an exit code and a message,
    the watcher survives, and the next clip starts. It costs an interpreter
    start per job - a rounding error against reconstruction - and it means the
    unit of work is exactly the CLI, so anything the watcher can do a person can
    reproduce by hand with the same command.
    """

    def __init__(self, paths: Paths, preset: str = "balanced", interval: float = 5.0):
        super().__init__(name="watcher", daemon=True)
        self.paths = paths
        self.preset = preset
        self.interval = interval
        self.current: Optional[str] = None
        self.progress: tuple[str, float] = ("idle", 0.0)
        self.finished: list[dict] = []
        self._stop = threading.Event()

    def pending(self) -> list[tuple[str, Path]]:
        """Clips with a job record and no splat yet. Derived by looking."""
        out: list[tuple[str, Path]] = []
        if not self.paths.uploads.is_dir():
            return out
        for record in sorted(self.paths.uploads.glob("*.job.json")):
            job_id = record.name[: -len(".job.json")]
            if (self.paths.splats / f"{job_id}.ply").is_file():
                continue
            clip = next(
                (
                    p
                    for p in self.paths.uploads.iterdir()
                    if p.stem == job_id and p.suffix.lower() in (".mp4", ".mov", ".m4v", ".webm")
                ),
                None,
            )
            if clip is not None:
                out.append((job_id, clip))
        return out

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                queue = self.pending()
            except OSError:
                queue = []
            if not queue:
                self._stop.wait(self.interval)
                continue

            job_id, clip = queue[0]
            self.current = job_id
            started = time.time()
            destination = self.paths.splats / f"{job_id}.ply"

            cmd = [
                sys.executable, "-m", "spark_studio",
                str(clip),
                "-o", str(destination),
                "-w", str(self.paths.runs / job_id),
                "--preset", self.preset,
            ]
            tail: list[str] = []
            try:
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(Path(__file__).resolve().parents[1]),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
            except OSError as exc:
                print(f"[watcher] {job_id} could not start: {exc}", flush=True)
                self.finished.append({"job": job_id, "error": str(exc)})
                self.current = None
                self._stop.wait(self.interval * 6)
                continue

            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.rstrip()
                if not line:
                    continue
                tail.append(line)
                if len(tail) > 30:
                    tail.pop(0)
                # The CLI prints "  NN%  message" when its stderr is not a tty,
                # which is exactly the case here.
                parsed = _PROGRESS_RE.match(line)
                if parsed:
                    self.progress = (
                        f"{job_id}: {parsed.group(2)}",
                        int(parsed.group(1)) / 100.0,
                    )
            code = proc.wait()

            # THE FILE DECIDES, NOT THE EXIT CODE. A worker that died after
            # writing the splat still produced one; a worker that exited 0
            # without writing did not.
            if destination.is_file() and destination.stat().st_size > 0:
                self.finished.append(
                    {
                        "job": job_id,
                        "ply": str(destination),
                        "seconds": round(time.time() - started, 1),
                    }
                )
                print(f"[watcher] {job_id} -> {destination}", flush=True)
            else:
                # A failed job stays pending: the clip is on disk, and a rerun
                # reuses whatever stage did succeed. Never write a marker that
                # would make this look done.
                why = tail[-1] if tail else f"worker exited {code} with no output"
                print(f"[watcher] {job_id} FAILED ({code}): {why}", flush=True)
                self.finished.append({"job": job_id, "error": why, "exit_code": code})
                self._stop.wait(self.interval * 6)

            self.current = None
            self.progress = ("idle", 0.0)

    def stop(self) -> None:
        self._stop.set()


def _studio_runs(paths: Paths) -> list[dict]:
    """Finished splats, in the shape `lib/studio.ts` StudioRun expects."""
    out = []
    if not paths.runs.is_dir():
        return out
    for run_dir in sorted(paths.runs.iterdir(), reverse=True):
        manifest = run_dir / "run.json"
        if not manifest.is_file():
            continue
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        ply = data.get("ply")
        training = data.get("training") or {}
        poses = data.get("poses") or {}
        frames = RunPaths(run_dir).images
        ref = next(iter(sorted(frames.glob("frame_*.jpg"))), None) if frames.is_dir() else None
        ready = bool(ply) and Path(ply).is_file()
        out.append(
            {
                "id": run_dir.name,
                "label": run_dir.name,
                "status": "done" if ready else "running",
                "result_ply": ply if ready else None,
                "ref_image": str(ref) if ref else None,
                "frames": poses.get("total"),
                "steps": training.get("iterations"),
                "pipeline": "brush",
                "started": int(manifest.stat().st_mtime),
            }
        )
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    paths: Paths
    registry: LiveRegistry
    watcher: Watcher
    port: int

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        return

    # The web app may be served from a real origin while this runs on the
    # user's own machine, in which case the BROWSER talks to us directly and
    # needs CORS. Localhost is a trustworthy origin, so https -> here is allowed.
    def _send(self, code: int, payload: object, ctype: str = "application/json") -> None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:
        url = urlparse(self.path)
        query = parse_qs(url.query)
        route = url.path.rstrip("/") or "/"

        if route == "/health":
            return self._send(
                200,
                {
                    "status": "ok",
                    "protocol_version": PROTOCOL_VERSION,
                    "server_time_ns": time.time_ns(),
                },
            )

        if route == "/api/capture/status":
            return self._send(
                200,
                {
                    "lan_ip": lan_ip(),
                    "port": self.port,
                    "sessions": {
                        s.session_id: {"frames_stored": s.frame_count()}
                        for s in self.registry.all()
                    },
                },
            )

        if route == "/api/live/list":
            self.registry.discover()
            return self._send(200, {"runs": self.registry.runs()})

        if route == "/api/live_splat":
            sid = (query.get("session") or [""])[0]
            if not sid:
                return self._send(400, {"error": "session required"})
            session = self.registry.get(sid, create=False)
            if session is None:
                # 404, DELIBERATELY, AND THIS IS NOT AN OVERSIGHT.
                #
                # `probeStudio()` in web/lib/reconstruction/targets.ts asks this
                # route about a nonsense session id and reads 404 as "this build
                # has no live endpoint", while any other status means "the route
                # exists, that just is not a session". So answering 400 here --
                # which I did first, on the reasoning that the route plainly does
                # exist -- flipped `studio-live` to available in the app's menu.
                #
                # It should not be available, because THE FRAMES CANNOT GET HERE.
                # The live path in the browser is web/lib/liveRecon.ts, which
                # opens ws://localhost:8765/ws/phone -- tools/live_capture_server
                # -- and that server stores binary payloads keyed by
                # (frame_id, payload_type) via protocol.payload_relpath. This
                # package's LiveSession reads `frame_*.jpg` out of
                # <work>/live_sessions/<id>/images. Two different layouts in two
                # different directories written by two different processes that
                # have never been introduced.
                #
                # So live reconstruction is architecturally ready and not wired.
                # Reporting 400 would put "Render live on the laptop" in front of
                # someone, take their three-minute walk, and reconstruct none of
                # it -- the exact failure dispatch.ts was just corrected for, and
                # it would be me reintroducing it one file over.
                #
                # FLIP THIS TO 400 IN THE SAME COMMIT THAT LANDS THE BRIDGE, not
                # before. The bridge is small: teach LiveSession to read the
                # capture server's layout, or teach the capture server to also
                # write a jpg per RGB payload. Either closes it.
                return self._send(404, {"error": "no live ingest wired", "session": sid})
            status = session.tick()
            return self._send(
                200,
                {
                    "session": status.session,
                    "current_ply": status.current_ply,
                    "version": status.version,
                    "frames": status.frames,
                    "registered": status.registered,
                    "running": status.running,
                    "stale_seconds": status.stale_seconds,
                    "stale": status.stale,
                    "note": status.note,
                    "message": status.describe(),
                },
            )

        if route == "/api/runs":
            return self._send(200, {"runs": _studio_runs(self.paths)})

        if route == "/api/queue":
            queued = [j for j, _ in self.watcher.pending()]
            message, frac = self.watcher.progress
            return self._send(
                200,
                {
                    "current": self.watcher.current,
                    "progress": {"message": message, "fraction": round(frac, 4)},
                    "pending": queued,
                    "finished": self.watcher.finished[-20:],
                },
            )

        if route == "/file":
            raw = (query.get("path") or [""])[0]
            if not raw:
                return self._send(400, {"error": "path required"})
            target = Path(raw)
            if not self.paths.owns(target):
                return self._send(403, {"error": "path is outside this studio"})
            if not target.is_file():
                return self._send(404, {"error": "no such file"})
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            return self._send(200, target.read_bytes(), ctype)

        return self._send(404, {"error": f"no route {route}"})

    def do_POST(self) -> None:
        route = urlparse(self.path).path.rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "invalid JSON"})

        if route == "/api/live/delete":
            sid = str(body.get("session") or "")
            session = self.registry.get(sid, create=False) if sid else None
            if session is None:
                return self._send(404, {"error": "no such session"})
            import shutil

            shutil.rmtree(session.root, ignore_errors=True)
            self.registry._sessions.pop(sid, None)
            return self._send(200, {"deleted": sid})

        return self._send(404, {"error": f"no route {route}"})


def serve(
    web: Path,
    work: Path,
    port: int = DEFAULT_PORT,
    preset: str = "balanced",
    host: str = "127.0.0.1",
) -> None:
    """Run the studio until interrupted."""
    paths = Paths(web=Path(web), work=Path(work))
    for d in (paths.runs, paths.sessions, paths.splats):
        d.mkdir(parents=True, exist_ok=True)

    registry = LiveRegistry(paths.sessions)
    registry.discover()
    watcher = Watcher(paths, preset=preset)
    watcher.start()

    Handler.paths = paths
    Handler.registry = registry
    Handler.watcher = watcher
    Handler.port = port

    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"  spark studio   http://{host}:{port}")
    print(f"  watching       {paths.uploads}")
    print(f"  publishing to  {paths.splats}")
    print(f"  work           {paths.work}")
    print()
    print("  The web app finds this automatically - NEXT_PUBLIC_STUDIO_URL")
    print(f"  defaults to http://localhost:{DEFAULT_PORT}.")
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopping")
    finally:
        watcher.stop()
        httpd.server_close()
