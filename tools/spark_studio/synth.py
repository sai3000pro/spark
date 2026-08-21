"""A synthetic scene with known geometry, for proving the install works.

WHY THIS SHIPS RATHER THAN LIVING IN A TEST FOLDER

The first question anyone has after installing this is "does it work on my
machine", and the honest answer needs a reconstruction to have actually
happened. Asking them to go and film something first means the first thing they
learn about the pipeline is a failure they cannot attribute: bad footage, or bad
install? This removes that ambiguity - the scene here is built to be solvable,
so if `selftest` fails, the install is at fault.

TWO THINGS THIS SCENE GETS RIGHT, BOTH LEARNED THE HARD WAY

1. TEXTURE MUST BE MULTI-SCALE. The first version of this file painted planes
   with per-pixel random colour, on the theory that noise is maximally
   featureful. It is the opposite. SIFT locates blobs across a scale pyramid and
   describes them by their neighbourhood; white noise looks identical everywhere
   at every scale, so it yields thousands of mutually indistinguishable
   descriptors and the matcher pairs them at random. COLMAP's verdict was "no
   good initial image pair found" on 48 frames of a scene with perfect geometry.
   The texture here is drawn as nested shapes from coarse to fine, which is what
   real surfaces look like to a feature detector.

2. SURFACES MUST NOT INTERSECT. Rendering is painter's algorithm - sort by
   depth, draw far to near - which is only correct for surfaces that do not
   pass through each other. Three planes meeting at a room corner intersect
   along their edges, so their draw order can flip between neighbouring frames
   and produce two images that are not projections of the same rigid scene. SfM
   is entitled to fail on that, and it would be our fault. So the scene is
   separated billboards at different depths: real parallax, no intersections.
"""

from __future__ import annotations

import math
import subprocess
from pathlib import Path

from .doctor import check_ffmpeg

_W, _H = 960, 540
#: Horizontal FOV of the virtual camera, in degrees.
_FOV = 65.0
_TEX = 512
#: Billboards scattered through the volume the camera arcs around.
_PANELS = 11


def _texture(rng, size: int = _TEX):
    """A patch with structure at every scale, which is what SIFT needs."""
    from PIL import Image, ImageDraw, ImageFilter

    base = tuple(int(v) for v in rng.integers(40, 90, size=3))
    img = Image.new("RGB", (size, size), base)
    d = ImageDraw.Draw(img)
    # Coarse to fine: a few big shapes, many small ones. The ratio matters more
    # than the shapes - it is what gives the scale pyramid something at each level.
    for scale, count in ((0.45, 4), (0.22, 10), (0.10, 26), (0.045, 70)):
        s = size * scale
        for _ in range(count):
            x = float(rng.uniform(-s, size))
            y = float(rng.uniform(-s, size))
            w = float(rng.uniform(s * 0.5, s))
            h = float(rng.uniform(s * 0.5, s))
            col = tuple(int(v) for v in rng.integers(0, 256, size=3))
            box = [x, y, x + w, y + h]
            if rng.random() < 0.5:
                d.ellipse(box, fill=col)
            else:
                d.rectangle(box, fill=col)
    # A whisper of blur so JPEG does not turn hard edges into ringing, which
    # moves keypoints around between frames.
    return img.filter(ImageFilter.GaussianBlur(0.6))


def _panels(rng):
    """Textured quads scattered in a volume, each with its own 4 world corners."""
    import numpy as np

    out = []
    for _ in range(_PANELS):
        centre = np.array(
            [rng.uniform(-2.6, 2.6), rng.uniform(-1.4, 1.6), rng.uniform(-2.6, 2.6)]
        )
        # Random orientation, but biased to face roughly outward so the camera
        # sees texture rather than edge-on slivers.
        yaw = rng.uniform(0, 2 * math.pi)
        pitch = rng.uniform(-0.35, 0.35)
        right = np.array([math.cos(yaw), 0.0, -math.sin(yaw)])
        up = np.array([0.0, math.cos(pitch), math.sin(pitch)])
        w = rng.uniform(0.9, 1.8)
        h = rng.uniform(0.9, 1.8)
        corners = np.stack(
            [
                centre - right * w / 2 - up * h / 2,
                centre + right * w / 2 - up * h / 2,
                centre + right * w / 2 + up * h / 2,
                centre - right * w / 2 + up * h / 2,
            ]
        )
        out.append((corners, _texture(rng)))
    return out


def _look_at(eye, target, up=(0.0, 1.0, 0.0)):
    """World->camera rotation, OpenCV convention (+x right, +y down, +z fwd)."""
    import numpy as np

    eye = np.asarray(eye, dtype=float)
    fwd = np.asarray(target, dtype=float) - eye
    fwd /= np.linalg.norm(fwd)
    up = np.asarray(up, dtype=float)
    right = np.cross(fwd, up)
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    return np.stack([right, down, fwd]), eye


def _perspective_coeffs(dst, src):
    """PIL wants the OUTPUT->INPUT homography, as 8 coefficients."""
    import numpy as np

    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        B.append(v)
    return np.linalg.solve(np.asarray(A, float), np.asarray(B, float)).tolist()


def render_frames(out_dir: Path, n_frames: int = 60, seed: int = 7) -> int:
    """Write `frame_%05d.jpg` of a camera arcing around the panels."""
    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(seed)
    panels = _panels(rng)
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("frame_*.jpg"):
        stale.unlink()

    f = (_W / 2) / math.tan(math.radians(_FOV) / 2)
    cx, cy = _W / 2, _H / 2
    target = np.zeros(3)
    written = 0

    for i in range(n_frames):
        t = i / max(1, n_frames - 1)
        # A 130-degree arc at ~7 m. Wide enough that consecutive frames share
        # most of their content while every pair has real baseline.
        ang = math.radians(-65 + 130 * t)
        radius = 7.0
        eye = np.array(
            [radius * math.sin(ang), 0.6 + 0.9 * math.sin(t * math.pi), radius * math.cos(ang)]
        )
        R, C = _look_at(eye, target)

        frame = Image.new("RGB", (_W, _H), (14, 14, 18))
        drawable = []
        for corners, tex in panels:
            cam = (corners - C) @ R.T
            if np.any(cam[:, 2] < 0.4):
                continue  # partly behind the camera; a homography cannot express it
            xs = f * cam[:, 0] / cam[:, 2] + cx
            ys = f * cam[:, 1] / cam[:, 2] + cy
            quad = list(zip(xs.tolist(), ys.tolist()))
            # Skip degenerate slivers - they carry no features and can make the
            # 8x8 solve singular.
            area = 0.0
            for k in range(4):
                x0, y0 = quad[k]
                x1, y1 = quad[(k + 1) % 4]
                area += x0 * y1 - x1 * y0
            if abs(area) / 2 < 900:
                continue
            drawable.append((float(cam[:, 2].mean()), quad, tex))

        # Painter's algorithm. Correct here because panels never intersect.
        for _, quad, tex in sorted(drawable, key=lambda d: -d[0]):
            src = [(0, 0), (_TEX, 0), (_TEX, _TEX), (0, _TEX)]
            try:
                coeffs = _perspective_coeffs(quad, src)
            except Exception:
                continue
            warped = tex.transform(
                (_W, _H), Image.PERSPECTIVE, coeffs, Image.BICUBIC
            )
            mask = Image.new("L", (_TEX, _TEX), 255).transform(
                (_W, _H), Image.PERSPECTIVE, coeffs, Image.BILINEAR
            )
            frame.paste(warped, (0, 0), mask)

        frame.save(out_dir / f"frame_{i + 1:05d}.jpg", quality=95)
        written += 1

    return written


def render_video(out: Path, n_frames: int = 60, fps: int = 12, seed: int = 7) -> Path:
    """Render the scene and encode it, so the full pipeline can be exercised."""
    ff = check_ffmpeg()
    if not ff.found or not ff.path:
        raise RuntimeError(f"No ffmpeg. {ff.fix}")
    tmp = out.parent / f"{out.stem}_frames"
    render_frames(tmp, n_frames=n_frames, seed=seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ff.path, "-v", "error", "-y",
            "-framerate", str(fps),
            "-i", str(tmp / "frame_%05d.jpg"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    for f in tmp.glob("frame_*.jpg"):
        f.unlink()
    tmp.rmdir()
    return out
