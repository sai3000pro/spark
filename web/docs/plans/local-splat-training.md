# Gaussian splats on the user's own laptop — the plan

> Grounded in `docs/research/local-splat-training.md` (repo reality, the trainer, the architectures)
> and `docs/research/pose-estimation.md` (where poses come from, and how good they must be).
> Both carry the citations and the `file.ts:line` evidence. Read their "could not determine"
> sections before committing to any date here.

## The finding that reorganises the problem

**The trainer is not the blocker. The poses are.**

The intuitive plan is "compile a splat trainer to WebGPU and run it in the tab". That half is
genuinely solved: **Brush** trains 3DGS in a browser today, is wgpu-based so not CUDA-locked, and
emits binary-LE all-float32 INRIA-layout PLY — exactly what `lib/video/plyBounds.ts:75-77` already
accepts and the viewer already renders. Point Brush at a scene and this repo displays the result
with **zero** changes.

The problem is the input. Brush ingests COLMAP or Nerfstudio **posed** data. It does no
structure-from-motion and does not accept video.

And there is no browser path to poses. Not "immature" — **absent**:

- No SfM has ever been compiled to WASM. No COLMAP/OpenMVG/OpenSfM port, not even an issue thread.
- transformers.js supports zero multi-view pose models — its 3D list is all monocular depth.
- ONNX Runtime Web cannot hold one anyway: 4 GB WASM address space, ~2 GB max `ArrayBuffer` in
  Chrome, and ORT's own docs say models over 4 GB cannot run. The community VGGT export is 4.76 GB.
- The only browser code that emits poses is live-AR world tracking — AlvaAR (**GPLv3**, last pushed
  2023) and 8th Wall's SLAM (binary-only blob; the open-sourced MIT framework *excludes* SLAM).
  Both are live-camera trackers with no offline video ingest.

**So: poses run server-side. That is not a preference, it is the shape of the problem.**
Everything below follows from it.

## The seam that makes everything else swappable

Brush's dataset format is COLMAP text: `cameras.txt`, `images.txt`, `points3D.txt`.

**Design the interface there.** Whatever produces poses — pycolmap, Depth Anything 3, MapAnything,
ARKit, or an in-browser solver that does not exist yet — hands over the same three files, and the
trainer never learns which. The pose solver becomes a swappable component behind a text-file
boundary, which is the single most valuable structural decision in this plan.

Concretely: `lib/reconstruction/posed.ts` defining a `PosedScene` (the three files plus the frames
they reference) and a one-method `PoseSolver`.

---

## Phase 0 — stop the laptop path lying, before building on it

**Half a day. Do this first regardless of what follows.**

`lib/reconstruction/dispatch.ts:119-134` contains no fetch, no POST, no socket, no file move — and
says *"Streaming to the studio on your laptop — the splat builds as it goes"* and *"Queued for the
studio on your laptop."* Nothing streams; nothing is queued. `lib/splatJobs.ts:16-27` is explicit
that the real next steps are a human running a command on another machine and a human copying a
file back.

Currently masked because `probeStudio()` cannot reach `:8899` here — but **`studio-batch` is the
phone's default target**, so on any machine where a studio *is* running, every phone capture ends
in a green success message for work nobody will do.

It also has to be fixed *before* the rest, because every phase below makes that branch real, and
you cannot tell a working dispatch from a broken one while both print the same sentence.
`targets.ts:61`'s `BROWSER_TRAINER_AVAILABLE = false` is the model — the one target in that file
whose copy already matches reality.

## Phase 1 — the spike that decides the timeline

**Two days. It is cheap, and nobody has published the number.**

> **Time `pycolmap` end-to-end on the actual target laptop, for 150–300 frames of 1080p handheld.**

Every published COLMAP benchmark runs on an A100 or A6000 with 24–128 server cores. There is **no
clean end-to-end timing on a named consumer laptop anywhere in the literature** — and that single
number decides whether the local path is a three-minute wait or a two-hour one, which decides
whether it is a product at all.

The structural fact that makes this uncertain, from COLMAP's own author: *"Only feature
extraction, matching and dense reconstruction can take advantage of the GPU."* **The sparse mapper
— incremental bundle adjustment — is CPU/Ceres.** So a CUDA laptop accelerates the cheap stages and
leaves the expensive one on the CPU, and the wall-clock is governed by core count, not by the GPU
the `lib/gpu.ts` probe is so careful about.

Extrapolated range (explicitly *not* a measurement): **10–35 min** on a CUDA laptop with sequential
matching; **30 min – 2 h** CPU-only or Apple Silicon.

Run `feature_extractor → sequential_matcher (with loop closure) → mapper` and **stop**. Do not run
dense MVS — 3DGS does not need it, and it is what turns every forum horror story into twelve hours.
Cap `max_image_size` around 1600 and extract ~2048 features. Exhaustive matching at 300 frames is
~44,850 pairs and roughly triples the matching stage; sequential is the correct choice for a walk.

**Secondary spike, same two days:** Brush's WASM build in Chrome on the same laptop, against a
known-posed dataset. Report wall-clock at 500/1500/4000 steps (native Apple Silicon reference under
GPU contention: 27 s / 71 s / 208 s), the wasm32 4 GB ceiling in frames and gaussians, and whether
Windows' GPU watchdog (TDR) kills a long compute pass. `lib/gpu.ts:184`'s "15–40 minutes" estimate
has no measurement behind it at all.

## Phase 2 — the `PoseSolver` seam

**1–2 days. Unblocked.** As above. Do it before Phase 4 so the sidecar is written against the
interface rather than the interface being reverse-engineered out of the sidecar.

## Phase 3 — the browser-side capture gate

**~1 week. Unblocked, and it pays off under every architecture including the status quo.**

`lib/video/sampleFrames.ts` + `lib/tracking.ts` (block matching with a forward–backward consistency
check) + `lib/coverage.ts` are real, good, and already running at ~12 Hz in the tab. What they lack
is the geometry back end — no two-view geometry, no triangulation, no bundle adjustment — so they
cannot produce poses.

They *can* answer a cheaper and immediately valuable question: **would a solver reject this footage
before we spend anything on it?** Insufficient parallax, too little frame overlap, motion blur, a
single elevation band — all measurable with what exists today.

Build this first. It stops wasting KIRI credits *now*, and it composes directly with
`lib/video/preflight.ts`, which already refuses over-length clips before they cost a credit. Same
idea, aimed at content instead of duration.

## Phase 4 — the sidecar — *this is the one that delivers the feature*

**~1–2 weeks.**

`lib/studio.ts` is a client for a studio server. **That server is not in this repository** and never
has been: `run_live_studio.sh:21-33` shells into a gitignored 125 GB `ComfyUI/` checkout that lives
on one Apple Silicon Mac, and `tools/video_intel/splat_batch.py:31` hardcodes that same foreign
absolute path. So write a **small standalone sidecar**, explicitly not ComfyUI-coupled, speaking
the protocol `lib/studio.ts` already expects:

1. accept an uploaded clip,
2. extract frames (or accept the browser's, from Phase 3),
3. **`pycolmap`** → the COLMAP text triple,
4. **Brush native** → train,
5. write the `.ply` where `getSplatJob` already derives readiness by looking for it — no status
   protocol to invent, because `lib/splatJobs.ts` already treats the file as the truth.

Two choices worth stating outright:

**`pip install pycolmap`, not a native COLMAP build.** Prebuilt wheels exist for **Linux, macOS and
Windows**, BSD-3 licensed. This collapses the install burden from "compile a C++ project" to one
pip line and is the single biggest change from my first draft of this plan. (GPU wheels,
`pycolmap-cuda12`, are Linux-only for now.) Note also that **GLOMAP is gone** — the repo was
archived 2026-03-09 and merged into COLMAP as the `global_mapper`, reachable from pycolmap as
`global_mapping()`. Its "1–2 orders of magnitude" claim does not survive contact: expect **1.5–3×**
on 100–300-image scenes.

**Brush, not gsplat/nerfstudio/Postshot.** Brush is wgpu, so it runs on AMD and Apple Silicon. The
others are CUDA-only and would exclude every non-NVIDIA laptop — quite possibly including the
target one, since `lib/gpu.ts:15-17` was written against Intel Iris Xe.

## Phase 5 — feed-forward acceleration, once Phase 4 works

**Optional, and only worth it if Phase 1 says pycolmap is too slow.**

The measured sweet spot is **not** raw learned poses — it is **feed-forward initialisation followed
by classical refinement**: run Depth Anything 3 for a 1–3 s initialisation, then restrict local
feature matching to nearby images and bundle-adjust.

| Pose source (Mip-NeRF 360, A100) | novel-view PSNR |
|---|---|
| COLMAP, 8192 features | **27.67** |
| **Refined DA3** (feed-forward + classical BA) | **25.84** |
| Depth Anything 3, raw | **17.50** |
| π³, raw | 16.03 |
| Fast3R, raw | 15.06 |

**Raw feed-forward poses produce a visibly broken splat** — nine to ten dB below COLMAP. The
refinement is doing the work, not the network. Use **DA3-Base** (0.11 B, 542 MB, **Apache 2.0**) or
**MapAnything-apache**; both are permissively licensed and both emit COLMAP-format extrinsics.

## Phase 6 — the in-browser trainer

Gated on Phase 1's secondary spike **and** on a pose source. Do not flip
`BROWSER_TRAINER_AVAILABLE` (`lib/reconstruction/targets.ts:61`) before then — the comment above it
already says so and it is right.

---

## Order

| | What | Blocked on | Size |
|---|---|---|---|
| **0** | Stop `dispatch.ts` claiming streaming/queueing nothing performs | — | half a day |
| **1** | Spike: pycolmap wall-clock on the target laptop (+ Brush WASM) | — | 2 days |
| **2** | The `PoseSolver` seam at the COLMAP-triple boundary | — | 1–2 days |
| **3** | Browser-side capture-quality gate | — | ~1 week |
| **4** | Sidecar: pycolmap + Brush native ← **delivers the feature** | 2 | 1–2 weeks |
| **5** | DA3 init + BA refinement | 4, and only if 1 says so | ~1 week |
| **6** | In-browser trainer | 1, 2, and a pose source | only if 1 passes |

0–3 are all unblocked and can run concurrently.

---

## Three traps to avoid

**1. `pose_opt` will not rescue bad poses.** Both gsplat and Nerfstudio expose camera optimisation
and both are *sub-degree refinement* mechanisms: gsplat's `pose_opt_lr` is `1e-5`; Nerfstudio
applies explicit L2 penalties pulling deltas toward zero, and **`splatfacto` defaults to
`mode="off"`**. Measured: with injected position noise, clean 28.3 → 28.7 but **noisy 21.3 → 21.2**
— it recovered nothing. The reason is structural: rendering gradients only affect a small local
region, so Gaussians cannot escape local minima, and 3DGS has no equivalent of BARF's coarse-to-fine
schedule because the primitives are explicit. **Turn it on (~+0.6 dB for ~3% overhead); never rely
on it.** You need an initialisation already within about a degree.

**2. The accuracy budget is tighter than it looks, and it is really a pixel budget.**

| Rotation error | ≈px @1080p | What it looks like |
|---|---|---|
| < 0.05–0.1° | ≲1–2 px | indistinguishable to slightly soft |
| 0.1–0.3° | 2.5–7 px | visible softening; probably still passes on a phone screen |
| **0.3–1°** | 7–25 px | **the knee** — ghosting, doubling, floaters |
| > 1–2° | >25 px | obviously broken |

At 1080p with ~68° HFOV, **1° ≈ 25 px**. COLMAP's own ceiling is ~0.1–0.7° on a good solve — but it
is content-dependent and does not degrade gracefully: on textureless indoor scans its rotation
error has been measured ranging **3.55° to 133.83°**. This is the argument for Phase 3's gate.

Relevant if the iPhone path ever returns: raw ARKit poses cost **−3.55 dB** against a refined
pipeline, and >10% of them exceed 1° — right on the knee. ARKit's real advantage is **not failing**
where COLMAP collapses, not accuracy.

**3. The licence trap.** Touching **DUSt3R, MASt3R, VGGT-1B, Pi3 weights, Fast3R, CF-3DGS,
LongSplat or InstantSplat** makes the product non-commercial. InstantSplat is nominally Apache-2.0
but *ships* MASt3R. ZeroGS says "all rights reserved".

The clean commercial set — and every component this plan selects is in it: **pycolmap (BSD-3),
Brush (Apache-2.0), Depth Anything 3 Small/Base (Apache-2.0), MapAnything-apache (Apache-2.0),
MoGe (MIT)**.

## Two loose ends found on the way

- **Port 8765 is double-booked.** `lib/studio.ts:21-22` points `VIEWER_URL` at the ComfyUI splat
  viewer; `.env.example:122-123` points the phone WebSocket at `tools/live_capture_server/server.py`,
  whose default port is also 8765 and which serves none of the viewer's routes. Whichever binds
  first wins and the other fails in a way that will look like a network problem.
- **Brush cannot warm-resume from a `.ply`.** Any "refine this splat further" feature is a retrain
  from scratch — do not design a UI implying otherwise.
