#!/usr/bin/env python3
"""analytics — aggregate splat-batch runs into a comparison table + CSV.

Reads the JSONL log written by splat_batch.py (any run dir — no hardcoded paths)
and the optional semantics_analytics.json (VLM token/cost), and prints one row
per sample plus rollups so runs/methods can be compared side by side.

    python analytics.py --log <run_dir>/splat_batch_log.jsonl

Columns capture the full cost/quality picture:
  frames kept/extracted (+dropped blurry), deblur method, median sharpness,
  COLMAP registered / points / reproj-error and per-stage seconds,
  gaussian count, ply size, and wall time.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

# flat column order for the table + CSV
COLS = [
    ("name", "name", 26), ("pipeline", "pipe", 6), ("status", "status", 11),
    ("deblur", "deblur", 8), ("sharp_keep", "keep", 5),
    ("frames", "kept/ext", 9), ("n_dropped_blurry", "blur↓", 6),
    ("sharp_median", "sharpMed", 9), ("registered", "reg", 5),
    ("points3D", "pts3D", 7), ("mean_reproj_err_px", "reprojPx", 9),
    ("gaussians", "gauss", 9), ("ply_mb", "plyMB", 6),
    ("t_extract_s", "extS", 6), ("t_colmap", "colS", 7),
    ("seconds", "trainS", 7), ("t_wall_s", "wallS", 7),
]


def flatten(r: dict) -> dict:
    ext = r.get("n_extracted", r.get("n_frames"))
    kept = r.get("n_kept", r.get("n_frames"))
    ply_mb = round(r["ply_bytes"] / 1e6, 2) if r.get("ply_bytes") else None
    return {**r, "frames": f"{kept}/{ext}" if ext else kept, "ply_mb": ply_mb}


def cell(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", type=Path, required=True,
                    help="splat_batch_log.jsonl from a run")
    ap.add_argument("--csv", type=Path, default=None,
                    help="output CSV (default: <log dir>/analytics.csv)")
    args = ap.parse_args()

    rows = [flatten(json.loads(l)) for l in args.log.read_text().splitlines() if l.strip()]
    if not rows:
        print("no rows in log yet.")
        return

    # header
    print("  ".join(f"{lbl:>{w}}" for _, lbl, w in COLS))
    print("-" * (sum(w for _, _, w in COLS) + 2 * len(COLS)))
    for r in rows:
        print("  ".join(f"{cell(r.get(k)):>{w}}" for k, _, w in COLS))

    # rollups
    done = [r for r in rows if r.get("status") == "done"]
    print("-" * (sum(w for _, _, w in COLS) + 2 * len(COLS)))
    print(f"{len(done)}/{len(rows)} succeeded | "
          f"total gaussians {sum(r.get('gaussians') or 0 for r in done):,} | "
          f"total wall {sum(r.get('t_wall_s') or 0 for r in rows)/60:.1f} min | "
          f"total COLMAP {sum(r.get('t_colmap') or 0 for r in rows)/60:.1f} min | "
          f"total train {sum(r.get('seconds') or 0 for r in rows)/60:.1f} min")

    # VLM token/cost, if present next to the log
    sem = args.log.parent / "semantics_analytics.json"
    if sem.exists():
        u = json.loads(sem.read_text())
        print(f"VLM ({u.get('backend')}/{u.get('model')}): "
              f"in={u.get('input_tokens')} out={u.get('output_tokens')} tok "
              f"| ${u.get('est_cost_usd')} | {u.get('n_keyframes')} keyframes "
              f"over {u.get('n_moments')} moments")

    out_csv = args.csv or args.log.parent / "analytics.csv"
    keys = [k for k, _, _ in COLS]
    with out_csv.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in keys})
    print(f"\nwrote {out_csv}")


if __name__ == "__main__":
    main()
