"""Stage 2 — where was the camera when it took each frame?

THIS STAGE DOES NOT MAKE A SPLAT. It is worth saying at the top of the file
because it is the most persistent misunderstanding about this pipeline. What
comes out is a folder of three text files describing camera intrinsics, one
world->camera pose per registered image, and a sparse dust of triangulated tie
points. You cannot look at it. Stage 3 is the one that makes something you can
look at, and it cannot start until this has succeeded.

WHY THERE IS A SEAM HERE AND NOT ANYWHERE ELSE

Solving poses from pixels alone is expensive — minutes to hours — and it is the
only stage with a plausible alternative: a phone that ran ARKit already KNOWS
where it was, to within about a degree, and `tools/arkit_capture/export_colmap.py`
already writes this exact triple from a capture without solving anything. So the
boundary is drawn at the COLMAP text format rather than at "run COLMAP", and a
solver is anything that can produce one. Adding the ARKit path later means
implementing this protocol, not editing the pipeline.

WHAT PARTIAL SUCCESS LOOKS LIKE, AND WHY IT IS REPORTED LOUDLY

COLMAP does not usually fail cleanly. It registers the frames it can and drops
the rest, so a walk down a corridor can come back with 38 of 150 images and a
perfectly valid-looking reconstruction of the first eight metres. Train on that
and you get a splat of one end of the corridor and nobody told you why. So
`registered` and `total` are separate fields here, never collapsed into a
boolean, and the pipeline decides what a shortfall means.
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Protocol

#: Below this fraction of frames registered, the reconstruction covers so little
#: of the walk that training it would misrepresent what was filmed. Not a hard
#: failure — the caller decides — but never silent.
PARTIAL_REGISTRATION = 0.6


class PoseError(RuntimeError):
    """No usable camera solution. Carries a sentence a person can act on."""


@dataclass
class PoseResult:
    """The solve, as it actually turned out."""

    #: Directory holding sparse/0/{cameras,images,points3D}.txt
    dataset_dir: Path
    #: Images the solver placed. THE NUMBER THAT MATTERS.
    registered: int
    #: Images it was given.
    total: int
    points3d: int
    mean_reprojection_error_px: Optional[float]
    #: How the poses were obtained — "colmap" | "arkit" | ...
    source: str
    seconds: float = 0.0

    @property
    def fraction(self) -> float:
        return self.registered / self.total if self.total else 0.0

    @property
    def partial(self) -> bool:
        return self.fraction < PARTIAL_REGISTRATION

    def describe(self) -> str:
        pct = round(self.fraction * 100)
        err = (
            f", {self.mean_reprojection_error_px:.2f} px mean reprojection error"
            if self.mean_reprojection_error_px is not None
            else ""
        )
        return (
            f"{self.registered} of {self.total} frames placed ({pct}%), "
            f"{self.points3d:,} tie points{err}"
        )


class PoseSolver(Protocol):
    """Anything that can turn a folder of images into a COLMAP text model."""

    name: str

    def solve(
        self,
        images_dir: Path,
        dataset_dir: Path,
        progress: Optional[Callable[[str, float], None]] = None,
    ) -> PoseResult: ...


class ColmapSolver:
    """Structure-from-motion with pycolmap — the general case.

    Works on any video from any camera with no metadata at all, which is the
    whole reason it is the default. It pays for that generality in wall clock
    and in the failure mode described at the top of this file.
    """

    name = "colmap"

    def __init__(
        self,
        *,
        max_image_size: int = 1600,
        sequential_overlap: int = 10,
        loop_detection: bool = False,
        use_gpu: bool = True,
    ) -> None:
        self.max_image_size = max_image_size
        self.sequential_overlap = sequential_overlap
        # Off by default: loop closure needs a vocabulary tree file that is a
        # separate several-hundred-MB download. Enabling it without one makes
        # COLMAP log a warning and carry on, which looks like it worked.
        self.loop_detection = loop_detection
        self.use_gpu = use_gpu

    def solve(
        self,
        images_dir: Path,
        dataset_dir: Path,
        progress: Optional[Callable[[str, float], None]] = None,
    ) -> PoseResult:
        try:
            import pycolmap
        except Exception as exc:
            raise PoseError(
                f"pycolmap is not installed ({type(exc).__name__}). "
                "pip install pycolmap"
            ) from exc

        def say(stage: str, frac: float) -> None:
            if progress:
                progress(stage, frac)

        images = sorted(images_dir.glob("frame_*.jpg"))
        if len(images) < 8:
            raise PoseError(
                f"Only {len(images)} frames - far too few to solve camera "
                "positions. A usable clip is 20 seconds or more of moving footage."
            )

        dataset_dir.mkdir(parents=True, exist_ok=True)
        db = dataset_dir / "database.db"
        sparse = dataset_dir / "sparse"
        if db.exists():
            db.unlink()
        if sparse.exists():
            shutil.rmtree(sparse)
        sparse.mkdir(parents=True)

        started = time.time()

        # -- features --------------------------------------------------------
        # SIMPLE_RADIAL with one shared camera: every frame came from the same
        # phone at the same zoom, so solving one intrinsic set over 150 images
        # is both faster and better-conditioned than solving 150 of them.
        say("extracting features", 0.0)
        reader = pycolmap.ImageReaderOptions()
        reader.camera_model = "SIMPLE_RADIAL"
        extraction = pycolmap.FeatureExtractionOptions()
        extraction.max_image_size = self.max_image_size
        extraction.use_gpu = self.use_gpu
        try:
            pycolmap.extract_features(
                database_path=db,
                image_path=images_dir,
                camera_mode=pycolmap.CameraMode.SINGLE,
                reader_options=reader,
                extraction_options=extraction,
            )
        except Exception as exc:
            raise PoseError(f"Feature extraction failed: {exc}") from exc

        # -- matching --------------------------------------------------------
        # Sequential, not exhaustive. These frames came from a video, so frame
        # N genuinely does overlap N+1..N+10 and almost never overlaps N+90.
        # Exhaustive on 300 frames is ~44,850 pairs; sequential is ~3,000.
        say("matching frames", 0.25)
        pairing = pycolmap.SequentialPairingOptions()
        pairing.overlap = self.sequential_overlap
        pairing.loop_detection = self.loop_detection
        try:
            pycolmap.match_sequential(database_path=db, pairing_options=pairing)
        except Exception as exc:
            raise PoseError(f"Feature matching failed: {exc}") from exc

        # -- mapping ---------------------------------------------------------
        # The expensive one, and it is CPU/Ceres - a GPU does not help here.
        say("solving camera positions", 0.45)
        placed = 0

        def on_next_image() -> None:
            nonlocal placed
            placed += 1
            say(
                f"solving camera positions ({placed}/{len(images)} placed)",
                0.45 + 0.5 * min(1.0, placed / max(1, len(images))),
            )

        try:
            recs = pycolmap.incremental_mapping(
                database_path=db,
                image_path=images_dir,
                output_path=sparse,
                next_image_callback=on_next_image,
            )
        except Exception as exc:
            raise PoseError(f"Mapping failed: {exc}") from exc

        if not recs:
            raise PoseError(
                "COLMAP could not place a single camera. This is what happens "
                "when the footage has no parallax - panning from one spot, or "
                "filming a blank wall. Walk AROUND the subject and try again."
            )

        # The mapper can split a walk into disconnected sub-models when tracking
        # breaks. Take the largest; anything else would silently pick a fragment.
        best_id = max(recs, key=lambda k: recs[k].num_reg_images())
        best = recs[best_id]

        zero = sparse / "0"
        if zero.exists():
            shutil.rmtree(zero)
        zero.mkdir(parents=True, exist_ok=True)
        best.write_text(str(zero))

        try:
            err = float(best.compute_mean_reprojection_error())
        except Exception:
            err = None

        say("poses solved", 1.0)
        return PoseResult(
            dataset_dir=dataset_dir,
            registered=best.num_reg_images(),
            total=len(images),
            points3d=best.num_points3D(),
            mean_reprojection_error_px=err,
            source=self.name,
            seconds=round(time.time() - started, 1),
        )


class PrecomputedSolver:
    """Poses that already exist - ARKit, or a previous run.

    Costs nothing and cannot fail on textureless scenes, because nothing is
    being solved. `tools/arkit_capture/export_colmap.py` writes exactly this
    layout from an iPhone capture; this class is what lets the pipeline consume
    it without knowing where it came from.
    """

    name = "precomputed"

    def __init__(self, source: str = "precomputed") -> None:
        self.name = source

    def solve(
        self,
        images_dir: Path,
        dataset_dir: Path,
        progress: Optional[Callable[[str, float], None]] = None,
    ) -> PoseResult:
        model = dataset_dir / "sparse" / "0"
        needed = ["cameras.txt", "images.txt", "points3D.txt"]
        missing = [n for n in needed if not (model / n).is_file()]
        if missing:
            raise PoseError(
                f"Expected an existing COLMAP model at {model} but "
                f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} absent."
            )
        # Two lines per registered image in images.txt; comments start with '#'.
        body = [
            ln
            for ln in (model / "images.txt").read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")
        ]
        registered = len(body) // 2
        points = [
            ln
            for ln in (model / "points3D.txt").read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")
        ]
        if progress:
            progress("using existing poses", 1.0)
        return PoseResult(
            dataset_dir=dataset_dir,
            registered=registered,
            total=len(sorted(images_dir.glob("*.jpg"))) or registered,
            points3d=len(points),
            mean_reprojection_error_px=None,
            source=self.name,
        )
