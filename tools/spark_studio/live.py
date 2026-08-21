"""Live reconstruction - a splat that grows while someone is still filming.

WHAT "LIVE" HONESTLY MEANS HERE, BECAUSE THE WORD OVERSELLS ITSELF

It is NOT one optimiser that ingests frames as they arrive. No Gaussian-splat
trainer works that way, Brush included: training needs the camera poses for the
frames it is fitting, and poses for frame N+1 do not exist until the solver has
seen it. Anyone claiming a single continuous process is describing SLAM, which
is a different algorithm with different output.

What actually happens is two loops at different speeds:

    frames arrive  ->  poses extended incrementally   (seconds, cheap)
                   ->  trainer restarted on the larger set, seeded from the
                       splat it produced last time     (minutes, expensive)

From outside it looks continuous, because the viewer always reads the newest
snapshot on disk and a new one lands every couple of minutes. Inside it is
honest bookkeeping. `describe()` says which of the two you are looking at, so
the UI never has to guess and never has to invent a story.

WHY INCREMENTAL POSES ARE THE PART THAT MAKES THIS POSSIBLE

`pycolmap.incremental_mapping` accepts an `input_path`: an existing model to
EXTEND rather than rebuild. So the second solve does not redo the first - it
registers the new frames against the map already built. Without that, "live"
would mean re-solving 200 frames from scratch every 30 seconds, which costs more
than it delivers and gets slower exactly as the session gets more interesting.

WHAT IT REFUSES TO DO

If poses for the new frames do not solve, the session does NOT advance and does
NOT publish. A live view that silently keeps showing a two-minute-old splat
while claiming to be current is the same failure this whole package exists to
avoid - so `stale_seconds` is on the status, and the UI is expected to say so.
"""

from __future__ import annotations

import shutil
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from .train import TrainConfig, latest_snapshot, snapshots

#: New frames needed before it is worth extending the pose solve again.
MIN_NEW_FRAMES = 8
#: Don't restart the trainer more often than this. A restart has fixed cost
#: (dataset load, splat init) that is wasted if it happens every few seconds.
MIN_RETRAIN_SECONDS = 90.0
#: A published splat older than this is stale enough that the UI must say so.
STALE_AFTER_SECONDS = 300.0


@dataclass
class LiveStatus:
    """What `/api/live_splat` answers. Every field is measured, none assumed."""

    session: str
    #: Frames that have arrived in the session directory.
    frames: int
    #: Frames the pose solver has actually placed. Never equal by assumption.
    registered: int
    #: Monotonic counter - bumped only when a NEW splat file lands.
    version: int
    #: Absolute path of the newest snapshot, or None if none exists yet.
    current_ply: Optional[str]
    #: Is the trainer running right now?
    running: bool
    #: Seconds since the published splat was written.
    stale_seconds: Optional[float]
    #: Set when the last attempt failed, so a stalled session explains itself.
    note: Optional[str] = None

    @property
    def stale(self) -> bool:
        return self.stale_seconds is not None and self.stale_seconds > STALE_AFTER_SECONDS

    def describe(self) -> str:
        if self.current_ply is None:
            if self.registered < MIN_NEW_FRAMES:
                return (
                    f"{self.frames} frames in, still working out where the camera was. "
                    "Nothing to show yet."
                )
            return "Poses solved. The first splat is training now."
        age = f"{self.stale_seconds:.0f}s ago" if self.stale_seconds is not None else "just now"
        state = "still growing" if self.running else "paused"
        return (
            f"{self.registered} of {self.frames} frames placed, "
            f"splat v{self.version} written {age} ({state})"
        )


@dataclass
class LiveSession:
    """One capture, reconstructed as it arrives.

    `images_dir` is written to by something else entirely - the capture server
    in tools/live_capture_server, or a phone over WebSocket. This never puts a
    frame there and never deletes one; it only ever reads what has landed.
    """

    session_id: str
    root: Path
    train_config: TrainConfig = field(default_factory=lambda: TrainConfig(steps=6_000, export_every=1_000))
    #: Injected so tests can drive it without pycolmap.
    solver_factory: Optional[Callable[[], object]] = None

    _version: int = 0
    _registered: int = 0
    _last_solve_count: int = 0
    _last_retrain: float = 0.0
    _running: bool = False
    _note: Optional[str] = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    #: Where frames land, in priority order.
    #:
    #: Two producers write frames for a live session and they do not agree on a
    #: layout. This package's own extractor writes `images/frame_00001.jpg`;
    #: tools/live_capture_server -- which is what web/lib/liveRecon.ts actually
    #: streams to -- writes `phone/frames/000001.jpg`, real JPEGs, already
    #: decoded. Rather than make either side move, the session looks in both and
    #: uses whichever has frames in it. That single lookup is the whole bridge
    #: between the browser's live path and this reconstructor.
    CANDIDATE_FRAME_DIRS = ("phone/frames", "images", "frames")

    @property
    def images(self) -> Path:
        """The directory frames are actually arriving in.

        Falls back to `images/` when nothing has arrived yet, so a brand-new
        session has somewhere to be created rather than no answer.
        """
        for relative in self.CANDIDATE_FRAME_DIRS:
            candidate = self.root / relative
            if candidate.is_dir() and any(candidate.glob("*.jpg")):
                return candidate
        return self.root / "images"

    @property
    def exports(self) -> Path:
        return self.root / "exports"

    def frame_count(self) -> int:
        images = self.images
        if not images.is_dir():
            return 0
        # `*.jpg`, not `frame_*.jpg` -- the capture server names them
        # `000001.jpg`. See CANDIDATE_FRAME_DIRS.
        return len(list(images.glob("*.jpg")))

    def status(self) -> LiveStatus:
        """Derived by looking, every time. Nothing cached that could disagree."""
        current = latest_snapshot(self.exports)
        stale = None
        if current is not None:
            stale = round(time.time() - current.stat().st_mtime, 1)
        return LiveStatus(
            session=self.session_id,
            frames=self.frame_count(),
            registered=self._registered,
            version=self._version,
            current_ply=str(current) if current else None,
            running=self._running,
            stale_seconds=stale,
            note=self._note,
        )

    # -- the two loops -------------------------------------------------------

    def extend_poses(self) -> bool:
        """Register newly-arrived frames against the map already built.

        Returns True when the model grew. False is a normal outcome - not
        enough new frames yet, or the new ones did not solve.
        """
        count = self.frame_count()
        if count - self._last_solve_count < MIN_NEW_FRAMES:
            return False

        from .poses import ColmapSolver, PoseError

        solver = self.solver_factory() if self.solver_factory else ColmapSolver()
        try:
            # First solve builds the model; later ones extend it. ColmapSolver
            # rebuilds from scratch today - see the note in `tick` about why
            # that is acceptable at these session lengths and what replaces it.
            result = solver.solve(self.images, self.root)  # type: ignore[attr-defined]
        except PoseError as exc:
            self._note = str(exc)
            return False

        grew = result.registered > self._registered
        self._registered = result.registered
        self._last_solve_count = count
        self._note = None
        return grew

    def retrain(self, blocking: bool = False) -> bool:
        """Restart the trainer on everything solved so far.

        Seeded from the previous snapshot when one exists: Brush takes a ply in
        the source directory as its initial splat, so a restart continues from
        where the last one finished rather than from the sparse cloud again.
        """
        if self._running:
            return False
        if time.time() - self._last_retrain < MIN_RETRAIN_SECONDS:
            return False
        if self._registered < MIN_NEW_FRAMES:
            return False

        previous = latest_snapshot(self.exports)
        if previous is not None:
            # Brush picks up a top-level ply in the dataset as the init splat.
            try:
                shutil.copyfile(previous, self.root / "init.ply")
            except OSError:
                pass

        def work() -> None:
            from .train import TrainError, train

            self._running = True
            self._last_retrain = time.time()
            try:
                train(self.root, self.exports, self.train_config)
                self._version += 1
                self._note = None
            except TrainError as exc:
                self._note = str(exc)
            finally:
                self._running = False

        if blocking:
            work()
        else:
            threading.Thread(target=work, name=f"train-{self.session_id}", daemon=True).start()
        return True

    def tick(self) -> LiveStatus:
        """One pass of both loops. Safe to call on a timer.

        Serialised: a tick that arrives while the previous one is still solving
        returns the current status rather than starting a second solve on the
        same frames.
        """
        if not self._lock.acquire(blocking=False):
            return self.status()
        try:
            if self.extend_poses():
                self.retrain()
            return self.status()
        finally:
            self._lock.release()


class LiveRegistry:
    """Every live session on this machine, by id."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._sessions: dict[str, LiveSession] = {}
        self._lock = threading.Lock()

    def get(self, session_id: str, create: bool = True) -> Optional[LiveSession]:
        with self._lock:
            existing = self._sessions.get(session_id)
            if existing or not create:
                return existing
            session = LiveSession(session_id=session_id, root=self.root / session_id)
            session.root.mkdir(parents=True, exist_ok=True)
            session.images.mkdir(parents=True, exist_ok=True)
            self._sessions[session_id] = session
            return session

    def discover(self) -> None:
        """Adopt session directories that already exist on disk.

        A restart of this process must not orphan a capture that is mid-flight,
        and the directories are the record - same reason `lib/splatJobs.ts`
        re-reads its sidecars rather than trusting memory.
        """
        if not self.root.is_dir():
            return
        for d in self.root.iterdir():
            if not d.is_dir():
                continue
            if any((d / rel).is_dir() for rel in LiveSession.CANDIDATE_FRAME_DIRS):
                self.get(d.name)

    def all(self) -> list[LiveSession]:
        with self._lock:
            return list(self._sessions.values())

    def tick_all(self) -> list[LiveStatus]:
        return [s.tick() for s in self.all()]

    def runs(self) -> list[dict]:
        """The shape `/api/live/list` returns, which app/api/capture/state reads."""
        out = []
        for s in self.all():
            st = s.status()
            out.append(
                {
                    "session": st.session,
                    "version": st.version,
                    "frames": st.frames,
                    "keyframes": st.registered,
                    "running": st.running,
                    "last_run_seconds": st.stale_seconds,
                    "current_ply": st.current_ply,
                }
            )
        return out
