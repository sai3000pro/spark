# Real-Time Progressive Gaussian Splat — Implementation Plan (v1)

**Audience:** an implementation agent picking this up cold.
**Goal of v1:** As you scan a space with the iPhone, the desktop shows a Gaussian splat that
**progressively builds and refines in near-real-time** — regions that reach "enough angles"
(green in the on-phone coverage mesh) get streamed and folded into the reconstruction, and the
`:8765` viewer updates live. No AirDrop, no manual Export→Reconstruct click.

**This is the pragmatic first version (Path 1.5 "progressive").** True online GS-SLAM (never-restart
trainer) is explicitly out of scope for v1 — see §9 for why and the upgrade path.

---

## 0. TL;DR of the decisive constraints (read first)

1. **Brush is a BINARY ONLY** at `~/Programming/brush-app-aarch64-apple-darwin/brush_app`
   (150 MB, no Rust source on this machine). We can only drive its **CLI**. Confirmed flags:
   `[PATH_OR_URL] --total-steps --refine-every --max-splats --sh-degree --max-frames
   --max-resolution --subsample-frames --subsample-points --start-iter --export-every
   --export-path --export-name --eval-every --with-viewer --seed`.
2. **Brush trains from POSED data** (COLMAP dir or Nerfstudio `transforms.json`). **No SfM solve** is
   needed — our ARKit poses + LiDAR points are the init. `tools/arkit_capture/export_colmap.py`
   already emits a COLMAP-format dataset from ARKit poses (poses in `images.txt`, LiDAR points in
   `points3D.txt`). **This is the single biggest enabler** — COLMAP is normally the slow batch step.
3. **Brush cannot resume a saved model** (`--start-iter` only shifts the LR schedule/counter; there
   is no `--init-ply`/`--resume-checkpoint`). So v1 **re-launches Brush on the growing dataset** each
   cadence, using `--export-every` to stream `.ply` snapshots into the viewer during each run. This is
   compute-redundant but robust and delivers the "watch it build" experience.
4. **Live Wi-Fi streaming already exists** (the "MIRRORING" mode). Phone→desktop frame streaming is
   done; we are adding a **reconstruction loop** on top of it, not a new transport.

> **Phase 0 (spikes) MUST empirically confirm items 2 & 3 before building on them.**

---

## 1. What already exists (verified via code investigation)

### Desktop (repo root: `/Users/notjackl3/Programming/hunyuanworld-mirror`)
- **Unified studio server** `ComfyUI/studio/server.py` (`:8899`): serial GPU job queue (`_jobs`),
  WS `/ws/phone` + `/ws/odometry` (delegated to `tools/live_capture_server/`), HTTP
  `POST /api/run`, `GET /api/runs`, `GET /api/capture/status`, `GET /api/sessions`,
  `POST /api/sessions/export` (ARKit→COLMAP), `GET /api/frames?run=<id>`.
- **Live ingest** `tools/live_capture_server/` (`server.py PhoneSession`, `storage.py SessionStore`,
  `protocol.py`, `ws.py`). Phone sends **JSON bulk_header + binary payload** pairs; payload types
  `rgb` (jpeg), `depth` (float32 LE), `confidence` (u8), `frame_metadata` (json). Stored under
  `ComfyUI/studio/live_sessions/<session_id>/phone/{frames,depth,confidence,metadata.jsonl,
  metadata_raw,session.json}`. SHA-256 validated, idempotent (`SessionStore.store_payload`),
  reconciled on `end_session`.
- **Reconstruction** `ComfyUI/pipeline_run.py`: `pipeline_brush(colmap_dataset)` invokes
  `~/Programming/brush-app-aarch64-apple-darwin/brush_app` and exports `<tag>_<iter>.ply` snapshots;
  `decode_brush_ply()` converts Brush log-scale ply → viewer-ready. Output to
  `ComfyUI/studio/runs/<run_id>/result.ply` + `meta.json`.
- **Posed export (COLMAP-free)** `tools/arkit_capture/export_colmap.py`: `live_sessions/.../phone/`
  → `ComfyUI/brush_data/<name>/{images/, sparse/0/{cameras.txt,images.txt,points3D.txt}}` built from
  ARKit poses + LiDAR points. **Also** `export_transforms.py` (Nerfstudio format).
- **Viewer** `ComfyUI/custom_nodes/ComfyUI-HunyuanWorld-Mirror/viewer_server.py` (`:8765`) +
  `web/index.html` (Three.js, `splat.vert/frag`); loads `.ply` via `GET /file?path=<abs>`.
- **Frontend** `ComfyUI/studio/static/index.html` (`:8899`): tabs Reconstruct/Capture/Sessions/Viewer;
  today polls `/api/runs` every ~3 s.

> ⚠️ Line numbers in the investigation are approximate — verify by opening the files. Treat function
> and file names as authoritative anchors.

### Mobile (`ios/GauzensplatCapture`, the **hunyuanworld-mirror** copy is the one Xcode builds; keep the **Spark** copy in sync — both diverge, verify with DerivedData)
- **Transport** `Network/WiFiLaptopTransport.swift`: WebSocket to `/ws/phone`. Handshake
  `connect→hello/hello_ack`, `beginSession→session_id`, `syncClock` (ping/pong), `endSession`
  (manifest→reconcile). `enqueue(MirrorItem)` → drains as bulk_header + binary, awaits `ack`.
- **Coordinator** `Capture/CaptureCoordinator.swift`: writer loop persists RGB/depth/confidence/meta
  to disk (source of truth), then `enqueueMirror(fid:meta:urls:)` streams each payload **only when the
  transport is `WiFiLaptopTransport`** (skipped for `OfflineTransport`).
- **Frame model** `Sensors/ARFrameExtraction.swift` `ExtractedFrame` + Core `FrameMetadata`
  (transform 4×4, intrinsics 3×3, image WxH, depth WxH, rgbJPEG, depthBytes, confidenceBytes,
  tracking).
- **Coverage** `App/CaptureViewModel.swift` `CoverageMap`: voxel (~12 cm) → 12 azimuth-bucket bitmask;
  `update(frame)` (≈8 Hz, gated by `active`), `level(x:y:z:)`, `@Published fraction`,
  `enoughAngles = 5`. **This is the keyframe trigger source.**

---

## 2. v1 Architecture

```
PHONE (scanning)
  ├─ CoverageMap.update(): when a voxel crosses `enoughAngles` → mark region "green"
  ├─ Keyframe selector: pick frames whose viewpoint newly filled a green region
  └─ WiFiLaptopTransport: stream {rgb, depth, confidence, metadata, KEYFRAME tag} live  (EXISTS)
        │  ws /ws/phone  (EXISTS)
        ▼
DESKTOP studio :8899
  ├─ live_capture_server ingest → live_sessions/<sid>/phone/...     (EXISTS)
  └─ NEW: LiveReconManager (persistent background thread/process)
        1. watch metadata.jsonl for new (keyframe) frames
        2. incrementally maintain a posed dataset  (reuse export_colmap.py, COLMAP-free)
        3. cadence trigger (every K new keyframes OR T seconds, min interval): (re)launch brush_app
             brush_app <dataset> --total-steps <budget> --export-every <n>
                       --export-path runs/live_<sid> --max-splats ... --subsample-points ...
        4. on each exported <iter>.ply → decode_brush_ply → publish as "current live ply"
        └─ serial GPU queue aware: never overlap Brush runs; coalesce triggers
        ▼
  NEW: GET /api/live_splat?session=<sid>  → latest decoded ply path/bytes + version
  NEW: WS /ws/splat_updates               → push {version, ply_url} when a new snapshot lands
        ▼
VIEWER :8765 (or Capture tab embed)
  └─ NEW: live mode — on version bump, reload ply (double-buffered, no flicker)
```

**Key policies**
- **COLMAP-free**: always feed Brush the ARKit-posed dataset; never run SfM.
- **LiDAR-seeded**: keep `points3D.txt` from LiDAR so Brush converges fast (`--subsample-points` to bound).
- **Bounded per-cycle cost**: modest `--total-steps` (e.g. 1500–4000) + `--max-frames`/`--subsample-frames`
  caps so each cycle finishes in seconds; quality improves across cycles as frames accumulate.
- **Coverage-gated keyframes**: only stream/keep frames that add angle coverage → less redundant data,
  fewer near-duplicate views, better splats.
- **Never overlap Brush**: one run at a time (GPU serial); new data arriving mid-run is folded into the
  *next* run.

---

## 3. Phases (each phase = shippable + tested)

> Build order is desktop-first (can be exercised with a **frame replayer**, no phone needed), then
> mobile, then frontend, then E2E. Every phase lists **acceptance tests** the implementation agent must
> write and pass before moving on.

### Phase 0 — Capability spikes (½ day, MUST do first)
**Goal:** empirically de-risk the Brush assumptions the whole plan rests on.
- S0.1 Build a tiny posed dataset from an existing `live_sessions/*/phone/` capture via
  `export_colmap.py`. Run `brush_app <dataset> --total-steps 500 --export-every 100
  --export-path /tmp/brushspike` (headless, no `--with-viewer`). **Confirm:** it trains from ARKit poses
  with **no COLMAP solve**, and emits `export_*.ply` that `decode_brush_ply()` + the `:8765` viewer load.
- S0.2 Measure wall-clock for `--total-steps` ∈ {500, 1500, 4000} at `--max-frames` ∈ {20, 60, 150},
  `--max-resolution` ∈ {720, 1280}. Produce a small table → picks the v1 default cadence budget.
- S0.3 Confirm whether `--start-iter` + loading a prior `.ply` as `PATH_OR_URL` can continue training
  (expected: **no** — it's viewer-only). Record the result; it decides if §9 warm-start is even possible
  with the binary.
- S0.4 Confirm Brush is **single-GPU-serial-safe** to launch repeatedly (no lingering lock/port).
**Acceptance:** a markdown `docs/brush_capability_report.md` with the table + yes/no answers. If S0.1
fails, STOP and escalate (the plan needs revision).

### Phase 1 — `LiveReconManager` (desktop core, no phone needed)
**Files:** new `ComfyUI/studio/live_recon.py`; wire into `ComfyUI/studio/server.py`.
**Goal:** a persistent manager that turns a growing `live_sessions/<sid>/phone/` into a stream of
decoded live `.ply` snapshots.
- Watch `metadata.jsonl` (poll every 250–500 ms; robust to partial writes — read only fully-terminated
  json lines). Track `last_seen_frame_id`.
- Maintain an **incremental posed dataset** for `<sid>` under `ComfyUI/studio/live_datasets/<sid>/`
  (reuse `export_colmap.py` logic; append new frames without rebuilding from scratch — if append is
  hard in v1, rebuild but measure cost in Phase 0/stress).
- **Cadence controller:** trigger a Brush run when `(new_keyframes >= K)` OR `(elapsed >= T and
  new_keyframes > 0)`, with a hard **min-interval** and **never while a run is active** (coalesce).
- **Runner:** subprocess `brush_app` (reuse `pipeline_run.py:run_brush`/`decode_brush_ply` — refactor
  those into importable functions if needed) → export into `runs/live_<sid>/`; on each new `<iter>.ply`,
  decode and atomically update `runs/live_<sid>/current.ply` + bump an in-memory `version` int.
- **State/API surface (in-process):** `LiveReconManager.status(sid) → {version, current_ply, frames,
  keyframes, running, last_run_seconds}`.
- Lifecycle: start on first phone frame of a session; stop + do a final higher-quality run on
  `end_session`.
**Acceptance tests (pytest, no phone):**
- T1.1 **Frame replayer** fixture: feed a recorded `live_sessions` capture into the manager by copying
  frames in over time; assert `version` increments and `current.ply` is a valid, growing, viewer-loadable
  ply.
- T1.2 Cadence: with K=8/T=5 s, assert runs fire on the right boundaries and **never overlap** (mock or
  wrap the runner to record start/stop intervals).
- T1.3 Coalescing: burst 200 frames in 1 s → exactly one run queued next, not 25.
- T1.4 Crash-safety: kill a Brush subprocess mid-run → manager recovers, next cadence proceeds, no
  orphan processes/locks.
- T1.5 COLMAP-free correctness: dataset fed to Brush contains ARKit poses (spot-check `images.txt`) and
  no SfM step is invoked.

### Phase 2 — Live serving + viewer live-update
**Files:** `ComfyUI/studio/server.py` (+ routes), viewer `web/index.html` / `viewer_server.py`,
`ComfyUI/studio/static/index.html` (Capture tab).
- `GET /api/live_splat?session=<sid>` → `{version, ply_url, frames, keyframes, running}`.
- `WS /ws/splat_updates?session=<sid>` → push `{version, ply_url}` on each new snapshot (fallback: client
  polls `/api/live_splat` at 2–5 Hz if WS unavailable).
- Viewer **live mode**: on version bump, fetch new ply into a **back buffer**, swap on load complete
  (no flicker / no dropped frames); keep camera pose across swaps.
**Acceptance tests:**
- T2.1 Endpoint returns monotonic `version`; `ply_url` serves a valid ply via `:8765 /file`.
- T2.2 Headless WS client receives a push within one cadence of a new snapshot.
- T2.3 Browser test (manual + a Playwright smoke if available): splat visibly updates without full-page
  reload; camera doesn't jump on swap.

### Phase 3 — Mobile: coverage-triggered keyframes
**Files:** `App/CaptureViewModel.swift` (`CoverageMap`), `Capture/CaptureCoordinator.swift`,
`Sources/GauzensplatCaptureCore/NetworkProtocol.swift` (+ `FrameMetadata`). **Apply to BOTH ios copies.**
- **Keyframe selector:** in `CoverageMap.update`, when a voxel's bitmask **crosses `enoughAngles`**
  (edge, not level), emit `onKeyframeReady(frameID/region)`. Also select frames that first observe a new
  green voxel (novel-viewpoint), throttled (e.g. ≤ 3/s) and deduped by pose novelty (min translation/rotation
  delta) to avoid floods.
- **Tag keyframes on the wire:** extend `bulk_header` with `meta.keyframe = true` (+ optional
  `trigger`), or add `PayloadType.keyframe*`. Desktop `LiveReconManager` prioritizes tagged frames for the
  posed dataset (non-keyframes still stored for the final pass).
- Keep the existing full mirror stream intact (source of truth unchanged); keyframe tagging is additive.
- Guard so this only runs while **recording + mirroring** (`active` gate).
**Acceptance tests (XCTest / `swift run CoreCheck` mirror where logic is in Core):**
- T3.1 Threshold-crossing fires **once** per voxel (not every frame after) — unit test `CoverageMap`
  with synthetic frames.
- T3.2 Pose-novelty dedup: stationary camera emits ≤1 keyframe; orbiting emits ~1 per angular step.
- T3.3 `bulk_header` JSON includes the keyframe tag and round-trips through the Core encoder/decoder.
- T3.4 Both ios copies build (`xcodebuild ... -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO`).

### Phase 4 — End-to-end + coverage-driven cadence
- Wire desktop cadence to prefer keyframe-tagged frames; on `end_session`, run a **final** longer Brush
  pass (higher `--total-steps`, full frames) → `result.ply` (existing offline-quality path).
- Add a Capture-tab UI: live splat panel + coverage %/frames/keyframes + "running" indicator.
**Acceptance tests:**
- T4.1 **Simulated full run** using `tools/live_capture_server` phone simulator (memory: simulators
  exist) streaming a recorded capture → live splat grows → `end_session` → final `result.ply` produced.
- T4.2 Latency: median time from "region goes green" → that region visible in the live splat is within
  target (define in Phase 0, e.g. < 15 s on this machine).

### Phase 5 (stretch, NOT v1) — true warm-start / online
See §9. Requires **Brush source** (clone `github.com/ArthurBrussee/brush`, `cargo build --release`,
Rust 1.85+) and a patch to (a) init model from a prior `.ply` and continue, or (b) add dataset views
mid-training. Gated on Phase 0 S0.3 result and a separate go/no-go.

---

## 4. Testing strategy (throughout — non-negotiable)

- **Unit:** `CoverageMap` threshold/dedup logic (Swift/CoreCheck); cadence controller, metadata parsing,
  ply decode, dataset append (pytest).
- **Integration (no phone):** a **frame replayer** that copies a recorded `live_sessions/*/phone/`
  capture into a temp session dir at a configurable rate → drives the whole desktop pipeline. This is the
  primary dev harness; every desktop phase runs against it in CI.
- **Simulator E2E:** use the existing `tools/live_capture_server` phone/ESP32 simulators to exercise the
  real WS path without a device.
- **Regression:** the cross-language golden format test must still pass (`tools/arkit_capture/tests/
  test_golden.py` + Swift `GoldenFormatTests`/CoreCheck). Do not alter the wire format without updating
  both.
- **Build gates:** both ios copies compile; python suites via `.venv/bin/python -m unittest discover`.

## 5. Stress / scale testing (explicitly: "huge amount of information")

Build a `tools/live_capture_server/tests/stress_replay.py` (or extend the simulator) covering:
- **Volume:** 10k–50k frames / multi-GB session. Assert: disk-backed dataset build stays O(new frames)
  (append, not full rebuild) or documents the rebuild cost; RSS stays bounded (no loading all frames in
  RAM — stream from disk, as the coordinator already does on mobile).
- **Throughput/backpressure:** sustained 10 Hz keyframes for 20+ min (soak). Assert: cadence coalesces,
  Brush never overlaps, ingest never blocks on reconstruction, viewer stays responsive.
- **Burst:** 500 frames in <2 s → coalesced to a single next run; no queue blow-up.
- **Growing-cost curve:** measure per-cycle Brush time vs dataset size; verify the `--max-frames`/
  `--subsample-frames` caps keep per-cycle time bounded (this is the v1 mitigation for periodic-retrain
  cost). Chart it in `docs/brush_capability_report.md`.
- **Fault injection:** kill Brush mid-run; drop WS mid-session; corrupt a frame (bad sha256) → dedup/
  reconcile handles it; disk-full → graceful stop (mobile already stops < 300 MB free; desktop must too).
- **Long soak:** 60+ min continuous session → no fd/memory/process leaks; `version` monotonic; final pass
  succeeds.
- **Concurrency:** two phones / two sessions at once → isolated `LiveReconManager` per sid; GPU queue
  serializes runs fairly.

**Every stress test asserts a concrete SLO** (bounded RSS, no overlap, latency target). Log dropped/
skipped work explicitly — never silently cap.

## 6. Risks & mitigations
- **Periodic retrain is compute-heavy** → bound with `--max-frames`/`--subsample-frames`/modest
  `--total-steps`; coalesce; coverage-gate keyframes. (True fix = §9.)
- **ARKit pose drift over large scenes** → misalignment across cycles; mitigate with the LiDAR point
  init + a final offline pass; document that hero quality = offline.
- **Brush binary quirks** (locks, ports, GPU contention) → Phase 0 S0.4; single-run invariant.
- **Wire-format drift** → golden tests gate any change.
- **Two diverging ios copies** → apply mobile changes to both; verify via DerivedData which is live.

## 7. Config & flags
- Server config block for: `LIVE_RECON_ENABLED`, cadence `K`/`T`/`min_interval`, per-cycle
  `total_steps`/`max_frames`/`max_resolution`/`subsample_points`, final-pass budget. Default **off** so it
  can't destabilize existing offline reconstruction.
- Mobile: a "Live reconstruct" toggle (only meaningful when MIRRORING is on).

## 8. Definition of done (v1)
Scanning a room with MIRRORING on shows a splat in the studio that **visibly grows/refines within a
cadence** as new areas go green, updates without page reload, ends with a final `result.ply`, and passes
the full test + stress suite with documented SLOs.

## 9. Why not true online now, and the upgrade path
The binary can't resume a model (§0.3), so "never-restart" online GS needs **Brush source**:
clone `github.com/ArthurBrussee/brush`, `cargo build --release`, then patch to init from a prior `.ply`
and/or append dataset views mid-training, exposing an `add_keyframe()`/`step()` loop. That converts v1's
periodic retrain into constant-cost incremental mapping (§ earlier discussion: ~1 s local latency,
scene-scale bounded cost). Gate on Phase 0 S0.3 + a dedicated spike building Brush from source on this
Mac (Metal/wgpu).

---

## Appendix A — exact anchors (verify on open)
- Desktop: `ComfyUI/studio/server.py`, `ComfyUI/pipeline_run.py` (`run_brush`, `decode_brush_ply`),
  `tools/live_capture_server/{server.py,storage.py,protocol.py,ws.py}`,
  `tools/arkit_capture/{export_colmap.py,export_transforms.py}`,
  `ComfyUI/custom_nodes/ComfyUI-HunyuanWorld-Mirror/{viewer_server.py,web/index.html}`,
  `ComfyUI/studio/static/index.html`.
- Mobile: `ios/GauzensplatCapture/{Network/WiFiLaptopTransport.swift,Capture/CaptureCoordinator.swift,
  Sensors/ARFrameExtraction.swift,App/CaptureViewModel.swift}`,
  `ios/Sources/GauzensplatCaptureCore/{NetworkProtocol.swift,CaptureRecords.swift}`.
- Brush: `~/Programming/brush-app-aarch64-apple-darwin/brush_app` (CLI in §0).

## Appendix B — Brush invocation template (v1 cadence run)
```
brush_app <live_datasets/<sid>>  \
  --total-steps <cadence_budget e.g. 2000>  --refine-every 200 \
  --max-splats 1500000  --sh-degree 2 \
  --max-frames <cap>  --max-resolution 1280  --subsample-points <n> \
  --export-every <e.g. 250>  --export-path runs/live_<sid>  --export-name "live_{iter}.ply"
# headless (NO --with-viewer). One run at a time. decode_brush_ply → current.ply, bump version.
```
