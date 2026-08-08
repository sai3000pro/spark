# iPhone LiDAR Capture — Gauzensplat sensing foundation

A trustworthy, scalable capture system: hold an iPhone 16 Pro, record
synchronized **RGB + ARKit pose + intrinsics + LiDAR depth + confidence +
timestamps**, then verify on the Mac that the recorded trajectory and LiDAR
geometry are correct — offline via manual export, or live over local Wi-Fi.
Optional ESP32 odometry ingests into the same session for later time alignment.

> Local phone capture is ALWAYS the source of truth. Wi-Fi is never required to
> record. Reconstruction (Brush / Gaussian Splatting) is intentionally **not**
> built here — only the sensing + transport foundation.

## Contents
1. [Repository layout](#repository-layout)
2. [Quick start](#quick-start)
3. [Architecture](#architecture)
4. [Capture format](#capture-format)
5. [Coordinate conventions](#coordinate-conventions)
6. [Networking](#networking)
7. [Testing](#testing)
8. [Export & Mac validation](#export--mac-validation)
9. [Known failure modes & fallbacks](#known-failure-modes--fallbacks)
10. [Future integration path](#future-integration-path)

## Repository layout

```
ios/                              native Swift/SwiftUI/ARKit app + testable core
  Sources/GauzensplatCaptureCore/ contract-critical logic (compiles on Mac)
  GauzensplatCapture/             ARKit / SwiftUI / URLSession app layer
  Package.swift  project.yml  README.md
tools/arkit_capture/              Mac offline inspector + format library
  formats.py FORMAT_SPEC.md intrinsics.py trajectory.py pointcloud.py
  validate.py inspect_capture.py fixtures.py  tests/
tools/live_capture_server/        local Wi-Fi server + simulators
  server.py ws.py protocol.py storage.py session_manager.py clock_sync.py
  client.py odometry_client.py dashboard.py synth.py
  simulate_phone.py simulate_esp32.py  tests/
IMPLEMENTATION_STATUS.md  IPHONE_LIDAR_CAPTURE.md  IPHONE_LIDAR_CAPTURE_TEST_REPORT.md
```

The Brush/Hunyuan/ComfyUI reconstruction paths are untouched.

## Quick start

### Offline (no laptop)
1. Build & run `ios/` on an iPhone 16 Pro (see `ios/README.md`).
2. Confirm **LiDAR ACTIVE / Tracking NORMAL** → **START** → walk → **STOP**.
3. **EXPORT LAST CAPTURE** → AirDrop/Files to Mac.
4. `python tools/arkit_capture/inspect_capture.py <capture>`.

### Live Wi-Fi
1. Mac: `python tools/live_capture_server/server.py` (prints LAN IP + dashboard URL).
2. App: enter `IP:8765` → **TEST CONNECTION** → **ENABLE LIVE MIRROR** → START.
3. STOP → app reconciles (0 missing) → `inspect_capture.py live_sessions/<sid>/phone`.

### Mac tooling setup
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install numpy pillow matplotlib      # matplotlib only needed for plots
```
The server + simulators are **stdlib-only** (no pip installs). numpy/Pillow are
needed for the inspector; matplotlib only for trajectory plots (the inspector
degrades gracefully to CSV/PLY/summary without it).

## Architecture

```
ARSessionController  (ARKit world tracking + raw sceneDepth, health)
        │ frame (capture queue)
        ▼
CaptureCoordinator
        ├─ FrameSampler (fixed-rate; pluggable policy)
        ├─ ARFrameExtractor (lightweight RGB/depth/confidence/pose snapshot)
        ├─ BoundedFrameQueue (drops on backpressure — bounded RAM)
        ├─ CaptureFileStore  ── LOCAL DISK = SOURCE OF TRUTH
        └─ CaptureTransport (protocol)
               ├─ OfflineTransport      (no-op)
               └─ WiFiLaptopTransport   (URLSessionWebSocketTask -> laptop)
```

Design rules enforced in code:
- Heavy disk I/O never runs in the ARSession callback (serial writer thread).
- The queue is bounded; sustained backpressure drops sampled frames and counts
  them — RAM never grows without bound.
- Capture logic never depends on the laptop; the transport is swappable.
- The network references data already on disk, not large RAM buffers.

The pure-logic pieces live in `GauzensplatCaptureCore` and are compiled + tested
on the Mac (`swift run CoreCheck`), so the format/coordinate contract is verified
without a device and can't drift from the Python side.

## Capture format

Full spec: `tools/arkit_capture/FORMAT_SPEC.md`. One directory per recording:

```
capture_<ts>_<uuid>/
├── session.json          format_version, session_id, transform provenance
├── metadata.jsonl        one JSON object per accepted frame (append-only)
├── frames/000000.jpg     RGB (native ARKit geometry)
├── depth/000000.f32      little-endian float32, meters, row-major
├── confidence/000000.u8  uint8 ARConfidenceLevel 0/1/2
└── diagnostics/summary.json
```

Two independent versions: `capture_format_version` (files) and
`network_protocol_version` (wire). Parsers require mandatory fields, ignore
unknown optional fields, and warn on newer versions — old readers keep working
as fields like `rover_pose`, `scene_id`, IMU, exposure are added later.

## Coordinate conventions

- **Matrices are stored ROW-major** nested arrays. Swift `simd` is column-major
  internally; `MatrixSerialization` converts explicitly (`rows[r][c] == m[c][r]`)
  and a cross-language golden test pins the exact bytes.
- `camera_transform` is `ARCamera.transform` **RAW** (camera-to-world), never
  inverted / axis-flipped / COLMAP-converted / scale-normalised on the phone.
  Camera world position = translation column `[m03, m13, m23]`.
- **Depth unprojection** (ARKit camera space +x right, +y up, −z forward):
  ```
  x = (u-cx)/fx·d,  y = -(v-cy)/fy·d,  z = -d,  world = T·[x,y,z,1]
  ```
  Intrinsics scale RGB→depth by `sx=depth_w/img_w`, `sy=depth_h/img_h`.
  Sign conventions to confirm on device: a wall in front must render in front,
  upright, not mirrored (the inspector warns on exploding/degenerate geometry).

## Networking

- Transport: WebSocket for control/telemetry/odometry; bulk payloads are a
  `bulk_header` text frame + one binary frame (bounded memory, ordered per
  connection, stored by identity not arrival order).
- Every payload carries `session_id + frame_id + payload_type + sequence +
  byte_length + sha256`. Server writes temp → fsync → verify size+sha → rename →
  ACK. Duplicate `(frame_id, payload_type, sha)` is idempotent.
- Clock sync: NTP-like ping/pong; offset from min-RTT sample; raw device
  timestamps never overwritten (server stores raw + arrival + estimate + RTT).
- Security: server only writes inside its capture root; on-disk paths are derived
  from `frame_id + payload_type` (never client-supplied); session ids sanitized;
  unknown/traversal sessions rejected.

Fallback behavior (implemented + tested — see `simulate_phone.py`,
`test_phase5_reliability.py`): Wi-Fi loss → local recording continues, transport
goes offline, reconnect with backoff, resume same session, reconcile missing at
STOP. Server restart → index rebuilt from disk, no blind re-upload.

## Testing

```bash
# Python (stdlib unittest)
python -m unittest discover -s tools/arkit_capture/tests -t .
python -m unittest discover -s tools/live_capture_server/tests -t .
# Swift core (Command Line Tools OK)
cd ios && swift run CoreCheck
# Swift XCTest (full Xcode)
cd ios && swift test
# Live process end-to-end
python tools/live_capture_server/server.py --port 8790 &
python tools/live_capture_server/simulate_phone.py --port 8790 --frames 25 \
    --disconnect-after 10 --duplicate-every 6 --corrupt-every 8
python tools/live_capture_server/simulate_esp32.py --port 8790 --session <sid> \
    --path circle --rate 20 --duration 3 --fast
```

Three layers: (1) pure unit tests, (2) local simulated integration
(simulate_phone + simulate_esp32 + server), (3) real-device integration
(iPhone/ESP32 — awaiting hardware). See `IPHONE_LIDAR_CAPTURE_TEST_REPORT.md`.

## Export & Mac validation

`inspect_capture.py <capture>` writes `trajectory.csv`,
`trajectory_topdown.png`, `trajectory_3d.png`, `lidar_cloud.ply`,
`summary.json`, `validation.txt`. Options: `--conf {low,medium,high}`,
`--subsample K`, `--max-frames N`, `--max-depth M`. Confidence thresholding is a
Mac-side decision (raw confidence is preserved on the phone), so geometry
cleanliness vs coverage can be compared without recollecting data.

## Known failure modes & fallbacks

| Scenario | Behavior |
|---|---|
| Laptop absent / wrong IP | records locally; TEST CONNECTION fails cleanly |
| Wi-Fi drops mid-session | local recording continues; reconnect + resume; reconcile at STOP |
| Server crash/restart | reconnect w/ backoff; server rebuilds index from disk (no blind re-upload) |
| Slow server | bounded RAM, disk-referenced backlog grows, capture unaffected |
| Corrupt payload / checksum | server NACK; phone retries |
| Low storage | stop safely, flush, finalize, mark reason |
| App backgrounded / interrupted | pause/stop, flush, mark interrupted, session recoverable |
| Missing LiDAR on a frame | `depth_path=null`, `depth_status=unavailable`, RGB+pose kept |
| Tracking limited/lost | per-frame tracking_state saved; session not discarded |
| Glass/mirror/dark surfaces | raw noisy depth preserved; Mac confidence threshold guards the cloud |
| ESP32 absent | phone session unaffected; phone absent → odometry still testable |

## Future integration path

The data model is deliberately ready (do NOT build these now):
- **ARKit pose → Brush cameras**: raw camera-to-world transforms + intrinsics per
  frame already stored; convert to `transforms.json` off-device.
- **LiDAR → Brush init / points3D**: `unproject_frame` already yields metric
  world points → `init.ply`.
- **Pose-aware keyframes**: `FrameSampler` protocol accepts a future policy
  (translation/rotation/blur/coverage/tracking) with no recorder change.
- **Long captures → scene chunks**: stable `session_id`/`frame_id`/`timestamp`
  let tooling add `scene_id` without touching raw data.
- **Rover / SLAM secondary trajectory**: `/ws/odometry` + `rover/odometry.jsonl`
  + preserved raw+aligned timestamps + clock-sync records.
- **Person masks / audio**: add `masks/` + audio-timestamp fields as optional
  metadata; readers already ignore unknown fields.
