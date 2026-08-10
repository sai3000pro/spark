#!/usr/bin/env python3
"""object_quality — post-training gate for the object catalog.

The catalog (object_catalog.py) scores each object by DETECTION confidence: how
sure the 2D detector was that some pixels are a "bowl". That says nothing about
whether the SPLAT actually reconstructs that spot. A bowl detected in the source
photo of the far-back of the room is a real bowl — but we never got a camera close
to it, so flying there in the viewer lands in blurry smoke.

This step answers the other question: "if the camera flies to this centroid, is
there a clean, well-observed object there?" It runs AFTER Brush finishes (it needs
the final .ply) and reuses the same COLMAP dataset the catalog was built from. It
augments objects.json in place (keeps a .bak) with per-object quality fields and a
scene-relative `low_quality` flag the viewer uses to hide/deprioritize junk.

Signals (all cheap — a few dozen centroids, radius queries):
  cam_dist_m    distance to the NEAREST training camera        (far-back  -> big)
  n_seen        cameras that actually have the centroid in-frustum
  parallax_deg  angular spread of those views                  (soft/thin -> small)
  pts_near      COLMAP SfM points within the object radius      (blurry    -> sparse)
  g_near        splats within the radius
  g_opacity     mean splat opacity there                        (smoke     -> low)
  g_scale_rel   mean splat size there / object radius           (floaters  -> huge)

Thresholds are RELATIVE to this scene's own distribution (median / MAD), never
hardcoded to one clip — a scene where everything is far still won't nuke every
object, and a clean scene flags nothing.

  ComfyUI/.venv/bin/python tools/video_intel/object_quality.py <run_dir> \
      [--dataset DS] [--ply PLY] [--radius-scale 0.6] [--cutoff 0.45]

<run_dir> is a studio run dir (has objects.json + meta.json). --dataset / --ply are
auto-discovered from objects.json meta + the run dir if omitted.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil

import numpy as np

import object_catalog as oc   # same dir: reuse the COLMAP readers


# ----------------------------------------------------------------------------- helpers
def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def clamp01(x):
    return float(max(0.0, min(1.0, x)))


def cam_centers(imgs):
    """World-space camera centers  C = -R^T t  (R is world->camera)."""
    return np.array([-im["R"].T @ im["t"] for im in imgs])


def find_final_ply(run_dir):
    """Prefer a *_LATEST symlink, else the highest-iter Brush export, else result.ply."""
    latest = glob.glob(os.path.join(run_dir, "*_LATEST.ply"))
    if latest:
        return os.path.realpath(latest[0])
    iters = []
    for p in glob.glob(os.path.join(run_dir, "*.ply")):
        m = os.path.basename(p)
        digits = "".join(c for c in m if c.isdigit())
        if digits:
            iters.append((int(digits), p))
    if iters:
        return max(iters)[1]
    for name in ("result.ply", "current.ply"):
        p = os.path.join(run_dir, name)
        if os.path.exists(p):
            return p
    return None


def load_gaussians(ply_path):
    """Return (xyz Nx3, opacity N [0..1], scale N [linear metric mean of the 3 axes])."""
    from plyfile import PlyData
    v = PlyData.read(ply_path)["vertex"]
    xyz = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float64)
    opacity = sigmoid(np.asarray(v["opacity"], dtype=np.float64))     # logit -> [0,1]
    sc = np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], axis=1).astype(np.float64)
    scale = np.exp(sc).mean(axis=1)                                   # log -> linear, mean axis
    return xyz, opacity, scale


# ----------------------------------------------------------------------------- per-object metrics
def raw_metrics(obj, centers, imgs, cams, pts, tree_pts, g_xyz, g_op, g_sc, tree_g,
                radius_scale):
    c = np.asarray(obj["centroid"], dtype=np.float64)
    ext = np.asarray(obj.get("extent", [0.3, 0.3, 0.3]), dtype=np.float64)
    r = float(np.clip(radius_scale * float(ext.max()), 0.12, 0.6))

    # --- camera geometry ---
    d = np.linalg.norm(centers - c, axis=1)
    cam_dist = float(d.min())

    seen_dirs = []
    for im in imgs:
        cam = cams.get(im["cam_id"]) or next(iter(cams.values()))
        xc = im["R"] @ c + im["t"]
        z = xc[2]
        if z <= 0.05:
            continue
        px = cam["fx"] * xc[0] / z + cam["cx"]
        py = cam["fy"] * xc[1] / z + cam["cy"]
        if 0 <= px <= cam["w"] and 0 <= py <= cam["h"]:
            C = -im["R"].T @ im["t"]
            ray = c - C
            n = np.linalg.norm(ray)
            if n > 1e-6:
                seen_dirs.append(ray / n)
    n_seen = len(seen_dirs)
    if n_seen >= 2:
        D = np.array(seen_dirs)
        dots = np.clip(D @ D.T, -1.0, 1.0)
        parallax_deg = float(np.degrees(np.arccos(dots.min())))
    else:
        parallax_deg = 0.0

    # --- SfM point support ---
    pts_near = int(len(tree_pts.query_ball_point(c, r))) if tree_pts is not None else 0

    # --- gaussian support ---
    idx = tree_g.query_ball_point(c, r)
    g_near = len(idx)
    if g_near:
        g_opacity = float(g_op[idx].mean())
        g_scale_rel = float(g_sc[idx].mean() / r)
    else:
        g_opacity = 0.0
        g_scale_rel = 9.9                                            # nothing here == "all floater"

    return dict(radius_m=round(r, 3), cam_dist_m=round(cam_dist, 3), n_seen=n_seen,
                parallax_deg=round(parallax_deg, 1), pts_near=pts_near, g_near=g_near,
                g_opacity=round(g_opacity, 3), g_scale_rel=round(g_scale_rel, 3))


# ----------------------------------------------------------------------------- scoring
def score_all(objs, metrics, cutoff):
    """Turn raw metrics into scene-relative sub-scores and a composite quality.

    Each sub-score is 1.0 for a 'typical or better' object in THIS scene and decays
    toward 0 for the scene's outliers, so nothing is tuned to a specific clip.
    """
    m = metrics
    med = lambda key, floor: max(floor, float(np.median([x[key] for x in m])))

    s_dist = med("cam_dist_m", 0.5)          # typical nearest-view distance
    s_seen = med("n_seen", 4.0)
    s_pts = med("pts_near", 8.0)
    s_op = med("g_opacity", 0.15)
    s_scale = med("g_scale_rel", 0.15)

    WEIGHTS = dict(proximity=0.26, coverage=0.14, parallax=0.10,
                   support=0.20, opacity=0.20, tightness=0.10)

    # under-observed: too few cameras ever looked at this spot -> it CANNOT render
    # clear no matter what else scores. Scene-relative (a fraction of the median
    # coverage) with an absolute floor, so a clean scene flags nothing.
    under_thresh = max(6.0, 0.12 * s_seen)

    scored = []
    for o, x in zip(objs, m):
        sub = dict(
            # far outside the typical nearest-view distance -> falls off past 2x median
            proximity=clamp01((2 * s_dist - x["cam_dist_m"]) / (2 * s_dist)),
            coverage=clamp01(x["n_seen"] / (0.5 * s_seen)),
            parallax=clamp01(x["parallax_deg"] / 20.0),
            support=clamp01(x["pts_near"] / (0.4 * s_pts)),
            opacity=clamp01(x["g_opacity"] / (0.6 * s_op)),
            tightness=clamp01((2 * s_scale - x["g_scale_rel"]) / (2 * s_scale)),
        )
        q = sum(WEIGHTS[k] * sub[k] for k in WEIGHTS)
        # hard fails, each sufficient on its own:
        #  empty  centroid sits in genuinely empty space. Judge by SPLATS (what you
        #         fly to), not the sparse/subsampled SfM cloud — a well-seen table
        #         object can have ~0 SfM points at a small radius yet be solid.
        #  under  too few cameras saw it -> guaranteed blurry fly-to.
        empty = x["g_near"] < 5
        under = x["n_seen"] < under_thresh
        reason = "empty" if empty else "under" if under else ("weak" if q < cutoff else "")
        low = bool(reason)
        scored.append((o, x, sub, round(float(q), 3), low, reason))
    return scored


# ----------------------------------------------------------------------------- main
def run(run_dir, dataset, ply, radius_scale, cutoff, write):
    obj_path = os.path.join(run_dir, "objects.json")
    doc = json.load(open(obj_path))
    objs = [o for o in doc.get("objects", []) if o.get("centroid")]
    if not objs:
        print("[quality] no objects with centroids — nothing to do")
        return

    dataset = dataset or doc.get("meta", {}).get("dataset")
    if not dataset or not os.path.isdir(dataset):
        raise SystemExit(f"[quality] COLMAP dataset not found: {dataset!r} (pass --dataset)")
    ply = ply or find_final_ply(run_dir)
    if not ply or not os.path.exists(ply):
        raise SystemExit(f"[quality] final .ply not found in {run_dir} (pass --ply)")

    sparse = os.path.join(dataset, "sparse", "0")
    cams = oc.read_cameras(os.path.join(sparse, "cameras.txt"))
    imgs = oc.read_images(os.path.join(sparse, "images.txt"))
    pts = oc.read_points3D(os.path.join(sparse, "points3D.txt"))
    centers = cam_centers(imgs)
    print(f"[quality] {len(objs)} objects | {len(imgs)} cams | {len(pts):,} pts | ply={os.path.basename(ply)}")

    from scipy.spatial import cKDTree
    tree_pts = cKDTree(pts) if len(pts) else None
    g_xyz, g_op, g_sc = load_gaussians(ply)
    print(f"[quality] {len(g_xyz):,} splats loaded — building KD-tree")
    tree_g = cKDTree(g_xyz)

    metrics = [raw_metrics(o, centers, imgs, cams, pts, tree_pts, g_xyz, g_op, g_sc,
                           tree_g, radius_scale) for o in objs]
    scored = score_all(objs, metrics, cutoff)

    # report, worst first
    print(f"\n[quality] cutoff={cutoff}  (LOW = hidden in viewer)\n")
    print(f"  {'label':13} {'Q':>5} {'flag':>7} | {'camd':>5} {'seen':>4} "
          f"{'plx':>4} {'pts':>5} {'op':>5} {'scl':>5}")
    for o, x, sub, q, low, reason in sorted(scored, key=lambda s: s[3]):
        flag = ("LOW:" + reason) if low else "ok"
        print(f"  {o['label'][:13]:13} {q:5.2f} {flag:>7} | {x['cam_dist_m']:5.2f} "
              f"{x['n_seen']:4d} {x['parallax_deg']:4.0f} {x['pts_near']:5d} "
              f"{x['g_opacity']:5.2f} {x['g_scale_rel']:5.2f}")
    n_low = sum(1 for s in scored if s[4])
    print(f"\n[quality] {n_low}/{len(objs)} flagged low_quality "
          f"({len(objs)-n_low} kept)")

    # write back
    for o, x, sub, q, low, reason in scored:
        o["quality"] = q
        o["low_quality"] = low
        o["low_reason"] = reason
        o["quality_metrics"] = x
    doc.setdefault("meta", {})["quality"] = dict(
        ply=os.path.basename(ply), radius_scale=radius_scale, cutoff=cutoff,
        flagged=n_low, weights="proximity/coverage/parallax/support/opacity/tightness")

    if write:
        if not os.path.exists(obj_path + ".bak"):
            shutil.copy2(obj_path, obj_path + ".bak")
        json.dump(doc, open(obj_path, "w"), indent=2)
        print(f"[quality] wrote {obj_path} (backup at objects.json.bak)")
    else:
        print("[quality] --dry-run: not writing")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", help="studio run dir (has objects.json)")
    ap.add_argument("--dataset", help="COLMAP dataset dir (default: from objects.json meta)")
    ap.add_argument("--ply", help="final splat .ply (default: newest export in run_dir)")
    ap.add_argument("--radius-scale", type=float, default=0.6,
                    help="object query radius = clamp(this * max_extent, 0.12, 0.6) m")
    ap.add_argument("--cutoff", type=float, default=0.45,
                    help="composite quality below this -> low_quality")
    ap.add_argument("--dry-run", action="store_true", help="report only, don't write")
    a = ap.parse_args()
    run(a.run_dir, a.dataset, a.ply, a.radius_scale, a.cutoff, write=not a.dry_run)


if __name__ == "__main__":
    main()
