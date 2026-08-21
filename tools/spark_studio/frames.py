"""Stage 1 — a video becomes a folder of images.

The dullest stage and the one that decides whether the next two can succeed.
COLMAP does not fail on "bad video"; it fails on frames that share too few
features, and almost every cause of that is decided here: too few frames, too
many frames of the same wall, or frames so motion-blurred that SIFT finds
nothing stable.

WHY NOT JUST TAKE EVERY FRAME. A 60-second 30 fps clip is 1800 images. Matching
cost grows with the square of that for exhaustive matching and linearly with
`overlap` for sequential, and the mapper is CPU-bound Ceres either way. Beyond a
few hundred frames you pay hours for redundancy: consecutive frames of a slow
walk are nearly the same photograph, and a pair with no baseline contributes no
geometry. So we sample, and we say what we sampled.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .doctor import check_ffmpeg


class FrameError(RuntimeError):
    """Extraction failed for a reason worth repeating to a person."""


@dataclass
class FrameStats:
    """What actually happened, so nothing downstream has to guess."""

    #: Frames ffmpeg wrote before any gating.
    extracted: int = 0
    #: Frames left after the blur gate — this is what COLMAP will see.
    kept: int = 0
    dropped_blurry: int = 0
    dropped_subsample: int = 0
    fps: float = 0.0
    #: Variance-of-Laplacian distribution, for reporting rather than gating.
    sharpness: dict = field(default_factory=dict)
    source_seconds: Optional[float] = None


def probe_duration(video: Path) -> Optional[float]:
    """Seconds, or None. Used to pick an fps that lands near the frame target."""
    ff = check_ffmpeg()
    if not ff.found or not ff.path:
        return None
    out = subprocess.run(
        [ff.path, "-i", str(video)], capture_output=True, text=True
    )
    # ffmpeg prints the duration to stderr and exits non-zero with no output
    # file; that is the normal path here, not an error.
    for line in (out.stderr or "").splitlines():
        if "Duration:" in line:
            stamp = line.split("Duration:")[1].split(",")[0].strip()
            try:
                h, m, s = stamp.split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                return None
    return None


def choose_fps(duration_s: Optional[float], target_frames: int) -> float:
    """An fps that yields roughly `target_frames` over the whole clip.

    Deliberately NOT a fixed 2 fps. A 20-second clip at 2 fps gives 40 frames,
    which is thin for a mapper; a 5-minute clip at 2 fps gives 600, which is an
    afternoon of matching. Scaling to the clip keeps both ends sane.
    """
    if not duration_s or duration_s <= 0:
        return 2.0
    fps = target_frames / duration_s
    # Never sample faster than the interesting motion, never slower than a crawl.
    return max(0.5, min(6.0, fps))


def _lap_var(path: Path) -> float:
    """Variance of the Laplacian — the standard cheap sharpness proxy."""
    import numpy as np
    from PIL import Image

    try:
        with Image.open(path) as im:
            im = im.convert("L")
            if im.width > 320:
                im = im.resize((320, max(1, int(im.height * 320 / im.width))))
            g = np.asarray(im, dtype=np.float64)
    except Exception:
        return 0.0
    lap = (
        -4 * g
        + np.roll(g, 1, 0)
        + np.roll(g, -1, 0)
        + np.roll(g, 1, 1)
        + np.roll(g, -1, 1)
    )
    return float(lap[1:-1, 1:-1].var())


def extract(
    video: Path,
    out_dir: Path,
    *,
    target_frames: int = 150,
    max_frames: int = 400,
    sharp_keep: float = 1.0,
    start: Optional[float] = None,
    end: Optional[float] = None,
) -> FrameStats:
    """Write `out_dir/frame_%05d.jpg` and report what landed there.

    `sharp_keep` is a fraction to KEEP, by rank within THIS clip's own sharpness
    distribution — never an absolute threshold, which would be tuned to one
    camera and one lighting condition. It defaults to 1.0 (keep everything)
    because dropping frames punches holes in the sequence, and `match_sequential`
    pairs by index: a gate that removes every third frame quietly halves the
    real overlap. Turn it down only when the footage is visibly blurry.
    """
    ff = check_ffmpeg()
    if not ff.found or not ff.path:
        raise FrameError(f"No ffmpeg. {ff.fix}")
    if not video.is_file():
        raise FrameError(f"No such video: {video}")

    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("frame_*.jpg"):
        stale.unlink()

    duration = probe_duration(video)
    fps = choose_fps(
        (end - start) if (start is not None and end is not None) else duration,
        target_frames,
    )

    cmd = [ff.path, "-v", "error", "-y"]
    if start is not None:
        cmd += ["-ss", str(start)]
    cmd += ["-i", str(video)]
    if start is not None and end is not None:
        cmd += ["-t", str(max(0.1, end - start))]
    # -q:v 2 is near-visually-lossless JPEG. SIFT is sensitive to compression
    # artefacts at low quality, and the disk saved is not worth the features lost.
    cmd += ["-vf", f"fps={fps}", "-q:v", "2", str(out_dir / "frame_%05d.jpg")]

    run = subprocess.run(cmd, capture_output=True, text=True)
    files = sorted(out_dir.glob("frame_*.jpg"))
    if not files:
        detail = (run.stderr or "").strip().splitlines()
        why = detail[-1] if detail else "ffmpeg produced no frames"
        raise FrameError(f"Could not read any frames from {video.name}. {why}")

    stats = FrameStats(
        extracted=len(files), fps=round(fps, 3), source_seconds=duration
    )

    # Uniform subsample down to the hard cap, preserving even coverage of the
    # whole walk rather than truncating the end.
    if len(files) > max_frames:
        import numpy as np

        keep = set(np.linspace(0, len(files) - 1, max_frames).astype(int).tolist())
        for i, f in enumerate(files):
            if i not in keep:
                f.unlink()
                stats.dropped_subsample += 1
        files = sorted(out_dir.glob("frame_*.jpg"))

    scores = [_lap_var(f) for f in files]
    if scores:
        import numpy as np

        a = np.array(scores)
        stats.sharpness = {
            "mean": round(float(a.mean()), 1),
            "median": round(float(np.median(a)), 1),
            "min": round(float(a.min()), 1),
            "max": round(float(a.max()), 1),
        }

    if sharp_keep < 1.0 and len(files) > 8:
        import numpy as np

        threshold = float(np.quantile(scores, 1.0 - sharp_keep))
        for score, f in zip(scores, files):
            if score < threshold:
                f.unlink()
                stats.dropped_blurry += 1

    stats.kept = len(sorted(out_dir.glob("frame_*.jpg")))
    return stats
