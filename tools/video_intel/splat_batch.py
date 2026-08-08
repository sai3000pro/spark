#!/usr/bin/env python3
"""splat_batch — produce many Gaussian-splat samples from one video.

For each sample spec it runs the full quality path:

    ffmpeg (frames for full video OR a highlighted moment [start,end])
      -> COLMAP  feature_extractor -> sequential_matcher -> mapper -> sparse/0
      -> ComfyUI/pipeline_run.py (brush)  -> decoded result.ply + meta.json

Specs come from a JSON list (see build_specs.py) or --smoke for a single quick
validation run. Every sample is logged to a JSONL file and failures never abort
the batch — COLMAP legitimately fails on crowd/low-parallax footage and we want
to see which moments reconstruct and which don't.

    python splat_batch.py --specs specs.json
    python splat_batch.py --smoke        # one fast end-to-end check
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import List, Optional

# Machine/install paths (environment config — NOT tied to any input video).
REPO = Path("/Users/notjackl3/Programming/hunyuanworld-mirror")
COMFY = REPO / "ComfyUI"
PY = COMFY / ".venv/bin/python"                       # heavy env (torch/pycolmap)
PIPELINE = COMFY / "pipeline_run.py"
BRUSH_DATA = COMFY / "brush_data"
RUNS = COMFY / "studio/runs"
SPLAT_TOOLS = REPO / "tools/video_intel/splat_tools.py"

# Log path is set per-run from --out (never hardcoded to a specific video).
LOG: Optional[Path] = None


def sh(cmd: List[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, **kw)


def log_line(rec: dict) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(json.dumps(rec) + "\n")
    status = rec.get("status", "?")
    print(f"[{time.strftime('%H:%M:%S')}] {rec['name']:28} {status:8} "
          f"imgs={rec.get('registered','?')}/{rec.get('n_frames','?')} "
          f"gauss={rec.get('gaussians','?')} {rec.get('seconds','?')}s "
          f"{rec.get('error','')}", flush=True)


# --------------------------------------------------------------------------- #
# stages
# --------------------------------------------------------------------------- #
def extract_frames(video: str, images: Path, fps: float,
                   start: Optional[float], end: Optional[float],
                   max_frames: int) -> int:
    if images.exists():
        shutil.rmtree(images)
    images.mkdir(parents=True)
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", str(start)]
    cmd += ["-i", video]
    if start is not None and end is not None:
        cmd += ["-t", str(max(0.1, end - start))]
    cmd += ["-vf", f"fps={fps}", "-q:v", "2", str(images / "frame_%04d.jpg")]
    sh(cmd)
    files = sorted(images.glob("frame_*.jpg"))
    # uniform subsample down to max_frames
    if len(files) > max_frames:
        import numpy as np
        keep = set(np.linspace(0, len(files) - 1, max_frames).astype(int).tolist())
        for i, f in enumerate(files):
            if i not in keep:
                f.unlink()
        files = sorted(images.glob("frame_*.jpg"))
    return len(files)


def _lap_var(path: Path) -> float:
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
    lap = (-4 * g + np.roll(g, 1, 0) + np.roll(g, -1, 0)
           + np.roll(g, 1, 1) + np.roll(g, -1, 1))
    return float(lap[1:-1, 1:-1].var())


def refine_frames(images: Path, sharp_keep: float, deblur: Optional[str]) -> dict:
    """Optional frame-quality refinement — fully general, no per-video constants.

    deblur    : preprocessing method name ('unsharp' | None). Pluggable; a learned
                deblur model can be added as another method without touching callers.
    sharp_keep: fraction of frames to KEEP, by RELATIVE rank. The cutoff is the
                (1-sharp_keep) quantile of THIS video's own variance-of-Laplacian
                distribution — so it adapts to any scene/resolution/lighting rather
                than using an absolute sharpness threshold tuned to one clip.
    """
    from PIL import Image, ImageFilter
    import numpy as np
    files = sorted(images.glob("frame_*.jpg"))
    info = {"n_extracted": len(files), "deblur": deblur or "none",
            "sharp_keep": sharp_keep, "n_dropped_blurry": 0}
    if deblur == "unsharp":
        for f in files:
            try:
                with Image.open(f) as im:
                    im = im.convert("RGB").filter(
                        ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2))
                im.save(f, quality=95)
            except Exception:
                pass
    if sharp_keep < 1.0 and len(files) > 4:
        scored = [(_lap_var(f), f) for f in files]
        thr = float(np.quantile([s for s, _ in scored], 1.0 - sharp_keep))
        dropped = 0
        for s, f in scored:
            if s < thr:
                f.unlink()
                dropped += 1
        # never strip so hard that COLMAP loses temporal continuity
        info["n_dropped_blurry"] = dropped
    info["n_kept"] = len(list(images.glob("frame_*.jpg")))
    return info


def run_colmap(dataset: Path, mask_dir: Optional[Path] = None) -> tuple[bool, dict]:
    """feature_extractor -> sequential_matcher -> mapper.

    mask_dir: optional COLMAP mask folder (e.g. sky masks) — regions with value 0
    are ignored during feature extraction, so masked pixels create no 3D points.

    Returns (ok, stats) where stats has per-stage timings and SfM quality:
      registered, points3D, mean_reproj_err_px,
      t_feature_s, t_match_s, t_mapper_s
    """
    import re
    images = dataset / "images"
    db = dataset / "database.db"
    sparse = dataset / "sparse"
    if db.exists():
        db.unlink()
    if sparse.exists():
        shutil.rmtree(sparse)
    sparse.mkdir(parents=True)
    stats: dict = {"registered": 0, "points3D": 0, "mean_reproj_err_px": None,
                   "t_feature_s": None, "t_match_s": None, "t_mapper_s": None}

    t = time.time()
    fe = sh(["colmap", "feature_extractor", "--database_path", db,
             "--image_path", images,
             "--ImageReader.single_camera", "1",
             "--ImageReader.camera_model", "SIMPLE_RADIAL",
             *(["--ImageReader.mask_path", str(mask_dir)] if mask_dir else [])])
    stats["t_feature_s"] = round(time.time() - t, 1)
    if fe.returncode != 0:
        return False, stats
    t = time.time()
    sm = sh(["colmap", "sequential_matcher", "--database_path", db,
             "--SequentialMatching.overlap", "10"])
    stats["t_match_s"] = round(time.time() - t, 1)
    if sm.returncode != 0:
        return False, stats
    t = time.time()
    mp = sh(["colmap", "mapper", "--database_path", db,
             "--image_path", images, "--output_path", sparse])
    stats["t_mapper_s"] = round(time.time() - t, 1)
    if mp.returncode != 0:
        return False, stats

    # pick the model subdir with the most registered images (largest images.bin)
    models = [d for d in sparse.iterdir() if d.is_dir() and (d / "images.bin").exists()]
    if not models:
        return False, stats
    best = max(models, key=lambda d: (d / "images.bin").stat().st_size)
    zero = sparse / "0"
    if best.name != "0":
        if zero.exists():
            shutil.rmtree(zero)
        best.rename(zero)
    # SfM quality via model_analyzer (glog prefixes a timestamp, so match the
    # number that immediately follows each phrase, not all digits on the line)
    ma = sh(["colmap", "model_analyzer", "--path", zero])
    txt = ma.stdout + ma.stderr
    m = re.search(r"Registered images:\s*(\d+)", txt) or re.search(r"\bImages:\s*(\d+)", txt)
    if m:
        stats["registered"] = int(m.group(1))
    m = re.search(r"Points:\s*(\d+)", txt)
    if m:
        stats["points3D"] = int(m.group(1))
    m = re.search(r"Mean reprojection error:\s*([0-9.]+)", txt)
    if m:
        stats["mean_reproj_err_px"] = float(m.group(1))
    return True, stats


def spec_tags(name: str, spec: dict) -> list:
    """Technique tags for a run (pipeline + preprocessing + source group) so the
    frontend can offer clickable filters. General — derived from the spec."""
    t = [spec.get("pipeline", "brush")]
    if spec.get("deblur"):
        t.append("deblur")
    if spec.get("sharp_keep", 1.0) < 1.0:
        t.append("sharp-gate")
    if spec.get("opac_loss"):
        t.append("opac-reg")
    if spec.get("mask_sky"):
        t.append("sky-mask")
    if len(t) == 1 and t[0] == "brush":
        t.append("base")
    grp = ("good-case" if name.startswith("cmp_good") else
           "hard-case" if name.startswith("cmp_hard") else
           "sweep" if name.startswith("sweep") else
           "full-video" if name.startswith("full") else
           "moment" if (name[:1] == "m" and name[1:3].isdigit()) else None)
    if grp:
        t.append(grp)
    return sorted(set(t))


def run_pipeline(spec: dict, dataset: Path) -> dict:
    """Dispatch to one of pipeline_run.py's pipelines (brush | hybrid | feedforward).

    brush       : optimize a splat from COLMAP cameras + sparse points.
    hybrid      : COLMAP cameras + a DENSE learned pointmap (HunyuanWorld) as init
                  — the built-in "fill sparse geometry" path.
    feedforward : generate a splat directly from frames (no COLMAP) — the built-in
                  generative path.
    """
    pipeline = spec.get("pipeline", "brush")
    cfg = {"id": spec["name"], "pipeline": pipeline,
           "label": spec.get("label", spec["name"]),
           "tags": spec_tags(spec["name"], spec)}
    if pipeline == "feedforward":
        cfg.update(video=str(dataset / "images"),
                   frames=int(spec.get("frames", 24)), size=int(spec.get("size", 518)))
    else:  # brush + hybrid both consume the COLMAP dataset
        cfg.update(colmap_dataset=str(dataset),
                   steps=int(spec.get("steps", 15000)),
                   max_res=int(spec.get("max_res", 1280)),
                   max_splats=int(spec.get("max_splats", 2_000_000)),
                   growth_fraction=float(spec.get("growth_fraction", 0.1)))
        if spec.get("opac_loss"):   # opacity regularization -> fewer floaters
            cfg["opac_loss"] = float(spec["opac_loss"])
        if pipeline == "hybrid":
            cfg.update(frames=int(spec.get("frames", 24)),
                       size=int(spec.get("size", 518)),
                       init_points=int(spec.get("init_points", 150000)))
    cfg_path = dataset / "pipeline_cfg.json"
    cfg_path.write_text(json.dumps(cfg))
    env = {**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE", "OMP_NUM_THREADS": "8"}
    sh([PY, PIPELINE, cfg_path], cwd=COMFY, env=env)
    meta_path = RUNS / spec["name"] / "meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    return {"status": "error", "error": "no meta.json produced"}


def sharpness_stats(images: Path) -> dict:
    """Variance-of-Laplacian distribution across the extracted frames."""
    import numpy as np
    from PIL import Image
    vals = []
    for p in sorted(images.glob("frame_*.jpg")):
        try:
            with Image.open(p) as im:
                im = im.convert("L")
                if im.width > 320:
                    im = im.resize((320, max(1, int(im.height * 320 / im.width))))
                g = np.asarray(im, dtype=np.float64)
            lap = (-4 * g + np.roll(g, 1, 0) + np.roll(g, -1, 0)
                   + np.roll(g, 1, 1) + np.roll(g, -1, 1))
            vals.append(float(lap[1:-1, 1:-1].var()))
        except Exception:
            pass
    if not vals:
        return {}
    a = np.array(vals)
    return {"sharp_mean": round(float(a.mean()), 1),
            "sharp_median": round(float(np.median(a)), 1),
            "sharp_min": round(float(a.min()), 1),
            "sharp_max": round(float(a.max()), 1)}


def quality_and_prune(result_ply: str):
    """SELF-CHECK a finished splat by quality metrics + write a pruned copy.

    Runs via the plyfile env (PY). Returns (metrics_dict, clean_ply_path). Judge
    splats by opacity/extent here, never by gaussian count alone.
    """
    q = {}
    r = sh([PY, SPLAT_TOOLS, "inspect", "--json", result_ply])
    if r.returncode == 0 and r.stdout.strip():
        try:
            q = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception:
            pass
    clean = str(Path(result_ply).with_name("result_clean.ply"))
    sh([PY, SPLAT_TOOLS, "prune", result_ply, "--out", clean,
        "--opacity-keep", "0.5", "--radius-pct", "99"])
    return q, (clean if os.path.exists(clean) else None)


def process(spec: dict, video: str) -> dict:
    name = spec["name"]
    pipeline = spec.get("pipeline", "brush")
    rec = {"name": name, "pipeline": pipeline, "spec": spec, "t_start": time.time()}
    dataset = BRUSH_DATA / name
    try:
        t0 = time.time()
        n = extract_frames(video, dataset / "images", spec.get("fps", 2.0),
                           spec.get("start"), spec.get("end"),
                           int(spec.get("max_frames", 80)))
        rec["t_extract_s"] = round(time.time() - t0, 1)

        # optional frame-quality refinement (relative gate + deblur) — general
        rec.update(refine_frames(dataset / "images",
                                 float(spec.get("sharp_keep", 1.0)),
                                 spec.get("deblur")))
        n = rec.get("n_kept", n)
        rec["n_frames"] = n
        rec.update(sharpness_stats(dataset / "images"))
        if n < 8:
            rec.update(status="error", error=f"too few frames ({n})")
            log_line(rec)
            return rec

        # optional sky masking so COLMAP ignores the unbounded sky (fewer floaters)
        mask_dir = None
        if spec.get("mask_sky"):
            import sky_mask
            mask_dir = dataset / "masks"
            rec["sky"] = sky_mask.write_colmap_masks(dataset / "images", mask_dir)

        # feedforward is generative (no camera solve); brush/hybrid need COLMAP
        if pipeline != "feedforward":
            t0 = time.time()
            ok, cstats = run_colmap(dataset, mask_dir)
            rec.update(cstats)
            rec["registered"] = cstats["registered"]
            rec["t_colmap"] = round(time.time() - t0, 1)
            if not ok or cstats["registered"] < 6:
                rec.update(status="colmap_fail",
                           error=f"colmap registered {cstats['registered']} imgs")
                log_line(rec)
                return rec

        meta = run_pipeline(spec, dataset)
        rec["status"] = meta.get("status", "?")
        rec["gaussians"] = meta.get("gaussians")
        rec["seconds"] = meta.get("seconds")
        rec["result_ply"] = meta.get("result_ply")
        if meta.get("result_ply") and os.path.exists(meta["result_ply"]):
            rec["ply_bytes"] = os.path.getsize(meta["result_ply"])
            # SELF-CHECK: quality metrics (not just gaussian count) + auto-prune
            rec["quality"], rec["clean_ply"] = quality_and_prune(meta["result_ply"])
        rec["error"] = meta.get("error", "")
        rec["t_wall_s"] = round(time.time() - rec["t_start"], 1)
    except Exception as e:  # noqa: BLE001
        rec.update(status="exception", error=repr(e))
    log_line(rec)
    return rec


# Generic smoke spec: first 10s of whatever video is passed. No scene assumptions.
SMOKE = [{"name": "smoke", "label": "smoke: first 10s", "start": 0, "end": 10,
          "fps": 3, "max_frames": 30, "steps": 1500, "max_res": 720}]


def main() -> None:
    global LOG
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=Path, required=True, help="source video")
    ap.add_argument("--out", type=Path, required=True,
                    help="run dir for the log + analytics (never hardcoded)")
    ap.add_argument("--specs", type=Path, help="JSON list of sample specs")
    ap.add_argument("--smoke", action="store_true", help="one fast validation run")
    args = ap.parse_args()

    if not args.video.exists():
        ap.error(f"video not found: {args.video}")
    args.out.mkdir(parents=True, exist_ok=True)
    LOG = args.out / "splat_batch_log.jsonl"
    specs = SMOKE if args.smoke else json.loads(args.specs.read_text())
    print(f"=== splat_batch: {len(specs)} sample(s) → log {LOG} ===", flush=True)
    summary = []
    for i, spec in enumerate(specs, 1):
        print(f"\n--- [{i}/{len(specs)}] {spec['name']} ---", flush=True)
        summary.append(process(spec, args.video))
    ok = [r for r in summary if r.get("status") == "done"]
    print(f"\n=== batch complete: {len(ok)}/{len(summary)} produced splats ===",
          flush=True)
    for r in summary:
        print(f"  {r['name']:28} {r.get('status'):10} "
              f"gauss={r.get('gaussians','-')}")


if __name__ == "__main__":
    main()
