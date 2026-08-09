#!/usr/bin/env python3
"""splat_progress — track how a Brush splat grows during training.

Reads the intermediate ply snapshots that Brush writes (enabled via
--export-every in pipeline_run.py) and shows the gaussian count vs training
step and vs wall-clock time. Works on a finished run or live with --watch.

Vertex count is read from the ply HEADER only (fast — no full load).

    python splat_progress.py <run_id | run_dir> [--watch] [--interval 15]
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys
import time

RUNS = "/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI/studio/runs"


def vertex_count(path: str):
    try:
        with open(path, "rb") as f:
            head = f.read(4096)
        m = re.search(rb"element vertex (\d+)", head)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def snapshots(run_dir: str):
    tag = os.path.basename(run_dir.rstrip("/"))
    out = []
    for p in glob.glob(os.path.join(run_dir, f"{tag}_*.ply")):
        m = re.search(r"_(\d+)\.ply$", os.path.basename(p))
        if not m:
            continue
        out.append({"step": int(m.group(1)), "path": p,
                    "gaussians": vertex_count(p), "mtime": os.path.getmtime(p)})
    out.sort(key=lambda s: s["step"])
    return out


def show(run_dir: str):
    snaps = snapshots(run_dir)
    print(f"\n{os.path.basename(run_dir)} — {len(snaps)} snapshot(s)")
    if not snaps:
        print("  (no snapshots yet — run may be pre-first-export, or export-every"
              " was disabled)")
        return snaps
    t0 = snaps[0]["mtime"]
    print(f"  {'step':>7} {'gaussians':>11} {'Δgauss':>10} {'wall':>8}")
    print("  " + "-" * 40)
    prev = 0
    for s in snaps:
        g = s["gaussians"] or 0
        print(f"  {s['step']:>7} {g:>11,} {g-prev:>+10,} {s['mtime']-t0:>7.0f}s")
        prev = g
    return snaps


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run", help="run id (studio/runs/<id>) or a run dir")
    ap.add_argument("--watch", action="store_true", help="poll and reprint")
    ap.add_argument("--interval", type=float, default=15)
    a = ap.parse_args()
    run_dir = a.run if os.path.isdir(a.run) else os.path.join(RUNS, a.run)
    if not os.path.isdir(run_dir):
        sys.exit(f"run dir not found: {run_dir}")
    if not a.watch:
        show(run_dir)
        return
    while True:
        os.system("clear")
        show(run_dir)
        print(f"\n  watching (every {a.interval:.0f}s) — Ctrl-C to stop")
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
