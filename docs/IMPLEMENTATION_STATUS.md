# Gauzensplat Capture — Implementation Status

End-to-end iPhone LiDAR + local Wi-Fi capture pipeline, built phase-by-phase per
`capture-implementation-prompt.md`.

Last updated: 2026-08-07

## Summary

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo layout, format/protocol contracts, Python readers + math, tests | ✅ PASS |
| 1 | Native iOS ARKit capture app (no networking) | ✅ code + core tests PASS · 🔶 device gate `AWAITING_DEVICE_VALIDATION` |
| 2 | Offline Mac inspector (trajectory + LiDAR cloud + validation) | ✅ PASS |
| 3 | Phone↔laptop connection: health, handshake, clock sync, reconnect | ✅ PASS (backend + iOS UI code) |
| 4 | Live sensor mirroring (RGB/pose/intrinsics/depth/confidence) | ✅ PASS |
| 5 | Reliability: IDs, checksums, ACK/NACK, idempotency, reconciliation, stress | ✅ PASS |
| 6 | ESP32 odometry ingest via simulator + protocol | ✅ PASS |
| 7 | Full synchronized session + final end-to-end test | ✅ PASS (simulated) · 🔶 real-device+ESP32 awaiting hardware |

"PASS" = automated tests written and passing on this machine. 🔶 marks gates that
require physical hardware (iPhone 16 Pro / ESP32) — code and simulators are ready
and clearly not falsely marked as hardware-verified.

## Test totals actually executed here

- Python (`unittest`): **102 passed** — `tools/arkit_capture` 62, `tools/live_capture_server` 40.
- Swift core (`swift run CoreCheck`, Command Line Tools): **23 checks passed**,
  including cross-language golden bytes (matrix rows, depth/confidence, SHA-256)
  matching the Python goldens.
- Swift XCTest suite (~40 methods) authored; runs under full Xcode / on-device
  CI (this machine has Command Line Tools only, no XCTest) — mirrored by CoreCheck.
- Live process E2E: server + `simulate_phone` (disconnect/reconnect/duplicate/
  corrupt) + `simulate_esp32` + inspector-on-received-session — verified manually.

---

## Phase 0 — contracts + math ✅
- Files: `tools/arkit_capture/{formats,intrinsics,trajectory,pointcloud,fixtures}.py`,
  `FORMAT_SPEC.md`; iOS `Sources/GauzensplatCaptureCore/*`.
- Defined: `CAPTURE_FORMAT_VERSION=1`, `NETWORK_PROTOCOL_VERSION=1`, row-major
  matrix serialization, little-endian float32 depth, uint8 confidence,
  session/frame identity, depth-unprojection convention.
- Tests: matrix round-trip, depth/confidence codec, intrinsics scaling,
  trajectory math, point-cloud unprojection, metadata parse/version tolerance.
- Gate: all pure-Python contract/math tests pass. ✅

## Phase 1 — iOS capture app ✅ code / 🔶 device
- Files: `ios/GauzensplatCapture/**`, `ios/Sources/GauzensplatCaptureCore/**`.
- ARKit world tracking + raw `sceneDepth`; lightweight extraction; bounded
  writer queue; serial background writer; state machine; fixed-rate sampler;
  local-first `CaptureFileStore`; health UI; export; interruption/low-storage/
  missing-depth handling.
- Tests executed: Swift `CoreCheck` (23) incl. matrix/intrinsics/state-machine/
  sampler/bounded-queue/file-store/clock-sync/golden. XCTest suite authored.
- Known issues: app-layer (ARKit/SwiftUI/URLSession) not compilable on this Mac
  (Command Line Tools only, no iOS SDK) — builds in Xcode.
- Physical gate: **AWAITING_DEVICE_VALIDATION** (see test report §Physical).

## Phase 2 — offline inspector ✅
- Files: `tools/arkit_capture/{inspect_capture,validate}.py`.
- Produces `trajectory.csv`, `trajectory_topdown.png`, `trajectory_3d.png`,
  `lidar_cloud.ply`, `summary.json`, `validation.txt`. Validation classifies
  ERROR/WARNING/RECOVERABLE; partial captures stay inspectable.
- Tests: synthetic integration (known trajectory/cloud), corruption detection,
  missing-depth, cross-language golden.
- Gate: same stored data reads back to a sensible trajectory/cloud. ✅

## Phase 3 — connection only ✅
- Files: `tools/live_capture_server/{server,ws,protocol,clock_sync,session_manager,
  dashboard}.py`; iOS `Network/{ConnectionTester,WiFiLaptopTransport}`,
  `UI/ConnectionPanel`.
- `GET /health`, `/ws/phone` handshake, session negotiation, ping/pong RTT,
  clock-offset estimation, reconnect/resume. Real two-way test (not just socket).
- Tests: health, handshake, protocol/client mismatch, clock offset math,
  reconnect-resume, server-absent. Gate: round-trip + reconnect proven. ✅

## Phase 4 — live mirroring ✅
- Files: `tools/live_capture_server/{storage,client,synth,simulate_phone}.py`.
- Local durable write → network enqueue → background transmit. Bulk header +
  binary + ACK, byte-for-byte on disk.
- Tests: one-frame checksum, 100 frames, out-of-order, duplicate, slow server,
  inspector-on-received-session. Gate: received session == authoritative. ✅

## Phase 5 — reliability + stress ✅
- Payload IDs, SHA-256, ACK/NACK, idempotent dedupe, disk-index rebuild on
  restart, reconnect backoff, end-of-session manifest reconciliation.
- Tests: mid-session disconnect, disconnect-near-STOP, server restart recovery,
  reconciliation reupload, corrupted-payload retry, long-stream bounded memory.
- Gate: local count = server count, missing = 0, checksum failures = 0. ✅

## Phase 6 — ESP32 odometry ✅
- Files: `tools/live_capture_server/{odometry_client,simulate_esp32}.py`;
  `/ws/odometry`.
- Versioned messages (session_id, device_id, sequence, device_time_us, payload);
  paths stationary/straight/square/circle/random at 1–100 Hz; stored to
  `rover/odometry.jsonl`; sequence-gap/duplicate/out-of-order detection.
- Tests: ingest, gaps, duplicates, order, high-rate, protocol mismatch, wrong/
  path-traversal session rejected, clock sync stored. Gate: drop-in for real
  ESP32 without changing the session model. ✅

## Phase 7 — full synchronized session ✅ simulated
- One server session holds phone RGB/depth/poses + odometry + clock-sync records;
  raw device + server-arrival timestamps both preserved.
- Test `test_phase7_e2e`: clock sync → stream with disconnect+duplicate →
  odometry in parallel → reconcile 0 missing → inspector on received phone
  capture (trajectory + cloud correct) → odometry present under same session.
- Real iPhone + real ESP32 run: 🔶 awaiting hardware (simulators stand in).

## Not in scope (as instructed)
Brush / COLMAP / Gaussian Splatting / HunyuanWorld / person masking / audio /
rover control / cloud backend / auth. Data model is kept ready for them
(see `IPHONE_LIDAR_CAPTURE.md` §Future).
