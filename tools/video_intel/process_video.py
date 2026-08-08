#!/usr/bin/env python3
"""video_intel — turn a long video into candidate "moments" for context labeling.

Backend-agnostic FIRST STAGE of the highlight/intelligence layer:

    1. probe the video (duration / fps / resolution)                    [ffprobe]
    2. cut it into shots via scene-change detection                     [ffmpeg]
    3. sample candidate frames on a fixed grid                          [ffmpeg]
    4. score each frame for sharpness (variance-of-Laplacian)           [numpy]
    5. pick the sharpest keyframe(s) per shot                           [numpy]
    6. extract a mono 16 kHz audio track for later transcription        [ffmpeg]
    7. write manifest.json describing segments + keyframes

The manifest + extracted keyframes are then handed to a vision-language model
(Claude in-the-loop today; Gemini / local Qwen2.5-VL later) which reads the
keyframes and writes the "what is happening" context per segment. That labeling
step is deliberately NOT here so we can iterate on the model/prompt separately.

Usage:
    python process_video.py VIDEO [--out DIR] [--interval 2.0] [--scene 0.30]
                                  [--keyframes-per-shot 2]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

import numpy as np
from PIL import Image


# --------------------------------------------------------------------------- #
# ffmpeg / ffprobe helpers
# --------------------------------------------------------------------------- #
def _run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(video: Path) -> dict:
    """Container/stream metadata via ffprobe (duration, fps, resolution)."""
    cp = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,duration",
        "-show_entries", "format=duration",
        "-of", "json", str(video),
    ])
    if cp.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {cp.stderr.strip()}")
    data = json.loads(cp.stdout)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    num, _, den = (stream.get("avg_frame_rate") or "0/1").partition("/")
    fps = (float(num) / float(den)) if float(den or 0) else 0.0
    duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "fps": round(fps, 3),
        "duration_s": round(duration, 3),
    }


def scene_cuts(video: Path, threshold: float) -> List[float]:
    """Timestamps (s) where a shot boundary is detected (ffmpeg scene score)."""
    cp = _run([
        "ffmpeg", "-i", str(video),
        "-filter:v", f"select='gt(scene,{threshold})',showinfo",
        "-an", "-f", "null", "-",
    ])
    # showinfo writes to stderr; pull every pts_time we see.
    times = [float(m) for m in re.findall(r"pts_time:([0-9.]+)", cp.stderr)]
    return sorted(set(times))


def sample_frames(video: Path, out_dir: Path, interval: float) -> List[Path]:
    """One frame every `interval` seconds → out_dir/cand_%05d.jpg."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "cand_%05d.jpg")
    cp = _run([
        "ffmpeg", "-i", str(video),
        "-vf", f"fps=1/{interval}", "-q:v", "3", pattern, "-y",
    ])
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg frame sampling failed: {cp.stderr[-500:]}")
    return sorted(out_dir.glob("cand_*.jpg"))


def extract_audio(video: Path, out_wav: Path) -> Optional[Path]:
    """Mono 16 kHz WAV for later speech-to-text. None if the video has no audio."""
    cp = _run([
        "ffmpeg", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
        str(out_wav), "-y",
    ])
    return out_wav if cp.returncode == 0 and out_wav.exists() else None


# --------------------------------------------------------------------------- #
# per-frame analysis: sharpness (variance-of-Laplacian) + HSV colour signature
# --------------------------------------------------------------------------- #
def analyze_frame(path: Path, max_width: int = 320):
    """Return (sharpness, hsv_histogram) for one frame. Opens the image once."""
    try:
        with Image.open(path) as im:
            if im.width > max_width:
                h = max(1, int(im.height * max_width / im.width))
                im = im.resize((max_width, h))
            gray = np.asarray(im.convert("L"), dtype=np.float64)
            hsv = np.asarray(im.convert("HSV"))
    except Exception:
        return 0.0, None
    # sharpness
    if gray.ndim != 2 or min(gray.shape) < 3:
        sharp = 0.0
    else:
        lap = (-4.0 * gray
               + np.roll(gray, 1, 0) + np.roll(gray, -1, 0)
               + np.roll(gray, 1, 1) + np.roll(gray, -1, 1))
        sharp = float(lap[1:-1, 1:-1].var())
    # coarse hue/saturation signature (8x8), L1-normalised
    hist, _, _ = np.histogram2d(
        hsv[..., 0].ravel(), hsv[..., 1].ravel(),
        bins=[8, 8], range=[[0, 255], [0, 255]])
    hist = hist / (hist.sum() + 1e-9)
    return sharp, hist.ravel()


def _hist_dist(a, b) -> float:
    """L1 distance between two normalised histograms, range 0..2."""
    if a is None or b is None:
        return 0.0
    return float(np.abs(a - b).sum())


# --------------------------------------------------------------------------- #
# pipeline
# --------------------------------------------------------------------------- #
def segment_frames(frames: List[dict], hists: List, cuts: List[float],
                   drift: float, min_seg: float, max_seg: float) -> List[dict]:
    """Segment the sampled frames into "moments".

    A boundary is placed when ANY of these holds:
      * a hard scene cut falls between two frames, or
      * colour content has drifted past `drift` from the segment anchor
        (handles continuous walkthroughs with no hard cuts), or
      * the running segment is already `max_seg` seconds long.
    Boundaries closer than `min_seg` seconds are suppressed.
    """
    if not frames:
        return []
    seg_index, seg_start_t, anchor = 0, frames[0]["t"], hists[0]
    segments = []
    for i, f in enumerate(frames):
        t = f["t"]
        crossed_cut = any(frames[i - 1]["t"] < c <= t for c in cuts) if i else False
        drifted = _hist_dist(hists[i], anchor) > drift
        too_long = (t - seg_start_t) >= max_seg
        if i and (crossed_cut or drifted or too_long) and (t - seg_start_t) >= min_seg:
            segments.append({"index": seg_index, "start": round(seg_start_t, 3),
                             "end": round(t, 3)})
            seg_index += 1
            seg_start_t, anchor = t, hists[i]
        f["segment"] = seg_index
        # slowly adapt the anchor so gradual drift within a moment doesn't over-cut
        if hists[i] is not None and anchor is not None:
            anchor = 0.8 * anchor + 0.2 * hists[i]
    segments.append({"index": seg_index, "start": round(seg_start_t, 3),
                     "end": round(frames[-1]["t"] + 0.001, 3)})
    return segments


def process(video: Path, out_dir: Path, interval: float, scene: float,
            keyframes_per_shot: int, drift: float, min_seg: float,
            max_seg: float) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = out_dir / "frames"

    meta = probe(video)
    duration = meta["duration_s"]
    print(f"[probe] {meta['width']}x{meta['height']} @ {meta['fps']}fps, "
          f"{duration:.1f}s", file=sys.stderr)

    cuts = scene_cuts(video, scene)
    frame_paths = sample_frames(video, frames_dir, interval)

    frames, hists = [], []
    for i, p in enumerate(frame_paths):
        t = round(i * interval, 3)  # fps=1/interval → frame i at ~i*interval s
        sharp, hist = analyze_frame(p)
        frames.append({"path": str(p.relative_to(out_dir)), "t": t,
                       "sharpness": round(sharp, 2)})
        hists.append(hist)
    print(f"[frames] sampled {len(frames)} candidate frame(s) every {interval}s",
          file=sys.stderr)

    segments = segment_frames(frames, hists, cuts, drift, min_seg, max_seg)
    print(f"[shots] {len(segments)} moment(s) "
          f"({len(cuts)} hard cut(s) + content drift)", file=sys.stderr)

    # keyframes = sharpest N frames within each segment
    keyframes = []
    for s in segments:
        in_seg = [f for f in frames if f["segment"] == s["index"]]
        in_seg.sort(key=lambda f: f["sharpness"], reverse=True)
        keyframes.extend(f["t"] for f in in_seg[:keyframes_per_shot])
    keyframes = sorted(keyframes)
    for f in frames:
        f["is_keyframe"] = f["t"] in keyframes

    audio = extract_audio(video, out_dir / "audio.wav")
    print(f"[audio] {'extracted audio.wav' if audio else 'no audio track'}",
          file=sys.stderr)

    manifest = {
        "video": str(video),
        "meta": meta,
        "params": {"interval_s": interval, "scene_threshold": scene,
                   "keyframes_per_shot": keyframes_per_shot},
        "segments": segments,
        "frames": frames,
        "keyframe_times": keyframes,
        "audio": bool(audio),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"[done] {len(keyframes)} keyframe(s) → {out_dir/'manifest.json'}",
          file=sys.stderr)
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract moments/keyframes from a video.")
    ap.add_argument("video", type=Path)
    ap.add_argument("--out", type=Path, default=None,
                    help="output dir (default: <video>_intel next to the video)")
    ap.add_argument("--interval", type=float, default=2.0,
                    help="seconds between sampled candidate frames")
    ap.add_argument("--scene", type=float, default=0.30,
                    help="scene-change threshold 0..1 (lower = more shots)")
    ap.add_argument("--keyframes-per-shot", type=int, default=2)
    ap.add_argument("--drift", type=float, default=0.6,
                    help="colour-drift threshold 0..2 to start a new moment")
    ap.add_argument("--min-seg", type=float, default=8.0,
                    help="minimum seconds per moment")
    ap.add_argument("--max-seg", type=float, default=30.0,
                    help="force a new moment after this many seconds")
    args = ap.parse_args()

    if not args.video.exists():
        ap.error(f"video not found: {args.video}")
    out = args.out or args.video.with_name(args.video.stem + "_intel")
    process(args.video, out, args.interval, args.scene, args.keyframes_per_shot,
            args.drift, args.min_seg, args.max_seg)


if __name__ == "__main__":
    main()
