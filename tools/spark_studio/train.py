"""Stage 3 - the one that actually makes the splat.

Given frames and the camera poses stage 2 solved, optimise a few million
gaussians until they render back into those photographs. What comes out is the
.ply, and it is the only artefact in this pipeline anybody wants.

WHY BRUSH AND NOT gsplat / nerfstudio / Postshot

Brush is Rust + Burn + wgpu, which means Vulkan/DX12/Metal rather than CUDA. The
INRIA lineage and everything descended from it is CUDA-only and would exclude
every laptop without an NVIDIA card - quite possibly including this one, since
`web/lib/gpu.ts` was written against an Intel Iris Xe. Apache-2.0, and it emits
the raw 3DGS ply layout `web/lib/video/plyBounds.ts` already reads.

PROGRESSIVE TRAINING IS NOT A FEATURE WE HAD TO BUILD

`--export-every N` makes Brush write `export_<iter>.ply` throughout the run, not
only at the end. So "the splat builds as you watch" is a property of the trainer
we already chose: point a viewer at the newest snapshot and it grows. There is
no snapshot protocol to invent and nothing to keep in sync - the files on disk
ARE the progress, which is the same discipline `lib/splatJobs.ts` uses to decide
a job is done.

WHAT THIS REFUSES TO CLAIM

`train()` returns a path only when a .ply is on disk and has non-zero size. A
trainer that exits 0 having written nothing is a failure here, because the whole
reason this package exists is that the app used to report success for
reconstruction nobody performed.
"""

from __future__ import annotations

import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from .doctor import check_brush

#: Brush's own default export filename pattern. Parsed back out by `snapshots()`.
EXPORT_NAME = "export_{iter}.ply"
_ITER_RE = re.compile(r"export_(\d+)\.ply$", re.IGNORECASE)


class TrainError(RuntimeError):
    """Training did not produce a splat. Carries why."""


@dataclass
class TrainConfig:
    """The knobs worth exposing, named as Brush names them.

    Defaults are Brush's own except `export_every`, which we lower so that a
    long run is watchable rather than silent for an hour.
    """

    #: `--total-train-iters`. The dominant cost. 30k is Brush's default.
    steps: int = 30_000
    #: `--max-resolution`. Images are downscaled to this before training.
    max_resolution: int = 1600
    #: `--max-splats`. An upper bound, not a target.
    max_splats: int = 2_000_000
    #: `--growth-select-fraction`. Higher grows splats more aggressively.
    growth_select_fraction: float = 0.25
    #: `--export-every`. Every N steps a snapshot lands on disk.
    export_every: int = 2_000

    @classmethod
    def preset(cls, name: str) -> "TrainConfig":
        """Three points on the time/quality curve, from tools/video_intel/phone_brush.sh."""
        presets = {
            "fast": cls(steps=10_000, max_resolution=1280, max_splats=2_000_000),
            "balanced": cls(steps=30_000, max_resolution=1600, max_splats=2_500_000),
            "high": cls(steps=50_000, max_resolution=1920, max_splats=3_000_000),
        }
        if name not in presets:
            raise TrainError(
                f"Unknown preset {name!r}. Pick one of: {', '.join(presets)}"
            )
        return presets[name]


@dataclass
class TrainResult:
    """A splat that exists, plus what it cost."""

    ply: Path
    #: Iteration the returned ply was written at.
    iterations: int
    seconds: float
    bytes: int
    #: Every snapshot written along the way, oldest first.
    snapshots: list[Path]

    def describe(self) -> str:
        mb = self.bytes / (1024 * 1024)
        mins = self.seconds / 60
        return (
            f"{self.ply.name} - {mb:.1f} MB at {self.iterations:,} steps "
            f"in {mins:.1f} min"
        )


def snapshots(export_dir: Path) -> list[Path]:
    """Every `export_<iter>.ply` present, oldest first.

    The live view reads the last element of this. Derived by looking rather than
    tracked, so it is correct after a crash, a restart, or a cold read hours later.
    """
    found: list[tuple[int, Path]] = []
    if not export_dir.is_dir():
        return []
    for p in export_dir.glob("export_*.ply"):
        m = _ITER_RE.search(p.name)
        if m and p.stat().st_size > 0:
            found.append((int(m.group(1)), p))
    return [p for _, p in sorted(found)]


def latest_snapshot(export_dir: Path) -> Optional[Path]:
    """The newest splat on disk, or None. What a live viewer should show."""
    snaps = snapshots(export_dir)
    return snaps[-1] if snaps else None


# Brush logs progress lines; the exact wording is not a contract we control, so
# the parse is deliberately loose and a miss only costs a progress update.
#
# IT NEVER MATCHES ANYTHING, and that is not a bug in the pattern.
#
# brush-cli draws a progress bar when it owns a terminal and prints NOTHING when
# its output is a pipe - which is every way this module ever runs it. Measured:
# 30 training iterations, exit 0, a 5.2 MB .ply written, and exactly 0 bytes on
# stdout and stderr combined. So there is no line to parse, and the progress
# callback fired once with "starting trainer" and then stayed silent for the
# entire run: forty minutes pinned at 50% on a page that says "watch it build".
#
# Kept because it costs nothing and a future Brush may well speak up. The signal
# that actually works is below - the snapshots it writes.
_STEP_RE = re.compile(r"(?:step|iter\w*)\D{0,4}(\d[\d,]*)\s*/\s*(\d[\d,]*)", re.I)


def train(
    dataset_dir: Path,
    export_dir: Path,
    config: Optional[TrainConfig] = None,
    progress: Optional[Callable[[str, float], None]] = None,
) -> TrainResult:
    """Train on a COLMAP dataset, writing snapshots into `export_dir`.

    `dataset_dir` is what stage 2 produced - a directory holding `images/` and
    `sparse/0/`. Brush reads that layout natively via its `colmap-reader` crate.
    """
    cfg = config or TrainConfig()
    brush = check_brush()
    if not brush.found or not brush.path:
        raise TrainError(
            f"No trainer. {brush.fix}\n"
            "Poses may already be solved - rerun once brush-cli is built and "
            "stage 2 will be reused."
        )

    model = dataset_dir / "sparse" / "0"
    if not (model / "cameras.txt").is_file():
        raise TrainError(
            f"No camera poses at {model}. Stage 2 has to succeed before "
            "training can start - a trainer cannot invent where the camera was."
        )

    export_dir.mkdir(parents=True, exist_ok=True)
    # Start clean so `snapshots()` cannot return a splat from a previous run and
    # present it as this one's progress.
    for stale in export_dir.glob("export_*.ply"):
        stale.unlink()

    cmd = [
        brush.path,
        str(dataset_dir),
        "--total-train-iters", str(cfg.steps),
        "--max-resolution", str(cfg.max_resolution),
        "--max-splats", str(cfg.max_splats),
        "--growth-select-fraction", str(cfg.growth_select_fraction),
        "--export-every", str(cfg.export_every),
        "--export-path", str(export_dir),
        "--export-name", EXPORT_NAME,
    ]

    started = time.time()
    if progress:
        progress("starting trainer", 0.0)

    tail: list[str] = []
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as exc:
        raise TrainError(f"Could not start {brush.path}: {exc}") from exc

    # PROGRESS FROM THE FILES, because the process will not tell us.
    #
    # `--export-every` makes Brush drop `export_<iter>.ply` as it goes, and the
    # highest iteration on disk is a true statement about how far the run has
    # got. Same derive-by-looking rule the rest of this package runs on: the
    # artefact IS the progress, so this survives a restart and cannot drift.
    #
    # Granularity is `export_every` steps - five updates across a 10k run - which
    # is coarse and is real, and infinitely better than one update and silence.
    watching = threading.Event()

    def _watch_snapshots() -> None:
        last = -1
        while not watching.wait(4.0):
            try:
                snaps = snapshots(export_dir)
            except OSError:
                continue
            if not snaps:
                continue
            m = _ITER_RE.search(snaps[-1].name)
            if not m:
                continue
            cur = int(m.group(1))
            if cur <= last:
                continue
            last = cur
            if progress:
                progress(
                    f"training ({cur:,}/{cfg.steps:,} steps)",
                    min(0.99, cur / cfg.steps) if cfg.steps else 0.0,
                )

    if progress:
        watcher = threading.Thread(target=_watch_snapshots, name="train-progress", daemon=True)
        watcher.start()
    else:
        watcher = None

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        tail.append(line)
        if len(tail) > 40:
            tail.pop(0)
        m = _STEP_RE.search(line)
        if m and progress:
            try:
                cur = int(m.group(1).replace(",", ""))
                total = int(m.group(2).replace(",", "")) or cfg.steps
                progress(f"training ({cur:,}/{total:,} steps)", min(1.0, cur / total))
            except ValueError:
                pass
    code = proc.wait()
    watching.set()
    if watcher is not None:
        watcher.join(timeout=6.0)

    # THE FILE IS THE TRUTH. A zero exit with no ply is a failure; a non-zero
    # exit that nonetheless left a usable snapshot is worth surfacing rather
    # than discarding, because an hour of training is expensive to repeat.
    snaps = snapshots(export_dir)
    if not snaps:
        why = "\n  ".join(tail[-8:]) if tail else "(no output)"
        raise TrainError(
            f"The trainer exited with code {code} and wrote no splat.\n  {why}"
        )

    final = snaps[-1]
    m = _ITER_RE.search(final.name)
    iterations = int(m.group(1)) if m else cfg.steps
    if progress:
        progress("splat written", 1.0)

    return TrainResult(
        ply=final,
        iterations=iterations,
        seconds=round(time.time() - started, 1),
        bytes=final.stat().st_size,
        snapshots=snaps,
    )
