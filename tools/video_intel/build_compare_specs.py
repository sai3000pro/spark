#!/usr/bin/env python3
"""Generate a controlled method-comparison batch from any context.json.

Picks representative moments from the labeled context (the highest-salience
high-feasibility moment as the "good" case, and the lowest-feasibility moment as
the "hard" case) and emits one spec per METHOD with everything else held fixed —
so differences in the results are attributable to the method, not the clip.

Methods compared (all general, no per-video tuning):
  base          plain Brush, all frames
  sharp         relative sharpness gate (keep sharpest 70%)
  deblur        unsharp deblur preprocessing
  sharp_deblur  gate + deblur
  hybrid        COLMAP cameras + dense learned-pointmap init
  ffwd          feedforward generative (no COLMAP)

    python build_compare_specs.py --ctx <dir>/context.json --out <dir>
"""
import argparse
import json
from pathlib import Path

FEAS_RANK = {"high": 2, "med": 1, "low": 0}
METHODS = [
    ("base", {}),
    ("sharp", {"sharp_keep": 0.7}),
    ("deblur", {"deblur": "unsharp"}),                 # ✅ validated small win
    ("hybrid", {"pipeline": "hybrid"}),                # ✅ best for scale stability
    ("ffwd", {"pipeline": "feedforward"}),             # generative, no COLMAP
]
# opac_loss removed: Brush's --opac-loss-weight collapses the splat at every
# tested value (0.001-0.1). Floater reduction comes from post-hoc prune instead.
# NOTE: every run is auto-pruned (result_clean.ply) + quality-checked by
# splat_batch, so each method also yields a cleaned splat for comparison.


def variants_for(moment: dict, tag: str) -> list:
    # lighter params than the baseline: we are comparing METHODS, not chasing
    # absolute quality, so keep each run fast enough for a full 2-moment sweep.
    base = {"start": moment["start"], "end": moment["end"], "fps": 4,
            "max_frames": 48, "steps": 10000, "max_res": 1024}
    out = []
    for mname, override in METHODS:
        out.append({"name": f"cmp_{tag}_{mname}",
                    "label": f"{tag} [{mname}] {moment['label']}",
                    **base, **override})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ctx", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--good-index", type=int, default=None,
                    help="override the good-case moment (else highest feasibility)")
    ap.add_argument("--hard-index", type=int, default=None,
                    help="override the hard-case moment (else lowest feasibility)")
    args = ap.parse_args()

    moments = json.loads(args.ctx.read_text())["moments"]
    by_idx = {m["index"]: m for m in moments}
    good = (by_idx[args.good_index] if args.good_index is not None else
            max(moments, key=lambda m: (FEAS_RANK.get(m.get("splat_feasibility"), 0),
                                        m.get("salience", 0))))
    hard = (by_idx[args.hard_index] if args.hard_index is not None else
            min(moments, key=lambda m: (FEAS_RANK.get(m.get("splat_feasibility"), 0),
                                        -m.get("salience", 0))))
    specs = variants_for(good, "good") + variants_for(hard, "hard")
    (args.out / "compare_specs.json").write_text(json.dumps(specs, indent=2))
    print(f"wrote {len(specs)} comparison specs -> {args.out/'compare_specs.json'}")
    print(f"  good case: #{good['index']} {good['label']} "
          f"({good['splat_feasibility']}, sal={good.get('salience')})")
    print(f"  hard case: #{hard['index']} {hard['label']} "
          f"({hard['splat_feasibility']}, sal={hard.get('salience')})")
    for s in specs:
        print(f"    {s['name']}")


if __name__ == "__main__":
    main()
