#!/usr/bin/env python3
"""splat_tools — inspect and prune Gaussian-splat plys (general, any splat).

Two subcommands:

  inspect PLY...        Print quality metrics that actually matter — median
                        opacity, fraction of near-invisible floaters, scene
                        extent, and how concentrated the visible mass is. Use
                        this to judge a splat instead of trusting gaussian count.

  prune PLY --out OUT   Remove the floater haze with RELATIVE thresholds (no
                        absolute constants): keep the top `--opacity-keep`
                        fraction by opacity and drop points past the
                        `--radius-pct` percentile from the median center. Writes
                        a cleaned ply preserving all gaussian fields.

Run with the env that has plyfile (ComfyUI/.venv/bin/python).
"""
from __future__ import annotations

import argparse
import numpy as np
from plyfile import PlyData, PlyElement


def _load(ply):
    v = PlyData.read(ply)["vertex"]
    xyz = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64)
    op = np.asarray(v["opacity"]).astype(np.float64) if "opacity" in v.data.dtype.names else None
    return v, xyz, op


def inspect(ply) -> dict:
    v, xyz, op = _load(ply)
    c = np.median(xyz, 0)
    r = np.linalg.norm(xyz - c, axis=1)
    bbox = (xyz.max(0) - xyz.min(0))
    m = {"ply": ply, "n": len(xyz), "bbox": bbox.round(1).tolist(),
         "r50": round(float(np.percentile(r, 50)), 1),
         "r99": round(float(np.percentile(r, 99)), 1)}
    if op is not None:
        m["opacity_median"] = round(float(np.median(op)), 3)
        m["frac_floaters_op<0.1"] = round(float((op < 0.1).mean()), 3)
        # how much visible (opacity) mass sits inside the compact core
        r80 = np.percentile(r, 80)
        m["mass_in_r80"] = round(float(op[r <= r80].sum() / op.sum()), 3)
    return m


def _scales(v):
    """exp(log-scale) per axis, or None if the ply has no scale fields."""
    names = v.data.dtype.names
    cols = [n for n in ("scale_0", "scale_1", "scale_2") if n in names]
    if len(cols) < 3:
        return None
    return np.exp(np.stack([np.asarray(v[c]).astype(np.float64) for c in cols], 1))


def _score(v, op, mode):
    """Per-gaussian keep-score. 'opacity' = raw logit-opacity (legacy). 'contribution'
    = how many pixels it can actually paint ~ alpha * projected area, so tiny opaque
    specks AND big faint floaters both rank low — a cleaner cut than opacity alone."""
    if mode == "opacity" or op is None:
        return op
    alpha = 1.0 / (1.0 + np.exp(-op))                 # logit -> [0,1]
    s = _scales(v)
    if s is None:
        return alpha
    top2 = np.sort(s, axis=1)[:, 1:]                  # two largest axes = face-on area
    return alpha * top2.prod(axis=1)


def _round_aniso(v, keep, max_ratio):
    """Raise each kept gaussian's smallest axis so max/min <= max_ratio. Flat disks
    vanish edge-on (the #1 'looks bad from some angles' cause); rounding them keeps
    the surface visible from oblique views at ZERO runtime cost. Edits scale_* in place."""
    cols = [c for c in ("scale_0", "scale_1", "scale_2") if c in v.data.dtype.names]
    if len(cols) < 3 or max_ratio <= 0:
        return 0
    logs = np.stack([np.asarray(v[c]).astype(np.float64) for c in cols], 1)
    smax = logs.max(1, keepdims=True)
    floor = smax - np.log(max_ratio)                  # log-space min allowed
    new = np.maximum(logs, floor)
    changed = int(((new != logs).any(1) & keep).sum())
    new = np.where(keep[:, None], new, logs)          # only touch kept gaussians
    for i, c in enumerate(cols):
        v.data[c] = new[:, i].astype(v.data[c].dtype)
    return changed


def prune(ply, out, opacity_keep, radius_pct, mode="opacity", round_aniso=0.0) -> dict:
    v, xyz, op = _load(ply)
    keep = np.ones(len(xyz), bool)
    score = _score(v, op, mode)
    if score is not None and opacity_keep < 1.0:
        thr = np.quantile(score, 1.0 - opacity_keep)  # relative score cutoff
        keep &= score >= thr
    c = np.median(xyz, 0)
    r = np.linalg.norm(xyz - c, axis=1)
    keep &= r <= np.percentile(r, radius_pct)        # relative outlier cutoff
    rounded = _round_aniso(v, keep, round_aniso) if round_aniso else 0
    data = v.data[keep]
    PlyData([PlyElement.describe(data, "vertex")], text=False).write(out)
    return {"in": len(xyz), "out": int(keep.sum()),
            "kept_pct": round(float(keep.mean()) * 100, 1),
            "mode": mode, "rounded": rounded, "out_ply": out}


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    pi = sub.add_parser("inspect"); pi.add_argument("ply", nargs="+")
    pi.add_argument("--json", action="store_true", help="emit metrics as JSON")
    pp = sub.add_parser("prune")
    pp.add_argument("ply"); pp.add_argument("--out", required=True)
    pp.add_argument("--opacity-keep", type=float, default=0.5,
                    help="fraction of gaussians to keep by opacity rank (relative)")
    pp.add_argument("--radius-pct", type=float, default=99.0,
                    help="drop points beyond this percentile distance (relative)")
    pp.add_argument("--mode", choices=["opacity", "contribution"], default="opacity",
                    help="scoring for --opacity-keep: raw opacity (legacy) or alpha*area")
    pp.add_argument("--round-aniso", type=float, default=0.0,
                    help="cap max/min axis ratio (e.g. 8) so flat disks stay visible off-angle; 0=off")
    a = ap.parse_args()
    if a.cmd == "inspect":
        if a.json:
            import json as _j
            print(_j.dumps(inspect(a.ply[0])))
            return
        for p in a.ply:
            m = inspect(p)
            print(f"{m['ply'].split('/')[-2] if '/' in m['ply'] else m['ply']:26} "
                  f"N={m['n']:>7} op_med={m.get('opacity_median','-'):<5} "
                  f"floaters={m.get('frac_floaters_op<0.1','-')} "
                  f"mass_in_r80={m.get('mass_in_r80','-')} bbox={m['bbox']}")
    else:
        r = prune(a.ply, a.out, a.opacity_keep, a.radius_pct,
                  mode=a.mode, round_aniso=a.round_aniso)
        print(f"pruned {r['in']} -> {r['out']} ({r['kept_pct']}%) "
              f"[mode={r['mode']}, rounded={r['rounded']:,}] -> {r['out_ply']}")


if __name__ == "__main__":
    main()
