#!/usr/bin/env python3
"""Generate splat_batch specs from the labeled context.json.

Produces a spread of samples so we can compare:
  * full-video reconstructions at different frame densities
  * every high-feasibility moment (per the VLM's splat_feasibility)
  * a few med-feasibility moments for contrast
  * a frame-parameter sweep (fps x steps) on the single best moment
"""
import argparse
import json
from pathlib import Path

_ap = argparse.ArgumentParser()
_ap.add_argument("--out", type=Path, required=True, help="dir containing context.json")
OUT = _ap.parse_args().out
ctx = json.loads((OUT / "context.json").read_text())
moments = sorted(ctx["moments"], key=lambda m: m["index"])

specs = []

# 1) every high-feasibility moment
highs = [m for m in moments if m.get("splat_feasibility") == "high"]
for m in highs:
    tag = "-".join(m["label"].lower().split()[:3])
    specs.append({
        "name": f"m{m['index']:02d}_{tag}", "label": f"{m['label']} ({m['start']:.0f}-{m['end']:.0f}s)",
        "start": m["start"], "end": m["end"], "fps": 4, "max_frames": 55,
        "steps": 20000, "max_res": 1280})

# 3) top-3 med-feasibility moments by salience, for contrast
meds = sorted([m for m in moments if m.get("splat_feasibility") == "med"],
              key=lambda m: -m.get("salience", 0))[:3]
for m in meds:
    tag = "-".join(m["label"].lower().split()[:3])
    specs.append({
        "name": f"m{m['index']:02d}_med_{tag}", "label": f"{m['label']} MED ({m['start']:.0f}-{m['end']:.0f}s)",
        "start": m["start"], "end": m["end"], "fps": 4, "max_frames": 55,
        "steps": 15000, "max_res": 1280})

# 4) frame-parameter sweep on the highest-salience high moment
best = max(highs, key=lambda m: m.get("salience", 0)) if highs else moments[0]
for fps, steps in [(2, 10000), (4, 20000), (6, 30000)]:
    specs.append({
        "name": f"sweep_m{best['index']:02d}_fps{fps}_{steps//1000}k",
        "label": f"sweep {best['label']} fps={fps} steps={steps}",
        "start": best["start"], "end": best["end"], "fps": fps,
        "max_frames": 90, "steps": steps, "max_res": 1280})

# N) full-video frame-density sweep LAST (heaviest COLMAP — CPU SIFT on 150-200 frames)
specs += [
    {"name": "full_1fps_150", "label": "full video @1fps", "fps": 1,
     "max_frames": 150, "steps": 20000, "max_res": 1280},
    {"name": "full_2fps_200", "label": "full video @2fps", "fps": 2,
     "max_frames": 200, "steps": 20000, "max_res": 1280},
]

(OUT / "specs.json").write_text(json.dumps(specs, indent=2))
print(f"wrote {len(specs)} specs -> {OUT/'specs.json'}")
for s in specs:
    rng = f"{s.get('start','full')}-{s.get('end','')}" if "start" in s else "FULL"
    print(f"  {s['name']:34} {rng:>12}  fps={s['fps']} maxf={s['max_frames']} steps={s['steps']}")
