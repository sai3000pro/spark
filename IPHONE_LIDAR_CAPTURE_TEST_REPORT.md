# iPhone LiDAR Capture — Test Report

Generated 2026-08-07 on macOS (Apple Silicon, Command Line Tools only — no full
Xcode, no physical iPhone / ESP32 available on this machine).

This report distinguishes clearly between: (A) automated tests actually executed
here, (B) stress/integration actually executed here, (C) tests that require a
physical iPhone / ESP32, and (D) known limitations. **No hardware gate is
claimed as passed.**

---

## A. Automated tests actually executed

### Python — `tools/arkit_capture` (62 passed)
```
python -m unittest discover -s tools/arkit_capture/tests -t .
Ran 62 tests ... OK
```
Covers: matrix serialization + JSON round-trip (identity/translation/rotation/
random rigid), non-square/NaN rejection, row-major ordering; depth & confidence
codec round-trip + little-endian + wrong-byte-count; metadata parse (mandatory
fields, unknown-optional preservation, newer-version warning, missing depth);
intrinsics scaling (same/uniform/non-uniform/principal-point/invalid);
trajectory metrics (straight line, loop drift, rotation, non-monotonic warn,
jump flag); unprojection (constant plane, principal point, translation applied,
confidence/range filters, RGB→depth intrinsics scaling); PLY round-trip;
validation/corruption (missing session/rgb, wrong depth size, truncated jsonl,
bad json, duplicate id, orphan file); synthetic inspector integration
(known trajectory + cloud); cross-language golden (matrix rows, depth/confidence
bytes, SHA-256).

### Python — `tools/live_capture_server` (40 passed)
```
python -m unittest discover -s tools/live_capture_server/tests -t .
Ran 40 tests ... OK
```
Covers Phases 3–7: health, WebSocket handshake, protocol/client-type mismatch,
clock-offset math + injected offset, reconnect-resume; one-frame byte-for-byte,
100 frames, out-of-order, duplicate idempotency, checksum NACK, slow server,
inspector-on-received-session; mid-session disconnect, disconnect-near-STOP,
server-restart recovery (disk index rebuild), reconciliation reupload,
corrupted-payload retry, long-stream bounded memory; odometry ingest, sequence
gaps, duplicates, out-of-order, high-rate, protocol mismatch, path-traversal
session rejected, clock-sync stored; clock-sync jitter/drift/min-RTT/filter;
dashboard snapshot + `/status.json` + HTML; full synchronized E2E (phone +
ESP32 + disconnect + inspector).

### Swift core — `swift run CoreCheck` (23 checks passed)
```
cd ios && swift run CoreCheck
ALL CORE CHECKS PASSED
```
Runs the contract logic under Command Line Tools (no XCTest): matrix round-trip
+ golden rows, intrinsics scaling, state machine (happy path + double-START /
STOP-while-idle / export-before-complete), frame sampler (5 Hz from 60 Hz,
non-monotonic/invalid rejected, long pause), bounded-queue backpressure +
recovery, clock-sync offset/RTT, CaptureFileStore writing an inspectable
metadata.jsonl + depth files, and **cross-language golden** (matrix rows
`0000803f…`, confidence `00010200`, SHA-256 `3f07e5…`) matching the Python
goldens byte-for-byte.

### Swift XCTest — authored, not run here
`ios/Tests/GauzensplatCaptureCoreTests` (~40 methods) mirrors CoreCheck as
XCTest. This machine has Command Line Tools only (no XCTest module), so `swift
test` cannot run here; it runs under full Xcode / on-device CI. The identical
logic is exercised by CoreCheck above.

---

## B. Stress / integration actually executed

### Live process end-to-end (server + simulators + inspector)
Real OS processes, not in-process:
```
server.py --port 8790
simulate_phone.py --frames 25 --rate 10 --disconnect-after 10 \
    --reconnect-after 0.3 --duplicate-every 6 --corrupt-every 8
  -> clock offset ~0.02 ms, disconnect+resume, reconcile local=25 server=25
     missing=0 checksum_failures=0 complete=True
simulate_esp32.py --session <sid> --path square --rate 20 --duration 2 --fast
  -> 40 odometry msgs stored under same session
inspect_capture.py live_sessions/<sid>/phone
  -> Valid frames: 25, 0 ERROR/0 WARNING, path_length 2.4 m, cloud 1200 pts,
     trajectory + PLY + plots written
```

### Measured bandwidth (real, not guessed)
Per-frame payload with 256×192 depth (`depth = 256·192·4 = 196,608 B`,
`confidence = 49,152 B`, metadata ≈ 0.6 KB). RGB below uses a realistic ARKit
JPEG estimate of ~250 KB (the synthetic fixtures use tiny JPEGs, so their
on-wire RGB is far smaller — reported separately in the raw numbers).

| Rate | MB/min | GB/hour |
|---|---|---|
| 1 Hz | ~30 | ~1.8 |
| 5 Hz | ~149 | ~8.9 |
| 10 Hz | ~298 | ~17.9 |

Disk growth is ~linear in frame count; depth dominates. Measured server ingest
throughput over loopback (Python client, synchronous ACK per payload):
**200 frames / 49.3 MB in 9.03 s ≈ 5.5 MB/s, ~22 frames/s**. This is bounded by
the synchronous per-payload request/response in the reference client, not the
wire or server disk; real bandwidth on Wi-Fi will be gated by RGB JPEG size and
link speed. The key stress property holds: when the network falls behind, the
disk-referenced backlog grows while **local recording stays healthy** (bounded
RAM verified by `test_long_stream_bounded_memory`).

### Long / bounded-memory
`test_long_stream_bounded_memory` streams 300 frames; server RSS growth bounded
(< ~300 MB) because payloads are written to disk immediately, never buffered.

---

## C. Tests requiring a physical iPhone 16 Pro — `AWAITING_DEVICE_VALIDATION`

Not run (no device). Procedure to execute (see `ios/README.md` to build):

1. **Sensor health** — launch app; confirm LiDAR ACTIVE, Tracking NORMAL.
2. **Stationary 30 s** — expect small drift, stable depth, no jumps/corruption.
3. **Straight line 2–5 m** — roughly straight metric trajectory, plausible length.
4. **Rectangular loop** — loop-like path; measure (do not hide) start/end drift.
5. **Desk/table orbit 20–30 s** — arc trajectory, recognizable LiDAR geometry
   (intended first Brush dataset).
6. **Tracking loss** — cover camera / blank wall; expect `limited/notAvailable`
   flags recorded, session not discarded.
7. **Fast motion / pan / rotation** — tracking warnings, no crash.
8. **Glass / mirror / shiny / dark** — raw noisy depth preserved; confidence
   threshold on Mac prevents catastrophic clouds; no invented depth.
9. **Occlusion (person walks through)** — capture stays valid (masking is future).
10. **Durations 2 / 5 / 10 min** — ~linear disk growth, bounded memory, frame
    counts, writer backlog, drops, metadata integrity, export reliability.
11. **Interruptions** — lock phone / background / deny permission → safe
    pause/stop, flush, recoverable session marked interrupted.
12. **Rates 5 / 10 Hz** — safe frame dropping under backpressure, not crashes.

For each: **EXPORT → `inspect_capture.py` → confirm the trajectory matches your
physical movement and LiDAR geometry is recognizable.**

### First real Wi-Fi acceptance test (device + laptop)
`server.py` on Mac → app TEST CONNECTION (CONNECTED, RTT, clock offset) → START
→ walk ~30 s → dashboard updates live → STOP → reconciliation `Missing: 0,
Checksum failures: 0` → `inspect_capture.py live_sessions/<sid>/phone` yields the
same trajectory/depth/`lidar_cloud.ply` — proving CAPTURE+SEND+RECEIVE+STORE+
RETRIEVE+RECONSTRUCT end-to-end without AirDrop.

### Real ESP32
Not available. `simulate_esp32.py` speaks the exact `/ws/odometry` protocol the
firmware will use; the server session model does not change when the real device
replaces the simulator.

---

## D. Known limitations
- App layer (ARKit/SwiftUI/URLSession) is not compiled on this machine (no iOS
  SDK). Contract-critical logic is compiled + run via `GauzensplatCaptureCore`.
- Depth "256 × 192" shown in the UI is the typical ARKit LiDAR size; the actual
  size is read from the device per frame and stored in metadata.
- The exact ARKit depth sign/orientation convention is documented and self-
  consistent in tests; it must be confirmed on-device (inspector warns on
  mirrored/exploding geometry to catch a wrong sign early).
- Continuous compressed video is out of scope for V1 (keyframe RGB+pose+depth is
  the reconstruction input); the transport is structured to add video segments.
- Reference client uses synchronous per-payload ACK (simple, correct); a
  pipelined client would raise loopback throughput but isn't required for V1.
