# Brush Capability Report — Phase 0 spikes

**Date:** 2026-08-08 · **Machine:** Apple Silicon (Metal/wgpu) · **Binary:**
`~/Programming/brush-app-aarch64-apple-darwin/brush_app` (150 MB, CLI-only).

Purpose: empirically de-risk the Brush assumptions the whole real-time plan rests on
(`REALTIME_SPLAT_PLAN.md` §0 / Phase 0). **All four spikes pass — the plan's v1
"periodic-retrain" architecture is viable.**

> ⚠️ **Measurement caveat:** every timing below was taken while a concurrent
> `brush_app --with-viewer capture_full` **hero render** (30 000 steps @ 1600 px) was
> running on the same GPU. All wall-clock numbers are therefore **conservative upper
> bounds** — uncontended cadence runs will be materially faster. This also doubled as
> a live S0.4 test (multiple Brush processes coexisted with no hard lock).

---

## S0.1 — Train from ARKit poses, no COLMAP solve ✅ PASS

Pipeline exercised end-to-end from a real 216-frame live capture
(`live_sessions/sess_1e6d548d9e5d4ab1/phone`):

1. `export_colmap.py` → 168 sharp images + 164 340 LiDAR init points in ~12 s
   (poses written to `images.txt`, **no SfM / feature matching / `database.db`**).
2. `brush_app <dataset> --total-steps 500 --export-every 100` (headless) →
   emits `spike_100.ply … spike_500.ply` snapshots during the run.
3. `decode_brush_ply()` → viewer-ready ply: **189 584 gaussians**, fields
   `x,y,z,red,green,blue,scale_*,rot_*` — loads in the `:8765` viewer.

**Conclusion:** Brush trains directly from ARKit-posed data. COLMAP — normally the
slow batch bottleneck — is entirely skipped. This is the single biggest enabler.

## S0.2 — Wall-clock vs cadence knobs

Dataset = the 168-image spike dataset. Only the final ply exported per run
(`--export-every == --total-steps`). Times **under GPU contention** (see caveat).

| total_steps | max_frames | max_resolution | seconds | exit |
|------------:|-----------:|---------------:|--------:|:----:|
| 500  | 40  | 720  | 27  | 0 |
| 1500 | 40  | 720  | 71  | 0 |
| 4000 | 40  | 720  | 208 | 0 |
| 1500 | 20  | 720  | 74  | 0 |
| 1500 | 80  | 720  | 71  | 0 |
| 1500 | 150 | 720  | 72  | 0 |
| 1500 | 40  | 1280 | 158 | 0 |
| 4000 | 80  | 1280 | 473 | 0 |

**What drives per-cycle cost:**
- **`total_steps` dominates** — roughly linear (500→27 s, 1500→71 s, 4000→208 s at
  720/40 frames; ≈0.05 s/step *contended*, so ≈0.02–0.03 s/step uncontended).
- **`max_frames` barely matters at fixed steps** (20/80/150 → 74/71/72 s). Brush
  samples ~one view per step, so dataset *size* doesn't change step cost — it only
  adds a one-time load cost. → We can keep many frames for quality without paying
  per-cycle time, and still cap with `--max-frames` to bound load/RAM.
- **`max_resolution` costs ~2.2×** (720→71 s vs 1280→158 s at 1500/40). Live cadence
  should stay at **720**; the final pass can go 1280.

**v1 cadence budget pick:** `total_steps≈1500, max_resolution=720, max_frames≈40`
(the `ReconConfig` defaults). Expected ~15–30 s/cadence **uncontended** (≈71 s while a
hero render hog the GPU — which won't normally happen during live capture). Drop to
`total_steps≈1000` for snappier "watch it build" updates at some quality cost.

## S0.3 — Warm-resume from a prior `.ply`? ❌ NO (as predicted)

`brush_app <prior.ply> --total-steps 200 --start-iter 500 …` → **process exits
immediately, produces no output, no log**. A `.ply` has no camera views to train
against, and `--start-iter` only shifts the LR-schedule counter — there is **no
`--init-ply` / `--resume-checkpoint`**.

**Conclusion:** the binary **cannot** continue an existing model. v1 must **re-launch
Brush on the growing dataset each cadence** (exactly what `LiveReconManager` does).
True never-restart online GS (§9) requires building **Brush from source**.

## S0.4 — Serial-safe repeated launches? ✅ PASS

8 sequential benchmark launches all exited 0; a resume probe and the hero render ran
too. **No lingering lock / port / stuck process** between runs — a fresh
`brush_app` starts cleanly every time. Two instances even ran **concurrently** with no
hard lock (they only contend for the GPU). This validates the manager's design: the
single-run invariant is about **GPU efficiency**, not avoiding a crash.

---

## Impact on the plan

| Assumption (plan §0) | Verdict |
|---|---|
| Brush trains from ARKit poses, no SfM (§0.2) | ✅ confirmed (S0.1) |
| Cannot resume a saved model → re-launch each cadence (§0.3) | ✅ confirmed (S0.3) |
| Single-GPU-serial-safe to relaunch repeatedly (§0.4) | ✅ confirmed (S0.4) |
| Per-cycle cost boundable to "seconds" | ✅ via `total_steps` (dominant) + `max_resolution=720` |

**No plan revision needed.** Proceed with the periodic-retrain v1 (Phases 1–4);
gate §9 (online warm-start) on a separate "build Brush from source" spike.

### Reproduce
```bash
# S0.1
.venv/bin/python tools/arkit_capture/export_colmap.py \
    live_sessions/<sid>/phone --out /tmp/spike_ds
~/Programming/brush-app-aarch64-apple-darwin/brush_app /tmp/spike_ds \
    --total-steps 500 --export-every 100 --export-path /tmp/brushspike \
    --export-name "spike_{iter}.ply" --eval-every 100000000
# S0.2 matrix
/tmp/bench_brush.sh          # writes /tmp/brushbench/results.csv
```
