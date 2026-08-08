#!/usr/bin/env python3
"""sky_mask — generate COLMAP masks that exclude the sky.

Sky pixels have no reliable depth or texture, so outdoors they get reconstructed
as far-flung floaters that blow up the scene scale (the "splash"). COLMAP can
ignore regions if given a mask per image, so we black out the sky before feature
extraction — no sky features -> bounded reconstruction.

Detection is a GENERAL structural heuristic (not a per-video colour threshold):
a pixel is sky-candidate if it is bright AND either low-saturation (white/grey)
or blue-dominant; then per column we keep only the contiguous top region that has
stayed mostly-candidate, so bright ground objects (not connected to the top) are
never masked. Conservative by design. For production, swap in a learned sky
segmenter behind the same interface.

COLMAP convention: mask file is named "<image>.png"; value 0 = ignore, 255 = use.

    python sky_mask.py <images_dir> <masks_dir> [--preview out.png]
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def sky_probability(rgb: np.ndarray) -> np.ndarray:
    """Boolean sky mask (True = sky) for an HxWx3 float image in [0,1]."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    bright = rgb.mean(2)
    mx, mn = rgb.max(2), rgb.min(2)
    sat = (mx - mn) / (mx + 1e-6)
    blue_dom = (b >= r) & (b >= g)
    cand = (bright > 0.55) & ((sat < 0.22) | (blue_dom & (bright > 0.40)))
    # keep only the contiguous top region per column (connected to the sky)
    H = rgb.shape[0]
    cum = np.cumsum(cand, axis=0)
    frac = cum / np.arange(1, H + 1)[:, None]      # fraction candidate down to row y
    sky = cand & (frac > 0.6)
    return sky


def make_mask(image_path: Path) -> Image.Image:
    with Image.open(image_path) as im:
        rgb = np.asarray(im.convert("RGB"), np.float64) / 255.0
    sky = sky_probability(rgb)
    mask = np.where(sky, 0, 255).astype(np.uint8)   # 0 = ignore (sky), 255 = use
    return Image.fromarray(mask, mode="L")


def write_colmap_masks(images_dir: Path, masks_dir: Path) -> dict:
    masks_dir.mkdir(parents=True, exist_ok=True)
    imgs = sorted(list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")))
    frac_sky = []
    for p in imgs:
        m = make_mask(p)
        m.save(masks_dir / f"{p.name}.png")          # COLMAP wants <image>.png
        frac_sky.append(1.0 - np.asarray(m).mean() / 255.0)
    return {"n": len(imgs),
            "mean_sky_frac": round(float(np.mean(frac_sky)), 3) if frac_sky else 0.0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", type=Path)
    ap.add_argument("masks", type=Path)
    ap.add_argument("--preview", type=Path, help="write a masked preview of frame 1")
    a = ap.parse_args()
    info = write_colmap_masks(a.images, a.masks)
    print(f"wrote {info['n']} masks, mean sky fraction {info['mean_sky_frac']}")
    if a.preview:
        imgs = sorted(a.images.glob("*.jpg"))
        if imgs:
            with Image.open(imgs[0]) as im:
                rgb = np.asarray(im.convert("RGB"))
            sky = sky_probability(rgb.astype(np.float64) / 255.0)
            out = rgb.copy(); out[sky] = [255, 0, 255]     # magenta = masked sky
            Image.fromarray(out).save(a.preview)
            print(f"preview -> {a.preview}")


if __name__ == "__main__":
    main()
