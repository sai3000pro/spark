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
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import urlopen

from .live import LiveRegistry
from .pipeline import RunPaths

#: The CLI's non-tty progress line: two spaces, a percentage, then the message.
_PROGRESS_RE = re.compile(r"^\s*(\d{1,3})%\s+(.*)$")

#: Matches tools/live_capture_server/protocol.py so a phone that speaks to one
#: speaks to the other.
PROTOCOL_VERSION = 1
DEFAULT_PORT = 8899

#: Where tools/live_capture_server listens. It is what web/lib/liveRecon.ts
#: streams frames to, and therefore the only thing that can make a live session
#: exist -- see `capture_reachable`.
DEFAULT_CAPTURE_URL = "http://127.0.0.1:8765"
#: Short: this is asked while someone waits on a phone screen.
CAPTURE_PROBE_SECONDS = 1.0


def capture_reachable(base_url: str) -> bool:
    """Is the frame source actually running?

    THIS IS THE CONDITION LIVE RECONSTRUCTION DEPENDS ON, and asking it is the
    difference between offering live capture and pretending to.

    This package can solve and train a growing session, but it cannot receive a
    single frame: the browser streams to tools/live_capture_server over a
    WebSocket, and that server writes the JPEGs we then read. With it down,
    frames arrive nowhere, a live session never gains an image, and a person
    films for three minutes into a directory nobody writes.
    """
    try:
        with urlopen(f"{base_url.rstrip('/')}/health", timeout=CAPTURE_PROBE_SECONDS) as r:
            return 200 <= r.status < 400
    except (URLError, OSError, ValueError):
        return False


#: Origins allowed to talk to this server from a browser.
#:
#: WHY NOT `*`, WHICH IS WHAT THIS SHIPPED WITH FOR AN HOUR TONIGHT
#:
#: This process listens on localhost and serves, among other things,
#: `/file?path=` -- fenced to directories it owns, which is exactly where a
#: person's video frames and finished splats live -- and `POST /api/live/delete`.
#: With `Access-Control-Allow-Origin: *`, ANY page the user happens to visit can
#: issue those requests from their browser and READ THE RESPONSES. Not a
#: theoretical CSRF where an attacker fires blind: a wildcard makes the response
#: body readable, so a random site could enumerate someone's captures, pull the
#: frames out of them, and delete sessions.
#:
#: The fence on `/file` stops path traversal. It does not stop the wrong ORIGIN
#: asking politely for files this server is happy to serve.
#:
#: So the default is the only origin that legitimately talks to a studio on
#: localhost: a Next app on localhost. `--allow-origin` widens it for a deployed
#: front end, which is a decision someone makes explicitly rather than one they
#: inherit from a convenience default.
_LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")


def origin_allowed(origin: str, extra: tuple[str, ...]) -> bool:
    """Localhost always; anything else only when it was named explicitly."""
    if not origin:
        return False
    if _LOCAL_ORIGIN.match(origin):
        return True
    return origin in extra


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


#: Job ids are minted here, so anything else did not come from us. Checked
#: before an id is ever joined onto a directory - the same posture as the
#: session fence in live.py.
_SAFE_JOB = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: A phone recording is routinely 150-400 MB; 2 GB is a long 4K take.
MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024

VIDEO_SUFFIXES = (".mp4", ".mov", ".m4v", ".webm")


@dataclass
class Paths:
    """Where the web app keeps its half of the contract.

    `web` is optional, and that is what lets the frozen executable run on a
    machine with no checkout on it. Beside the Next app the two directories are
    the app's own - it reads uploads from `.uploads` and serves splats out of
    `public/mock/splats`, so writing anywhere else would mean the app never saw
    the result. Standalone there is no app to agree with, and everything lives
    under `work` where the user can find it.
    """

    web: Optional[Path]
    work: Path
    #: Where live sessions land. Overridable because it is NOT ours: it is
    #: whatever `--root` tools/live_capture_server was started with, and the two
    #: processes must agree or frames arrive somewhere nobody reads.
    sessions_root: Optional[Path] = None

    @property
    def uploads(self) -> Path:
        return (self.web / ".uploads") if self.web else (self.work / "uploads")

    @property
    def splats(self) -> Path:
        return (
            (self.web / "public" / "mock" / "splats") if self.web else (self.work / "splats")
        )

    @property
    def standalone(self) -> bool:
        """No web app beside us, so we are the whole product."""
        return self.web is None

    @property
    def runs(self) -> Path:
        return self.work / "runs"

    @property
    def sessions(self) -> Path:
        return self.sessions_root or (self.work / "live_sessions")

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

            # `sys.executable -m spark_studio` is right in a checkout and WRONG
            # in the frozen build, where sys.executable is the studio itself:
            # it would be handed "-m" as the video to reconstruct. Frozen, the
            # executable already is the CLI, so the arguments go straight on.
            args = [
                str(clip),
                "-o", str(destination),
                "-w", str(self.paths.runs / job_id),
                "--preset", self.preset,
            ]
            if getattr(sys, "frozen", False):
                cmd = [sys.executable, *args]
            else:
                cmd = [sys.executable, "-m", "spark_studio", *args]
            tail: list[str] = []
            try:
                proc = subprocess.Popen(
                    cmd,
                    # In a checkout this puts `tools/` on the path so `-m
                    # spark_studio` resolves. Frozen there is no package to
                    # import and no meaningful source directory, so stay put.
                    cwd=(
                        None
                        if getattr(sys, "frozen", False)
                        else str(Path(__file__).resolve().parents[1])
                    ),
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
    capture_url: str
    allowed_origins: tuple[str, ...] = ()
    #: Serve the built-in page. On beside the Next app the app IS the UI, and
    #: two of them would be two places to look for the same jobs.
    ui: bool = False

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
        # Echo the origin back only when it is allowed. A request with no Origin
        # -- curl, the Next server proxying on the user's behalf -- gets no CORS
        # header at all, which is correct: CORS governs browsers, and a header
        # nobody asked for is one more thing that can be wrong.
        origin = self.headers.get("Origin", "")
        if origin and origin_allowed(origin, self.allowed_origins):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:
        url = urlparse(self.path)
        query = parse_qs(url.query)
        route = url.path.rstrip("/") or "/"

        if self.ui and route == "/":
            from .ui import PAGE

            return self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")

        if route == "/api/studio/health":
            from .doctor import report

            tools = report()
            return self._send(
                200,
                {
                    "ready": all(t.found for t in tools),
                    "missing": [t.name for t in tools if not t.found],
                },
            )

        if route == "/api/studio/jobs":
            return self._send(200, {"jobs": _ui_jobs(self.paths, self.watcher)})

        if route == "/api/studio/download":
            job_id = (query.get("job") or [""])[0]
            if not _SAFE_JOB.match(job_id):
                # Fenced before it can become a path. The id is minted here, so
                # anything that does not look like one was not.
                return self._send(400, {"error": "bad job id"})
            ply = self.paths.splats / f"{job_id}.ply"
            if not ply.is_file():
                return self._send(404, {"error": "no splat for that job"})
            body = ply.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition", f'attachment; filename="{job_id}.ply"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(body)

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
                # The status code here is read as a CAPABILITY answer, not just
                # as "no such session". `probeStudio()` in
                # web/lib/reconstruction/targets.ts asks about a nonsense id and
                # treats 404 as "this build has no live endpoint" while anything
                # else means "the route is here, that just is not a session".
                #
                # So the honest answer depends on whether frames could actually
                # arrive. This package reads JPEGs that tools/live_capture_server
                # writes; it cannot receive one itself. Capture server up, and a
                # live session is a real offer. Capture server down, and offering
                # it would take someone's three-minute walk and reconstruct none
                # of it -- the failure dispatch.ts was corrected for.
                if capture_reachable(self.capture_url):
                    return self._send(400, {"error": "no such session", "session": sid})
                return self._send(
                    404,
                    {
                        "error": "no frame source",
                        "detail": (
                            f"Nothing is listening at {self.capture_url}. Live capture needs "
                            "tools/live_capture_server running to receive frames."
                        ),
                    },
                )
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

    def _accept_video(self, length: int) -> None:
        """Take a video off the wire and queue it.

        Written straight to disk in chunks rather than read into memory: these
        are phone recordings, routinely 150-400 MB, and this process also has a
        reconstruction running beside it.

        The job record is written LAST and is what makes the clip visible to the
        watcher - `pending()` looks for a `.job.json` with a video beside it. So
        an upload that dies halfway leaves an orphan video that nothing picks
        up, rather than a job pointing at a truncated clip that COLMAP would
        chew on for ten minutes before failing.
        """
        if length <= 0:
            return self._send(400, {"error": "no video in that request"})
        if length > MAX_VIDEO_BYTES:
            return self._send(
                413,
                {"error": f"that clip is over the {MAX_VIDEO_BYTES // (1024 * 1024)} MB limit"},
            )

        raw_name = unquote(self.headers.get("X-Video-Filename", "") or "")
        suffix = Path(raw_name).suffix.lower()
        if suffix not in VIDEO_SUFFIXES:
            return self._send(
                415,
                {"error": f"{suffix or 'that file'} is not a video the studio can read"},
            )

        preset = (parse_qs(urlparse(self.path).query).get("preset") or ["balanced"])[0]
        if preset not in ("fast", "balanced", "high"):
            preset = "balanced"

        job_id = f"job_{int(time.time() * 1000):x}"
        self.paths.uploads.mkdir(parents=True, exist_ok=True)
        clip = self.paths.uploads / f"{job_id}{suffix}"

        remaining = length
        try:
            with clip.open("wb") as fh:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    fh.write(chunk)
                    remaining -= len(chunk)
        except OSError as exc:
            clip.unlink(missing_ok=True)
            return self._send(500, {"error": f"could not store the clip: {exc}"})

        if remaining > 0:
            clip.unlink(missing_ok=True)
            return self._send(400, {"error": "the upload stopped early; nothing was queued"})

        # Only now does the watcher become able to see it.
        (self.paths.uploads / f"{job_id}.job.json").write_text(
            json.dumps(
                {
                    "id": job_id,
                    "sourceName": raw_name or clip.name,
                    "sourceBytes": length,
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "preset": preset,
                },
                indent=1,
            ),
            encoding="utf-8",
        )
        return self._send(201, {"job": job_id, "bytes": length, "preset": preset})

    def do_POST(self) -> None:
        route = urlparse(self.path).path.rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or 0)

        # BEFORE the JSON read below, which would swallow a whole video into
        # memory and then fail to parse it.
        if route == "/api/studio/reconstruct":
            return self._accept_video(length)

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


def _ui_jobs(paths: Paths, watcher: Watcher) -> list[dict]:
    """Every reconstruction this studio knows about, derived by looking.

    Same rule as the web app's splatJobs: a job is done when its .ply is on
    disk. Nothing is ticked, so a page opened an hour later on a cold server
    still reports the truth, and a job that finished while nobody was watching
    is not lost.
    """
    out: list[dict] = []
    errors = {f["job"]: f for f in watcher.finished if f.get("error")}
    done = {f["job"]: f for f in watcher.finished if not f.get("error")}

    if not paths.uploads.is_dir():
        return out

    for record in sorted(paths.uploads.glob("*.job.json"), reverse=True):
        job_id = record.name[: -len(".job.json")]
        try:
            meta = json.loads(record.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            meta = {}
        ply = paths.splats / f"{job_id}.ply"

        entry = {
            "id": job_id,
            "name": meta.get("sourceName") or job_id,
            "createdAt": meta.get("createdAt"),
        }
        if ply.is_file() and ply.stat().st_size > 0:
            entry["status"] = "done"
            entry["bytes"] = ply.stat().st_size
            if job_id in done:
                entry["seconds"] = done[job_id].get("seconds")
        elif watcher.current == job_id:
            entry["status"] = "running"
            stage, fraction = watcher.progress
            # The watcher prefixes its stage with the job id; the page already
            # shows which job this is.
            entry["stage"] = stage.split(": ", 1)[-1] if ": " in stage else stage
            entry["fraction"] = fraction
        elif job_id in errors:
            entry["status"] = "failed"
            entry["error"] = errors[job_id].get("error")
        else:
            entry["status"] = "queued"
        out.append(entry)
    return out


def serve(
    web: Optional[Path],
    work: Path,
    port: int = DEFAULT_PORT,
    preset: str = "balanced",
    host: str = "127.0.0.1",
    sessions_root: Optional[Path] = None,
    capture_url: str = DEFAULT_CAPTURE_URL,
    allowed_origins: tuple[str, ...] = (),
    ui: bool = False,
    open_browser: bool = False,
) -> None:
    """Run the studio until interrupted."""
    paths = Paths(
        web=Path(web) if web else None,
        work=Path(work),
        sessions_root=Path(sessions_root) if sessions_root else None,
    )
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
    Handler.capture_url = capture_url
    Handler.allowed_origins = tuple(allowed_origins)
    Handler.ui = ui

    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"  spark studio   http://{host}:{port}")
    print(f"  watching       {paths.uploads}")
    print(f"  publishing to  {paths.splats}")
    print(f"  work           {paths.work}")
    print()
    print(f"  live sessions  {paths.sessions}")
    live_up = capture_reachable(capture_url)
    print(
        f"  frame source   {capture_url} "
        + ("- reachable, live capture is offered" if live_up else "- DOWN, live capture is not offered")
    )
    if not live_up:
        # Said plainly rather than left to be discovered when a capture produces
        # nothing: this server cannot receive a frame, it can only read the ones
        # that server writes.
        print("                 start tools/live_capture_server to enable it, and point")
        print("                 --sessions at the same --root it uses.")
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
