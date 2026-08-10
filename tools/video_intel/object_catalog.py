#!/usr/bin/env python3
"""object_catalog — locate objects in 3D inside a Gaussian-splat scene.

The splat itself has no notion of "objects" — but the COLMAP dataset it was
trained from does have everything we need to put objects on the map:

  * per-frame camera pose + intrinsics  (sparse/0/{images,cameras}.txt)
  * a metric 3D point cloud             (sparse/0/points3D.txt)

So we: (1) run an OPEN-VOCABULARY 2D detector on the registered frames, (2) lift
each 2D box to a 3D anchor by projecting the point cloud into the box and taking
the near-surface median (same world frame as the .ply — no alignment needed),
(3) cluster the per-frame anchors so one real object seen in N frames becomes one
instance with a confidence and a multi-view count. Output: objects.json, a
catalog the viewer can list and fly to.

Static objects localize well; MOVING things (people) are intentionally skippable
(--skip person ...) because their per-frame anchors don't agree — handle those
with a single-frame billboard instead.

    python tools/video_intel/object_catalog.py <colmap_dataset> --out objects.json \
        --labels "laptop,chair,banana,backpack,bottle,table" --skip person

Run with ComfyUI/.venv/bin/python (has torch/transformers/plyfile/sklearn).
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np


# ----------------------------------------------------------------------------- COLMAP IO
def read_cameras(path):
    cams = {}
    for ln in open(path):
        if ln.startswith("#") or not ln.strip():
            continue
        t = ln.split()
        cid, model, w, h = int(t[0]), t[1], int(t[2]), int(t[3])
        p = list(map(float, t[4:]))
        if model == "PINHOLE":
            fx, fy, cx, cy = p[0], p[1], p[2], p[3]
        elif model == "SIMPLE_PINHOLE":
            fx = fy = p[0]; cx, cy = p[1], p[2]
        else:                                   # fall back: first param as focal
            fx = fy = p[0]; cx, cy = w / 2, h / 2
        cams[cid] = dict(fx=fx, fy=fy, cx=cx, cy=cy, w=w, h=h)
    return cams


def _quat_to_R(qw, qx, qy, qz):
    """COLMAP world->camera rotation (Hamilton, w-first)."""
    n = (qw * qw + qx * qx + qy * qy + qz * qz) ** 0.5 or 1.0
    qw, qx, qy, qz = qw / n, qx / n, qy / n, qz / n
    return np.array([
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy)],
        [2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx)],
        [2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)],
    ])


def read_images(path):
    out, lines = [], [l for l in open(path) if not l.startswith("#") and l.strip()]
    for ln in lines:
        t = ln.split()
        if len(t) < 10 or not t[-1].lower().endswith((".jpg", ".png", ".jpeg")):
            continue                            # skip the (empty) points2D lines
        qw, qx, qy, qz = map(float, t[1:5])
        tx, ty, tz = map(float, t[5:8])
        out.append(dict(name=t[9], cam_id=int(t[8]),
                        R=_quat_to_R(qw, qx, qy, qz),
                        t=np.array([tx, ty, tz])))
    return out


def read_points3D(path):
    xyz = []
    for ln in open(path):
        if ln.startswith("#") or not ln.strip():
            continue
        t = ln.split()
        xyz.append((float(t[1]), float(t[2]), float(t[3])))
    return np.asarray(xyz, dtype=np.float64)


# ----------------------------------------------------------------------------- 2D -> 3D lift
def lift_box(box, R, t, cam, P, near_frac=0.45, min_pts=6):
    """Project the point cloud into the frame; keep points inside the 2D box, take
    the NEAR-surface median so we anchor to the object, not the wall behind it."""
    Xc = P @ R.T + t                            # world -> camera
    z = Xc[:, 2]
    front = z > 0.05
    px = cam["fx"] * Xc[:, 0] / z + cam["cx"]
    py = cam["fy"] * Xc[:, 1] / z + cam["cy"]
    inb = (front & (px >= box[0]) & (px <= box[2]) & (py >= box[1]) & (py <= box[3]))
    if inb.sum() < min_pts:
        return None
    zin = z[inb]
    near = zin <= np.quantile(zin, near_frac)   # front slab only
    sel = np.where(inb)[0][near]
    if sel.size < 3:
        sel = np.where(inb)[0]
    return dict(xyz=np.median(P[sel], axis=0), depth=float(np.median(z[sel])),
                n_pts=int(sel.size))


# ----------------------------------------------------------------------------- detector
def make_detector(kind, labels, device):
    """Return a run(image)->[{label,score,box}] closure.

    detr  = facebook/detr-resnet-50, COCO-91 closed vocab but FAST (~1-2s/frame CPU).
            Covers everyday scenes (person/laptop/chair/banana/bottle/tv/...).
    owlv2 = open-vocabulary, prompt ANY label, but ~1 min/frame on CPU.
    """
    from transformers import pipeline
    if kind == "owlv2":
        det = pipeline("zero-shot-object-detection",
                       model="google/owlv2-base-patch16-ensemble", device=device)
        return lambda im: det(im, candidate_labels=labels)
    det = pipeline("object-detection", model="facebook/detr-resnet-50", device=device)
    want = set(labels)
    return lambda im: [d for d in det(im) if d["label"] in want]


def build(dataset, out, labels, skip, thresh, stride, eps, min_views, device,
          detector="detr"):
    from PIL import Image
    sparse = os.path.join(dataset, "sparse", "0")
    cams = read_cameras(os.path.join(sparse, "cameras.txt"))
    imgs = read_images(os.path.join(sparse, "images.txt"))
    P = read_points3D(os.path.join(sparse, "points3D.txt"))
    img_dir = os.path.join(dataset, "images")
    imgs = imgs[::stride]
    labels = [l.strip() for l in labels if l.strip() and l.strip() not in skip]
    print(f"[catalog] {len(imgs)} frames (stride {stride}), {len(P):,} points, "
          f"detector={detector}, labels={labels}")

    run = make_detector(detector, labels, device)

    dets = []                                   # per-frame anchored detections
    t0 = time.time()
    for i, im in enumerate(imgs):
        path = os.path.join(img_dir, im["name"])
        if not os.path.exists(path):
            continue
        cam = cams.get(im["cam_id"]) or next(iter(cams.values()))
        try:
            res = run(Image.open(path).convert("RGB"))
        except Exception as e:
            print(f"  ! detect {im['name']}: {e}"); continue
        for d in res:
            if d["score"] < thresh or d["label"] in skip:
                continue
            b = d["box"]
            a = lift_box((b["xmin"], b["ymin"], b["xmax"], b["ymax"]),
                         im["R"], im["t"], cam, P)
            if a is None:
                continue
            dets.append(dict(label=d["label"], score=float(d["score"]),
                             xyz=a["xyz"], depth=a["depth"], frame=im["name"]))
        if (i + 1) % 10 == 0 or i == len(imgs) - 1:
            print(f"  {i+1}/{len(imgs)} frames, {len(dets)} anchored dets, "
                  f"{time.time()-t0:.0f}s")

    catalog = cluster(dets, eps, min_views)
    scene_extent = float(np.linalg.norm(P.max(0) - P.min(0))) if len(P) else 0.0
    meta = dict(dataset=dataset, frames=len(imgs), stride=stride,
                points3D=len(P), scene_extent=round(scene_extent, 2),
                detections=len(dets), instances=len(catalog),
                detector=detector, eps=eps, min_views=min_views, thresh=thresh)
    json.dump(dict(meta=meta, objects=catalog), open(out, "w"), indent=2)
    print(f"[catalog] {len(catalog)} instances -> {out}")
    for o in catalog:
        print(f"  {o['label']:12} conf={o['confidence']:.2f} views={o['n_views']:>2} "
              f"spread={o['spread_m']:.2f}m  @ ({o['centroid'][0]:.1f},"
              f"{o['centroid'][1]:.1f},{o['centroid'][2]:.1f})")
    return meta


def cluster(dets, eps, min_views):
    """Group per-frame anchors of the same label into 3D instances (DBSCAN)."""
    from sklearn.cluster import DBSCAN
    out = []
    by_label = {}
    for d in dets:
        by_label.setdefault(d["label"], []).append(d)
    for label, group in by_label.items():
        X = np.array([d["xyz"] for d in group])
        if len(X) < min_views:
            continue
        lab = DBSCAN(eps=eps, min_samples=min_views).fit_predict(X)
        for c in sorted(set(lab)):
            if c == -1:
                continue
            m = lab == c
            pts = X[m]
            scores = np.array([group[j]["score"] for j in np.where(m)[0]])
            centroid = np.median(pts, axis=0)
            spread = float(np.median(np.linalg.norm(pts - centroid, axis=1)))
            out.append(dict(
                label=label, n_views=int(m.sum()),
                confidence=round(float(scores.mean()), 3),
                spread_m=round(spread, 3),
                centroid=[round(float(v), 4) for v in centroid],
                extent=[round(float(v), 3) for v in (pts.max(0) - pts.min(0))],
            ))
    out.sort(key=lambda o: (o["label"], -o["n_views"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", help="COLMAP dataset dir (has images/ + sparse/0)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--labels", default="laptop,chair,banana,backpack,bottle,"
                    "table,handbag,cup,potted plant,tv,keyboard,book")
    ap.add_argument("--skip", default="person",
                    help="comma labels to detect-but-drop (moving/unreliable)")
    ap.add_argument("--detector", choices=["detr", "owlv2"], default="detr",
                    help="detr=fast COCO (default), owlv2=slow open-vocab")
    ap.add_argument("--thresh", type=float, default=0.7,
                    help="score cutoff (detr~0.7, owlv2~0.25)")
    ap.add_argument("--stride", type=int, default=4, help="use every Nth frame")
    ap.add_argument("--eps", type=float, default=0.4, help="DBSCAN meters")
    ap.add_argument("--min-views", type=int, default=3)
    ap.add_argument("--device", default="cpu", help="cpu (safe w/ training) or mps")
    a = ap.parse_args()
    build(a.dataset, a.out, a.labels.split(","), set(s.strip() for s in a.skip.split(",")),
          a.thresh, a.stride, a.eps, a.min_views, a.device, a.detector)


if __name__ == "__main__":
    main()
