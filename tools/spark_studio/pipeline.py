"""The three stages, in order, with the state written down as it goes.

    video.mp4 --frames--> images/ --poses--> sparse/0/ --train--> exports/*.ply

RESUMABLE BY CONSTRUCTION, AND THAT IS NOT A CONVENIENCE

Stage 2 takes 10 minutes to 2 hours and stage 3 takes as long again. A crash, a
closed laptop lid or a Ctrl-C at minute 80 must not mean starting over, so each
stage checks whether its OUTPUT already exists and skips itself if so. The check
is on artefacts, never on a flag in the manifest: a manifest can be written by a
build that no longer exists, while `sparse/0/cameras.txt` either parses or does
not. Same rule as `lib/splatJobs.ts` - derive from the filesystem, never sync.

THE MANIFEST IS COMMENTARY

`run.json` records what each stage measured, because those numbers cannot be
recovered by looking at the output later - how many frames were dropped as
blurry, how long the mapper took, what fraction of the walk got registered. It
is never consulted to decide what to do next.
"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Optional

from . import frames as frames_mod
from .poses import ColmapSolver, PoseError, PoseResult, PoseSolver, PrecomputedSolver
from .train import TrainConfig, TrainError, TrainResult, train

#: How much of the overall progress bar each stage owns. Rough, but honest about
#: the fact that extraction is seconds and the other two are the whole afternoon.
_WEIGHTS = {"frames": 0.05, "poses": 0.45, "train": 0.50}

ProgressFn = Callable[[str, float], None]


class PipelineError(RuntimeError):
    """A stage failed in a way worth repeating to a person."""


@dataclass
class RunPaths:
    """Where everything for one reconstruction lives."""

    root: Path

    @property
    def images(self) -> Path:
        return self.root / "images"

    @property
    def sparse_model(self) -> Path:
        return self.root / "sparse" / "0"

    @property
    def exports(self) -> Path:
        return self.root / "exports"

    @property
    def manifest(self) -> Path:
        return self.root / "run.json"


@dataclass
class RunResult:
    """Everything that happened, and the one file that matters."""

    run_id: str
    root: Path
    #: The finished splat. The whole point.
    ply: Optional[Path]
    frames: Optional[dict] = None
    poses: Optional[dict] = None
    training: Optional[dict] = None
    seconds: float = 0.0
    #: Non-fatal things a person should know - partial registration, dropped frames.
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """True only when a splat is on disk. Never a flag anyone sets."""
        return self.ply is not None and self.ply.is_file() and self.ply.stat().st_size > 0


def _has_frames(paths: RunPaths) -> bool:
    return paths.images.is_dir() and any(paths.images.glob("frame_*.jpg"))


def _has_poses(paths: RunPaths) -> bool:
    """Parseable, not merely present - a truncated write is not a solve."""
    cams = paths.sparse_model / "cameras.txt"
    imgs = paths.sparse_model / "images.txt"
    if not (cams.is_file() and imgs.is_file()):
        return False
    body = [
        ln
        for ln in imgs.read_text(encoding="utf-8", errors="replace").splitlines()
        if ln.strip() and not ln.startswith("#")
    ]
    return len(body) >= 2


def run(
    video: Path,
    root: Path,
    *,
    run_id: Optional[str] = None,
    solver: Optional[PoseSolver] = None,
    train_config: Optional[TrainConfig] = None,
    target_frames: int = 150,
    max_frames: int = 400,
    sharp_keep: float = 1.0,
    resume: bool = True,
    progress: Optional[ProgressFn] = None,
) -> RunResult:
    """Turn one video into one .ply. The whole feature, in one call."""
    started = time.time()
    video = Path(video)
    root = Path(root)
    rid = run_id or root.name
    paths = RunPaths(root)
    root.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    done = 0.0

    def stage_progress(stage: str) -> ProgressFn:
        base = done

        def inner(message: str, frac: float) -> None:
            if progress:
                progress(message, base + _WEIGHTS[stage] * max(0.0, min(1.0, frac)))

        return inner

    result = RunResult(run_id=rid, root=root, ply=None)

    def save() -> None:
        result.seconds = round(time.time() - started, 1)
        result.warnings = warnings
        try:
            paths.manifest.write_text(
                json.dumps(
                    {
                        "run_id": rid,
                        "source": str(video),
                        "ply": str(result.ply) if result.ply else None,
                        "frames": result.frames,
                        "poses": result.poses,
                        "training": result.training,
                        "warnings": warnings,
                        "seconds": result.seconds,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        except OSError:
            # A manifest that cannot be written must not fail a run that worked.
            pass

    # -- stage 1: frames -----------------------------------------------------
    if resume and _has_frames(paths):
        n = len(sorted(paths.images.glob("frame_*.jpg")))
        result.frames = {"kept": n, "reused": True}
        if progress:
            progress(f"reusing {n} frames already extracted", _WEIGHTS["frames"])
    else:
        try:
            stats = frames_mod.extract(
                video,
                paths.images,
                target_frames=target_frames,
                max_frames=max_frames,
                sharp_keep=sharp_keep,
            )
        except frames_mod.FrameError as exc:
            save()
            raise PipelineError(str(exc)) from exc
        result.frames = asdict(stats)
        if stats.kept < 20:
            warnings.append(
                f"Only {stats.kept} frames. Camera solving is unreliable below "
                "about 20 - expect this to fail or to cover only part of the walk."
            )
    done += _WEIGHTS["frames"]
    save()

    # -- stage 2: poses ------------------------------------------------------
    if resume and _has_poses(paths):
        pose_result = PrecomputedSolver("reused").solve(paths.images, root)
        result.poses = {**asdict(pose_result), "dataset_dir": str(root), "reused": True}
        if progress:
            progress(
                f"reusing camera poses for {pose_result.registered} frames",
                done + _WEIGHTS["poses"],
            )
    else:
        chosen = solver or ColmapSolver()
        try:
            pose_result = chosen.solve(paths.images, root, stage_progress("poses"))
        except PoseError as exc:
            save()
            raise PipelineError(str(exc)) from exc
        result.poses = {**asdict(pose_result), "dataset_dir": str(root)}
        if pose_result.partial:
            warnings.append(
                f"Only {pose_result.registered} of {pose_result.total} frames were "
                f"placed ({round(pose_result.fraction * 100)}%). The splat will "
                "cover the part of the walk that solved, not all of it."
            )
    done += _WEIGHTS["poses"]
    save()

    # -- stage 3: train ------------------------------------------------------
    try:
        trained: TrainResult = train(
            root, paths.exports, train_config, stage_progress("train")
        )
    except TrainError as exc:
        save()
        raise PipelineError(str(exc)) from exc

    result.ply = trained.ply
    result.training = {
        "ply": str(trained.ply),
        "iterations": trained.iterations,
        "seconds": trained.seconds,
        "bytes": trained.bytes,
        "snapshots": len(trained.snapshots),
    }
    save()
    return result


def publish(result: RunResult, destination: Path) -> Path:
    """Copy the finished splat where the web app already looks for it.

    `web/lib/splatJobs.ts` derives readiness from
    `public/mock/splats/<jobId>.ply` existing - so this copy IS the state
    change that flips a job to ready. Nothing else needs to be told.

    Written to a temporary name and renamed, because a half-copied 200 MB ply
    that a poller catches mid-write is a file that exists and will not parse.
    """
    if not result.ok or result.ply is None:
        raise PipelineError("Nothing to publish - this run produced no splat.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.with_suffix(".ply.partial")
    shutil.copyfile(result.ply, staging)
    staging.replace(destination)
    return destination
