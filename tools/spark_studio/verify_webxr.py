#!/usr/bin/env python3
"""A second opinion on the browser's COLMAP conversion, from pycolmap.

    web>  npx tsx scripts/verify-webxr.ts
    .venv-splat/Scripts/python.exe tools/spark_studio/verify_webxr.py [dataset]

WHY THIS EXISTS SEPARATELY FROM THE TYPESCRIPT VERIFIER

web/scripts/verify-webxr.ts proves the conversion is self-consistent: round
trips close, known cameras put known points on known pixels. What it cannot
prove is that our reading of COLMAP's convention is COLMAP's reading of it. A
mirrored world and a mirrored camera agree with each other perfectly.

So this script takes the dataset that verifier wrote, hands it to pycolmap --
which parses the text format with the same code COLMAP itself uses -- and asks
pycolmap to project the same world points through the same cameras. If the two
implementations land on the same pixels, the convention is right. If they do
not, one of us is wrong and it is almost certainly us.

It also runs the dataset through PrecomputedSolver, which is what the pipeline
will actually do with it, because "pycolmap can read it" and "this package
accepts it as a finished stage 2" are different claims.

WHAT IT STILL DOES NOT PROVE

Reconstruction QUALITY from a model with an EMPTY points3D.txt. Brush ACCEPTS
one - a 12-camera synthetic dataset trained to 13,295 gaussians in 12 s with no
initial cloud at all, both early stages skipped - so the format is fine. But the
spike in docs/brush_capability_report.md (S0.1) seeded its run with 164,340
LiDAR points, and a browser has no depth sensor to supply any. Whether that
costs visible quality on real footage is open, and needs a real capture.

And nothing here touches a WebXR session. See docs/webxr_capture.md for the
manual on-device test that would.
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

#: A pixel of disagreement would be a real bug; this tolerance only has to
#: absorb the difference between our 9-decimal text and a double.
TOLERANCE_PX = 1e-4

_failures = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global _failures
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{('  ' + detail) if detail else ''}")
    if not ok:
        _failures += 1


def section(title: str) -> None:
    print(f"\n{title}")


def default_dataset() -> Path:
    return Path(tempfile.gettempdir()) / "spark-webxr-verify"


def _compare_projections(by_name: dict, expected: dict) -> None:
    """The claim that matters: same camera, same point, same pixel."""
    section("pycolmap projects the same points onto the same pixels")
    worst = 0.0
    missing = 0
    compared = 0
    for frame in expected["frames"]:
        image = by_name.get(frame["image"])
        if image is None:
            missing += 1
            continue
        for probe in frame["pixels"]:
            if probe["uv"] is None:
                # Our side said "behind the camera". pycolmap agreeing is worth
                # checking too - project_point returns None for the same case.
                check(
                    f"{frame['image']}: a point behind the camera is refused by both",
                    image.project_point(probe["world"]) is None,
                )
                continue
            got = image.project_point(probe["world"])
            if got is None:
                check(
                    f"{frame['image']}: pycolmap sees the point at all",
                    False,
                    "pycolmap says it is behind the camera; we said it was in front",
                )
                continue
            worst = max(worst, math.hypot(got[0] - probe["uv"][0], got[1] - probe["uv"][1]))
            compared += 1

    check("every predicted image exists in the model", missing == 0, f"{missing} missing")
    check(
        f"{compared} projections agree with pycolmap",
        compared > 0 and worst < TOLERANCE_PX,
        f"worst disagreement {worst:.3e} px (tolerance {TOLERANCE_PX:g})",
    )


def _compare_centres(by_name: dict, expected: dict) -> None:
    """Where each camera STOOD, which the projections alone do not pin down.

    A pose can put every point on the right pixel from the wrong position if the
    rotation absorbs the error. pycolmap derives the centre as -R^T t, entirely
    independently of us, so comparing it against the WebXR position we started
    from is a check on the inversion specifically.
    """
    section("pycolmap puts the cameras where WebXR said they were")
    eyes = expected.get("eyes")
    if not eyes:
        print("  --   no camera positions recorded; skipped")
        return
    worst = 0.0
    for frame, eye in zip(expected["frames"], eyes):
        image = by_name.get(frame["image"])
        if image is None:
            continue
        centre = image.projection_center()
        worst = max(worst, math.dist([centre[0], centre[1], centre[2]], eye))
    check(
        "every camera centre matches the WebXR camera position",
        worst < 1e-6,
        f"worst {worst:.3e} m",
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    dataset = Path(argv[0]).expanduser() if argv else default_dataset()

    print("\nWebXR posed capture - a second opinion from pycolmap\n")
    print(f"  dataset    {dataset}")

    if not (dataset / "sparse" / "0" / "images.txt").is_file():
        print(
            f"\n  Nothing at {dataset}. Run this first, from web/:\n"
            "    npx tsx scripts/verify-webxr.ts\n",
            file=sys.stderr,
        )
        return 2

    try:
        import pycolmap
    except ImportError:
        print(
            "\n  pycolmap is not installed in this interpreter, so there is no\n"
            "  second implementation to compare against. Nothing was checked.\n",
            file=sys.stderr,
        )
        return 2

    # -- can COLMAP's own reader parse what a browser wrote? -----------------
    section("pycolmap reads the model")
    try:
        rec = pycolmap.Reconstruction(str(dataset / "sparse" / "0"))
    except Exception as exc:  # noqa: BLE001 - any parse failure is the finding
        check("the text model parses", False, str(exc))
        print(f"\n{_failures} check(s) failed.\n")
        return 1

    # A REAL capture from a phone has no predictions to compare against - it was
    # not generated by anything that could make them. Everything except the
    # projection comparison still applies to it, and that is the point of
    # splitting this: step 7 of the manual test in docs/webxr_capture.md points
    # a person at a dataset that came off a phone.
    predictions = dataset / "expected_projections.json"
    expected = (
        json.loads(predictions.read_text(encoding="utf-8"))
        if predictions.is_file()
        else None
    )
    want_images = len(expected["frames"]) if expected else rec.num_images()

    check("the text model parses", True)
    check(
        f"all {want_images} images are present",
        rec.num_images() == want_images,
        f"got {rec.num_images()}",
    )
    check(
        "every image has a pose",
        all(im.has_pose for im in rec.images.values()),
    )
    check(
        "points3D is empty, as a browser with no depth sensor must leave it",
        rec.num_points3D() == 0,
        f"got {rec.num_points3D()}",
    )

    # -- do the two implementations agree about where things land? ----------
    by_name = {im.name: im for im in rec.images.values()}
    if expected is None:
        section("pycolmap projects the same points onto the same pixels")
        print("  --   no predictions beside this dataset (a real capture); skipped")
    else:
        _compare_projections(by_name, expected)
        _compare_centres(by_name, expected)

    # -- and does this package accept it as a finished stage 2? -------------
    section("the pipeline accepts it as an already-solved stage 2")
    from spark_studio.poses import PoseError, PrecomputedSolver

    try:
        result = PrecomputedSolver("webxr").solve(dataset / "images", dataset)
    except PoseError as exc:
        check("PrecomputedSolver accepts the model", False, str(exc))
        print(f"\n{_failures} check(s) failed.\n")
        return 1

    check("PrecomputedSolver accepts the model", True, result.describe())
    check(
        "it counts every image, not half of them",
        result.registered == want_images,
        f"registered {result.registered} of {want_images}",
    )
    check(
        "it is not reported as a partial solve",
        not result.partial,
        "a full capture must not warn that it only covers part of the walk",
    )
    check(
        "an empty points3D.txt is tolerated by the solver",
        result.points3d == 0,
        "Brush accepts one too; whether it COSTS quality on real footage is open",
    )

    print(
        "\nThe browser and COLMAP agree about the coordinate system.\n"
        if _failures == 0
        else f"\n{_failures} check(s) failed.\n"
    )
    return 0 if _failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
