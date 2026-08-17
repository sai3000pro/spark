# Where camera poses come from — the decision-relevant findings

> Companion to `local-splat-training.md`, which establishes that poses, not the trainer, are the
> blocker. This document is the survey of what can actually supply them.
> **Research date: 2026-08-17.** Claims are labelled `[measured, HW]`, `[paper claim]`,
> `[anecdote]` or `[vendor claim]`.

## 0. The question, answered

> Is there anything today that takes a phone video in and produces camera poses out, running
> entirely in a browser?

**No.** Not in any form that could ship as a splat pipeline.

- **No SfM has been compiled to WASM.** No COLMAP / OpenMVG / OpenSfM / Theia port exists, and
  there is not even a COLMAP issue thread discussing an Emscripten target. OpenCV's `sfm` contrib
  module is Linux-only, needs Ceres, and is in no `opencv.js` build.
- **transformers.js supports zero multi-view pose models.** Its 3D-adjacent list is entirely
  monocular depth (Depth Anything, Depth Pro, DPT, Metric3D). No DUSt3R, MASt3R, VGGT, Pi3.
- **ONNX Runtime Web cannot hold these models.** Hard ceilings: 2 GB protobuf, ~2 GB max
  `ArrayBuffer` in Chrome, 4 GB WASM address space, and ORT's own docs state there is currently no
  way to run models larger than 4 GB. Community VGGT ONNX exports are fp32 at **4.76 GB** —
  over the ceiling, and CC-BY-NC besides.
- **The only browser code that emits poses is live-AR world tracking, not offline SfM.**
  *AlvaAR* is genuine WASM visual SLAM but is **GPLv3** and last pushed **2023-07-09**.
  *8th Wall* was open-sourced when Niantic wound the platform down (access ended 2026-02-28), but
  the MIT framework **excludes SLAM** — that ships as a binary-only blob, and it is a live-camera
  tracker with no offline video ingest and no globally bundle-adjusted output.

**Nearest thing to a future "yes":** DA3-BASE is **542 MB** fp32 (~270 MB fp16), Apache-2.0, and
does pose estimation — comfortably inside browser limits. But every existing DA3 ONNX export is
**depth-only, single-image; the pose head is not exported.** That is the concrete gap. It is an
engineering project, not a download.

**Therefore: poses run server-side. Budget a Python worker.** WebGPU itself is not the problem —
~82% global support, all four major browsers ship it.

## 1. What can ship on a laptop now, ranked

| # | Approach | Licence | Why |
|---|---|---|---|
| **1** | **`pip install pycolmap`** | BSD-3 | Solves the literal problem. **Prebuilt wheels for Linux, macOS and Windows — no native build.** Exposes `extract_features`, `match_sequential/exhaustive`, `incremental_mapping`, `global_mapping`, `bundle_adjustment`. GPU wheels (`pycolmap-cuda12`) are Linux-only for now. |
| **2** | **Feed-forward init → classical refinement** | mixed | The *measured* best trade-off. DA3/VGGT for a 1–3 s initialisation, then restrict local feature matching to nearby images and bundle-adjust. **25.84 dB vs 18.54 raw vs 27.67 full COLMAP.** |
| **3** | **Depth Anything 3 (Base/Small)** | **Apache 2.0** | Best pose accuracy of any feed-forward model *and* the only permissively-licensed one at small size. Base is 0.11 B / 542 MB. Outputs COLMAP-format extrinsics. |
| **4** | **VGGT via `vggt-low-vram`** | non-commercial* | `[measured, RTX 5070 laptop]` 125 images in **5.83 GB** vs 31.52 GB stock. *Commercial use needs the gated `VGGT-1B-Commercial` checkpoint. |
| **5** | **MapAnything** (`-apache`) | **Apache 2.0** | Cleanest commercially-usable multi-view pose model. 1–2000 images in, `camera_poses` + `intrinsics` out. |
| **6** | **Jawset Postshot** | commercial | Built-in camera tracking, no COLMAP needed. Windows + NVIDIA. |
| **7** | **Brush** | Apache-2.0 | The trainer, not a pose source. No CUDA, runs in Chrome. **You must bring poses.** |
| **✗** | CF-3DGS, InstantSplat, Splatt3R, LongSplat, SplaTAM, MonoGS | mostly non-comm. | All CUDA-only, most measured only on A100/4090. See §4. |

## 2. GLOMAP is gone — it is now COLMAP's global mapper

The `colmap/glomap` repo was **archived 2026-03-09** and fully migrated into COLMAP, exposed as
`colmap global_mapper` / `--mapper GLOBAL`, and reachable from pycolmap as `global_mapping()`. It
still requires COLMAP for feature extraction and matching — it only ever replaced the mapper.

**The README's "1–2 orders of magnitude faster" is not what the measurements show.** For typical
100–300-image scenes expect **1.5–3×**, occasionally 5–8× on pathological ones. `[measured, A100]`
Mip-NeRF 360: COLMAP 15.51 min → GLOMAP 10.47 min. And it is not universally faster — one report
has relative-pose estimation taking >30 min where COLMAP finished everything in 15–25.

## 3. How long COLMAP actually takes — and the structural fact behind it

From COLMAP's author: *"Only feature extraction, matching and dense reconstruction can take
advantage of the GPU."* **The sparse mapper (incremental bundle adjustment) is CPU/Ceres.** So a
CUDA laptop accelerates the cheap stages and leaves the expensive one on the CPU.

`[measured, Apple Silicon]` colmap-metal, 53 images @1920×1536: SIFT **4.3 s on Metal vs 26.6 s on
CPU** (6.2×), peak RAM 154 MB vs 11.6 GB.
`[blog, 2026, M4 Pro 48 GB, no CUDA]` *"usually takes 2–8 hours to turn input images to a finished
splat"* — end-to-end including training.
`[real run, 20 cores + CUDA]` 28,742 phone frames @4000 px: matching 27 h, mapper >5 days.

**Extrapolated for 100–300 frames of 1080p handheld — not a measurement:**
- CUDA laptop, sequential matching: **10–35 min**
- CPU-only / Apple Silicon, sequential matching: **30 min – 2 h**

The horror stories are almost always **dense MVS** or 12 MP stills at `max_image_size 3200+`.
3DGS does not need dense MVS. Run `feature_extractor → sequential_matcher → mapper` and stop.
Exhaustive matching at 300 frames is ~44,850 pairs — roughly triples the matching stage. Use
`sequential_matcher` with loop closure.

## 4. `pose_opt` cannot rescue bad poses — the most important negative result

Both gsplat and Nerfstudio expose camera optimisation, and **both are refinement mechanisms with
sub-degree reach**:

- gsplat: `pose_opt_lr = 1e-5`, `pose_opt_reg = 1e-6`. That learning rate cannot traverse a large
  error in 30k iterations.
- Nerfstudio: explicit `trans_l2_penalty = 1e-2`, `rot_l2_penalty = 1e-3` pulling deltas toward
  zero. **`splatfacto` defaults to `mode="off"`.**
- `[measured]` With 0.15 position noise and `SO3xR3`: clean 28.3 → 28.7; **noisy 21.3 → 21.2.**
  The optimiser recovered nothing.
- `gaussian_barf`'s author, verbatim: *"a slight refinement to the poses for more pixel-perfect
  alignment rather than a robust pose optimization."*
- **Why:** rendering gradients only affect a small local region, so Gaussians cannot escape local
  minima. BARF's enabling trick was coarse-to-fine positional-encoding scheduling; **3DGS has no
  equivalent**, because Gaussians are explicit and their gradients are spatially local.

**Turn it on — ~+0.6 dB for ~3% overhead — but never rely on it. You need an initialisation
already within roughly a degree.**

## 5. How good do poses have to be?

`[paper]` EventNeRF's controlled angular-error sweep (NeRF, synthetic, 346×260):

| Rotation error | 0° | 0.01° | 0.1° | 1° | 2° |
|---|---|---|---|---|---|
| PSNR | 27.43 | 27.26 | **26.18** | **18.11** | 17.49 |

**The degree threshold is not portable — it is a pixel-offset threshold in disguise.** At 1080p
with ~68° HFOV (f ≈ 1424 px), **1° ≈ 25 px**. So the phone equivalent of EventNeRF's "safe" 0.1°
is nearer **0.04–0.06°**. *(That normalisation is the researcher's own derivation; no paper
normalises pose error by focal length — itself a finding.)*

3DGS-specific ablations exist at only two points. `[paper, RTX 4090]` GarageWorld: clean 25.43 →
**23.17 @0.3°** → **22.07 @0.6°**.

| Rotation error | ≈px @1080p | What it looks like |
|---|---|---|
| **< 0.05–0.1°** | ≲1–2 px | Indistinguishable to slightly soft |
| **0.1–0.3°** | 2.5–7 px | Visible softening, fine texture lost. Probably still passes on a phone screen |
| **0.3–1°** | 7–25 px | **The knee.** Ghosting and doubling on high-frequency detail, floaters |
| **> 1–2°** | >25 px | Obviously broken |
| **> 5°** | — | Total failure |

**Mechanism:** pose error → rays do not intersect at the right 3D point → densification
compensates by spawning semi-transparent per-view "floater" Gaussians → ghosting from novel views
plus a bloated splat count.

**COLMAP's own ceiling** is ~0.1–0.7° rotation on a good solve — but it is content-dependent and
does not degrade gracefully: `[paper]` on ScanNet its rotation error ranged **3.55° to 133.83°**.
On textureless indoor scans it does not get worse, it explodes.

**ARKit poses:** `[paper, iPhone 14 Pro Max]` *"Over 90% of ARKit poses present less than 0.1 m and
1° error"* — that worst-decile figure sits exactly on the knee. The direct ablation `[paper]`:
removing residual pose refinement from an ARKit-initialised pipeline costs **26.80 → 23.25 PSNR**,
a **−3.55 dB penalty for raw ARKit poses**. ARKit's real advantage over SfM is **not failing**
where COLMAP collapses. Note that ScanNet++ ships both ARKit and COLMAP poses and its NVS
benchmark uses COLMAP's — a signal in itself.

## 6. The licence trap

The moment you touch **DUSt3R, MASt3R, VGGT-1B, Pi3 weights, Fast3R, CF-3DGS, LongSplat or
InstantSplat**, you are non-commercial. InstantSplat is nominally Apache-2.0 but *ships MASt3R*,
so it is non-commercial in practice.

**The clean commercial set:** pycolmap (BSD-3), DA3-Small/Base/Metric-Large/Mono-Large (Apache
2.0), MapAnything-apache (Apache 2.0), MoGe (MIT), NoPoSplat / AnySplat / SPFSplat (MIT), Brush
(Apache 2.0), VGGT-1B-Commercial (gated). **ZeroGS says "all rights reserved" — treat as unusable.**

## 7. What could not be determined

1. **No controlled 3DGS pose-noise sweep exists.** The only fine-grained curve is NeRF-on-synthetic
   at 346×260; 3DGS ablations exist at two points only. A genuine gap in the literature, and a
   publishable experiment.
2. **No human-perception threshold.** Nobody has run "at what pose error do N naive viewers call
   this broken". Every band in §5 is inferred from PSNR curves plus artefact descriptions.
3. **Whether degrees or pixels is the right invariant.** The pixel normalisation is the
   researcher's own and unverified.
4. **Clean end-to-end COLMAP timings on a *named* consumer laptop for 100–300 frames of 1080p.**
   Every published benchmark uses A100/A6000 with 24–128 server cores. §3's range is extrapolation.
   **This is the number that most needs measuring, and it is cheap to measure.**
5. **Whether the DA3 pose head is ONNX-exportable in practice.** Its camera tokens participate in
   global attention across views, so a dynamic-view-count export is non-trivial. Nobody has tried
   publicly.
6. **A direct, controlled ARKit-vs-COLMAP-poses 3DGS comparison on identical frames.** ScanNet++
   ships both pose sets and would make this trivial; no paper has run it.
7. Inference VRAM for most feed-forward models; licences for PF3plat, SelfSplat, SPFSplatV2,
   SplaTAM, CUT3R unverified against actual LICENSE files; Postshot's GPU requirements unpublished.
