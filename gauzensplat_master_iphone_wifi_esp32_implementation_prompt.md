# Gauzensplat — End-to-End iPhone LiDAR + Local Wi-Fi Capture Pipeline

## MASTER IMPLEMENTATION INSTRUCTION

Implement the entire system described in this document, but **ONE PHASE AT A TIME**.

Do NOT try to build the iPhone recorder, Wi-Fi transport, Python ingest server, clock synchronization, ESP32 protocol, and all stress tests simultaneously.

The entire purpose of this plan is to build a trustworthy pipeline incrementally:

```text
PHASE 0
Repository + format contracts
        ↓ PASS

PHASE 1
Native iPhone ARKit + LiDAR capture
LOCAL STORAGE ONLY
        ↓ PASS

PHASE 2
Mac-side offline validation
trajectory + LiDAR point cloud
        ↓ PASS

PHASE 3
Phone ↔ laptop local Wi-Fi connection
health check + handshake + clock sync
NO bulk sensor streaming yet
        ↓ PASS

PHASE 4
Live iPhone sensor mirroring over Wi-Fi
RGB + pose + intrinsics + depth + confidence
while preserving authoritative local recording
        ↓ PASS

PHASE 5
Disconnect / retry / checksum / reconciliation
stress + corruption + long-run testing
        ↓ PASS

PHASE 6
ESP32-compatible odometry ingest
using simulator first
        ↓ PASS

PHASE 7
Full synchronized phone + odometry session
and final end-to-end validation
        ↓ PASS

FUTURE — NOT IN THIS TASK
real rover
Brush
Gaussian Splat reconstruction
scene chunking
person masking
audio
```

## ABSOLUTE PHASE-GATE RULE

For every phase:

```text
inspect
↓
implement smallest working slice
↓
write tests
↓
run tests
↓
fix failures
↓
run integration test
↓
write phase result
↓
ONLY THEN continue
```

If a phase fails:

> STOP advancing architecture and fix that phase first.

Do not hide test failures and continue.

Do not claim hardware tests were executed unless a physical iPhone was actually available.

When a phase requires the physical phone and you cannot run it yourself:

1. finish all automated tests;
2. provide the exact physical test I must run;
3. clearly mark the phase as `AWAITING_DEVICE_VALIDATION`;
4. structure the remaining code so later phases can still be tested with simulators where possible;
5. do not falsely mark the physical gate as passed.

## SOURCE OF TRUTH PRINCIPLE

The iPhone's local capture is ALWAYS authoritative.

```text
ARKit/LiDAR
↓
LOCAL PHONE STORAGE   ← source of truth
↓
background Wi-Fi mirror
↓
LAPTOP
```

Never make successful network delivery a requirement for recording.

If Wi-Fi fails:

```text
camera capture continues
LiDAR capture continues
ARKit poses continue
local files continue
network mirror goes offline
```

When Wi-Fi returns:

```text
reconnect
↓
compare manifests
↓
send missing payloads
↓
verify checksums
↓
complete synchronization
```

## TESTING PRINCIPLE

Testing is part of implementation, not cleanup.

Every new module must receive tests as it is introduced.

At the end of every phase create/update:

```text
IMPLEMENTATION_STATUS.md
```

with:

```text
phase
status
files changed
tests executed
tests passed
tests failed
hardware tests pending
known issues
next gate
```

The final system is only successful if we can prove:

```text
CAPTURE
→ LOCAL SAVE
→ READ BACK
→ TRAJECTORY
→ LIDAR CLOUD
→ NETWORK CONNECT
→ SEND
→ RECEIVE
→ CHECKSUM
→ STORE
→ RECONNECT
→ RECONCILE
→ RETRIEVE
→ SAME TRAJECTORY/LIDAR RESULT
→ ODOMETRY INGEST
→ TIMESTAMP ALIGNMENT
```

---

# REQUIRED PHASE-BY-PHASE EXECUTION

## PHASE 0 — Repository, contracts, and tests-first foundation

Before creating the iOS recorder:

1. inspect the existing Gauzensplat repository;
2. identify isolated locations for:
   - `ios/GauzensplatCapture/`
   - `tools/arkit_capture/`
   - `tools/live_capture_server/`
3. do NOT modify Brush/Hunyuan/current reconstruction paths;
4. define:
   - capture format version;
   - network protocol version;
   - matrix serialization convention;
   - depth binary format;
   - confidence format;
   - session/frame identity;
5. implement Python format readers;
6. create synthetic test fixtures;
7. test:
   - metadata parsing;
   - matrices;
   - depth decode;
   - confidence decode;
   - intrinsics scaling;
   - trajectory math;
   - point-cloud math.

### PHASE 0 GATE

Do not continue until all pure Python contract/math tests pass.

---

## PHASE 1 — Native iPhone capture, NO networking

Build the Xcode Swift/SwiftUI/ARKit application.

At this stage:

```text
DO:
RGB
ARKit pose
intrinsics
sceneDepth
confidence
timestamps
tracking state
local disk writer
bounded queues
START/STOP
manual export

DO NOT:
connect to laptop
WebSockets
HTTP uploads
ESP32
network clock sync
```

This isolates the most important question:

> Can the phone produce a correct and recoverable sensor dataset by itself?

### PHASE 1 automated tests

Test:

- matrix serialization;
- state machine;
- frame sampler;
- file naming;
- bounded writer queue;
- storage abstraction;
- missing depth;
- simulated interruptions;
- double START/STOP;
- partial session finalization.

### PHASE 1 physical tests

Run/document:

1. stationary 30 s;
2. straight path 2–5 m;
3. rectangular loop;
4. desk/table orbit;
5. tracking-loss scenario;
6. fast motion;
7. glass/mirror scene;
8. 2-minute recording;
9. 5-minute recording;
10. 10-minute recording if thermals/storage allow.

### PHASE 1 GATE

Do not add networking until:

- local session format is valid;
- recorder uses bounded RAM;
- no metadata corruption;
- START/STOP/finalization works;
- exported dataset can be parsed;
- physical device steps are documented;
- physical sensor validation is either PASSED or clearly marked awaiting my execution.

---

## PHASE 2 — Offline Mac reconstruction validation

Still NO networking.

Take exported capture and run:

```text
inspect_capture.py
```

Produce:

```text
trajectory.csv
trajectory_topdown.png
trajectory_3d.png
summary.json
lidar_cloud.ply
```

Validate:

- camera trajectory;
- metric scale plausibility;
- start/end drift;
- depth values;
- confidence distributions;
- point-cloud orientation;
- no mirror/upside-down transform bug.

### PHASE 2 tests

Use both:

```text
synthetic fixture
real exported phone fixture when available
```

### PHASE 2 GATE

Do not add Wi-Fi sensor streaming until the exact same stored sensor data can be read correctly on the Mac and produce a sensible trajectory/point cloud.

---

## PHASE 3 — Phone ↔ laptop connection only

Now add networking, but NOT bulk capture streaming yet.

Build:

```text
Python local server
GET /health
WebSocket control channel
iPhone TEST CONNECTION
protocol handshake
server session negotiation
ping/pong
RTT
clock-offset estimation
reconnect state
```

Phone UI should show:

```text
Server address
CONNECTED/OFFLINE
RTT
clock sync
```

### PHASE 3 tests

Test:

- correct IP;
- wrong IP;
- server absent;
- server starts after phone;
- server restart;
- Wi-Fi disappears;
- Wi-Fi returns;
- protocol mismatch;
- clean disconnect;
- high latency/jitter;
- injected clock offsets.

### PHASE 3 GATE

Do not stream sensor payloads until:

```text
phone → laptop → phone
```

round-trip communication is proven and reconnect logic is stable.

---

## PHASE 4 — Live sensor mirroring

Only now stream data.

For each locally persisted accepted frame, mirror:

```text
RGB
frame metadata
camera transform
intrinsics
depth
confidence
timestamps
```

The order is:

```text
capture
↓
LOCAL DURABLE WRITE
↓
network enqueue
↓
background transmit
```

Not:

```text
capture
↓
network first
↓
hope laptop receives it
```

### PHASE 4 tests

Run:

1. one-frame transfer;
2. byte-for-byte checksum comparison;
3. 100 frames;
4. out-of-order payload delivery;
5. duplicate payload;
6. slow server;
7. network backlog;
8. live dashboard;
9. inspector against server-received session.

### PHASE 4 GATE

The laptop-received capture must produce the same trajectory/point-cloud result as the authoritative phone capture for the same session.

---

## PHASE 5 — Reliability, retry, reconciliation, and stress

Add:

```text
payload IDs
checksums
ACK/NACK
idempotency
disk-backed pending uploads
reconnect backoff
manifest reconciliation
corruption handling
server write failure handling
```

At STOP:

```text
phone manifest
↓
server inventory
↓
missing/corrupt list
↓
retry
↓
final sync result
```

### PHASE 5 stress tests

Test:

- disconnect for 5 sec;
- disconnect for 30 sec;
- disconnect near STOP;
- server crash/restart;
- server disk error simulation;
- corrupted payload;
- duplicate retransmission;
- out-of-order payload;
- network slower than capture;
- artificial 50/100/250/500 ms latency;
- jitter;
- 10-minute simulated stream;
- 30-minute simulated stream;
- 5 Hz;
- 10 Hz;
- large network backlog;
- app interruption while backlog exists.

### PHASE 5 GATE

Require:

```text
local payload count = server payload count
missing = 0 after reconciliation
checksum failures = 0 after retries
duplicates do not create duplicate files
RAM remains bounded
```

for healthy final sessions.

---

## PHASE 6 — ESP32 protocol using simulator FIRST

Do not wait for physical ESP32.

Create:

```text
simulate_esp32.py
```

Default transport:

```text
WebSocket
```

Send versioned messages containing:

```text
session_id
device_id
sequence
device timestamp
odometry payload
```

Simulated trajectories:

```text
stationary
straight
square
circle
smooth random
```

Rates:

```text
1 Hz
10 Hz
20 Hz
50 Hz
100 Hz
```

### PHASE 6 tests

Test:

- connect/disconnect;
- sequence gaps;
- duplicate messages;
- out-of-order messages;
- high-rate stream;
- server restart;
- protocol mismatch;
- wrong session;
- clock offset;
- clock drift;
- jitter.

Store odometry independently:

```text
rover/odometry.jsonl
```

### PHASE 6 GATE

The future ESP32 must be able to replace the simulator without changing the server's session model.

---

## PHASE 7 — Complete synchronized session

Run together:

```text
iPhone / simulate_phone
+
simulate_esp32
+
Python server
```

Verify the server stores:

```text
phone RGB/depth/poses
+
odometry
+
clock-sync records
```

under one session.

Never destroy raw clocks.

Store:

```text
raw device timestamp
server arrival timestamp
estimated server-aligned timestamp
clock offset estimate
RTT/sync quality
```

### FINAL END-TO-END TEST

Prove:

```text
START SESSION
↓
phone captures locally
↓
phone mirrors to laptop
↓
odometry arrives
↓
network disconnect
↓
capture continues
↓
network reconnects
↓
backlog syncs
↓
STOP
↓
manifest reconciliation
↓
0 missing final payloads
↓
inspect laptop-received capture
↓
trajectory correct
↓
LiDAR cloud correct
↓
odometry available in same session
```

Only then mark the complete capture/transport foundation DONE.

---

# FUTURE INTEGRATION BOUNDARY

Stop after Phase 7.

Do NOT add in this task:

```text
real rover navigation
real ESP32 firmware unless explicitly requested later
Brush
COLMAP reconstruction
Gaussian Splatting
scene chunking
person masking
audio
generative AI
cloud backend
```

But ensure the resulting data model is ready for:

```text
ARKit pose → Brush camera
LiDAR → init.ply / points3D
person masks → masks/
long capture → scene segmentation
ESP32/SLAM → secondary trajectory
audio → timestamp alignment
```

---


You are implementing the **phone-only sensing foundation** for Gauzensplat.

This must be a **native iOS application built in Xcode using Swift + SwiftUI + ARKit**.

This is NOT a web application.

The application will be installed directly onto a physical iPhone 16 Pro through Xcode during development. Later it may be distributed through TestFlight or integrated into the main Gauzensplat app, so the architecture must be clean and scalable.

The immediate goal is:

> Hold an iPhone 16 Pro, walk around an environment, record synchronized RGB + ARKit camera poses + camera intrinsics + LiDAR scene depth + LiDAR confidence + timestamps, export the capture, and verify on the Mac that the recorded phone trajectory and LiDAR geometry are correct.

This is the sensing foundation for a future system where:

```text
iPhone mounted on autonomous rover
        ↓
continuous RGB + ARKit + LiDAR
        ↓
pose-aware keyframes
        ↓
scene segmentation
        ↓
Gaussian Splat reconstruction
        ↓
trip / venue memory scenes
        ↓
audio + photos + people + highlights
```

Do NOT implement the rover yet.
Do NOT implement Gaussian Splat reconstruction yet.
Do NOT implement Brush integration yet.

First build a trustworthy, scalable capture system.

---

# 1. CURRENT GAUZENSPLAT CONTEXT

Our current best reconstruction pipeline is:

```text
RGB
→ COLMAP cameras
→ sparse points
→ Brush
→ Gaussian Splat
```

Brush currently gives our best final reconstruction quality.

However, camera solving from sparse images is a major failure point.

The iPhone 16 Pro can potentially give us:

```text
RGB frames
ARKit camera poses
camera intrinsics
LiDAR depth
LiDAR confidence
timestamps
tracking quality
```

which may eventually replace much of the fragile camera-discovery pipeline.

Our existing research/audit also found that future integration should likely look approximately like:

```text
iPhone capture
↓
ARKit poses
+
LiDAR geometry
↓
Brush
```

with COLMAP potentially repositioned as optional pose refinement rather than the primary camera solver.

This project must therefore preserve sensor information in a way that can support those future stages.

---

# 2. PRIMARY OBJECTIVE

Build a standalone iOS capture application named:

```text
Gauzensplat Capture
```

The complete first workflow should be:

```text
Mac
↓
open Xcode project
↓
connect physical iPhone 16 Pro
↓
Build & Run
↓
Gauzensplat Capture installs on iPhone
↓
open application
↓
confirm ARKit + LiDAR are healthy
↓
press START
↓
walk around room / desk / venue
↓
press STOP
↓
export capture
↓
copy capture to Mac
↓
run Python validator
↓
inspect:
    camera trajectory
    path statistics
    LiDAR depth statistics
    LiDAR point cloud
```

The application must remain able to RECORD safely WITHOUT a network connection or laptop server.

For live development/rover workflows, it should additionally support a **local Wi-Fi connection to a Python server on the laptop**.

It must not require:

```text
App Store
cloud backend
cloud storage
internet access
authentication service
rover hardware
```

The local laptop server is optional for capture safety, but is a first-class supported transport for live streaming.

---

# 3. ENGINEERING GOAL

This is not a throwaway hack.

Build the capture layer as a **stable sensor-recording subsystem** that can later support:

```text
manual phone scanning
autonomous rover scanning
long captures
multiple scene chunks
real-time capture quality feedback
Gaussian Splat reconstruction
dynamic-person masking
audio synchronization
trip timelines
venue mapping
future TestFlight distribution
future cloud upload
```

Do not implement future features prematurely.

Design interfaces and file formats so they can be added later without rewriting the capture core.

---

# 4. ARCHITECTURE REQUIREMENT

Keep the system modular.

Suggested high-level structure:

```text
ios/
└── GauzensplatCapture/
    ├── App/
    ├── Capture/
    │   ├── ARSessionController
    │   ├── CaptureCoordinator
    │   ├── FrameSampler
    │   ├── FrameWriter
    │   └── CaptureSession
    ├── Sensors/
    │   ├── CameraData
    │   ├── DepthData
    │   ├── TrackingState
    │   └── SensorHealth
    ├── Storage/
    │   ├── CaptureManifest
    │   ├── MetadataWriter
    │   ├── SessionDirectory
    │   └── ExportManager
    ├── Math/
    │   ├── MatrixSerialization
    │   ├── IntrinsicsScaling
    │   └── TransformUtilities
    ├── UI/
    │   ├── CaptureView
    │   ├── DebugView
    │   └── SessionSummaryView
    └── Tests/
```

Mac tooling:

```text
tools/
└── arkit_capture/
    ├── inspect_capture.py
    ├── validate_capture.py
    ├── trajectory.py
    ├── pointcloud.py
    ├── formats.py
    └── tests/
```

Adjust names if needed, but preserve architectural separation.

---

# 5. XCODE PROJECT

This MUST be a native Xcode project.

Preferred stack:

```text
Swift
SwiftUI
ARKit
AVFoundation / CoreVideo where needed
Foundation
```

Avoid third-party iOS dependencies unless absolutely necessary.

The project must run on a real iPhone 16 Pro.

The iOS Simulator is NOT acceptable for LiDAR validation.

If the repository does not contain an iOS project:

1. create a new standalone iOS app under `ios/`
2. create the Swift source
3. configure camera permission
4. configure deployment target
5. document signing/development-team setup
6. make sure the project builds in Xcode

If programmatically creating the `.xcodeproj` is unsafe:

- do NOT create a broken Xcode project;
- create the complete source tree;
- provide exact Xcode project creation instructions;
- clearly identify any manual step remaining.

Prefer an actually-buildable Xcode project when possible.

---

# 6. ARKIT CONFIGURATION

Use:

```swift
ARWorldTrackingConfiguration
```

Check:

```swift
ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
```

If available:

```swift
configuration.frameSemantics.insert(.sceneDepth)
```

Raw `sceneDepth` is the reconstruction dataset.

`smoothedSceneDepth` may optionally be used for debugging visualization, but MUST NOT silently replace raw depth.

Fail gracefully if:

```text
ARKit world tracking unavailable
sceneDepth unsupported
camera permission denied
ARSession fails
```

---

# 7. DATA TO CAPTURE

For each selected frame, capture:

## Frame identity

```text
frame_id
timestamp
session-relative timestamp
```

## RGB

From:

```text
ARFrame.capturedImage
```

Store an RGB image corresponding exactly to the ARFrame.

Prefer preserving native frame geometry.

Do NOT arbitrarily crop, rotate, resize, or mirror unless metadata and intrinsics are transformed consistently.

## Camera

Store:

```text
ARCamera.transform
ARCamera.intrinsics
ARCamera.imageResolution
ARCamera.trackingState
tracking reason if available
```

Save `ARCamera.transform` RAW.

Do not invert it, convert it to COLMAP, flip axes, or normalize scale inside the phone app.

## LiDAR

From:

```text
ARFrame.sceneDepth
```

save:

```text
depthMap
confidenceMap
```

Depth must be saved numerically.

Store:

```text
depth width
depth height
depth pixel format
depth units
confidence format
```

---

# 8. CAPTURE FORMAT

Create a directory per recording:

```text
capture_<timestamp>_<uuid>/
│
├── session.json
├── metadata.jsonl
│
├── frames/
│   ├── 000000.jpg
│   ├── 000001.jpg
│   └── ...
├── depth/
│   ├── 000000.f32
│   ├── 000001.f32
│   └── ...
├── confidence/
│   ├── 000000.u8
│   ├── 000001.u8
│   └── ...
└── diagnostics/
```

Version the format:

```json
{
  "format_version": 1
}
```

Every future parser MUST check format version.

The schema must permit optional future fields without breaking old readers.

Future optional fields may include:

```text
rover_pose
robot_slam_pose
IMU
GPS
audio timestamp
person masks
scene IDs
keyframe score
exposure
white balance
camera lens
capture quality
loop closure information
```

The Python parser should require mandatory fields, ignore unknown optional fields, and warn on incompatible format versions.

---

# 9. METADATA RECORD

Each `metadata.jsonl` line should conceptually contain:

```json
{
  "format_version": 1,
  "frame_id": 12,
  "timestamp": 42.184,
  "session_time": 12.042,
  "rgb_path": "frames/000012.jpg",
  "depth_path": "depth/000012.f32",
  "confidence_path": "confidence/000012.u8",
  "image_width": 1920,
  "image_height": 1440,
  "depth_width": 256,
  "depth_height": 192,
  "depth_format": "float32_le",
  "depth_units": "meters",
  "confidence_format": "uint8",
  "camera_transform": [],
  "camera_intrinsics": [],
  "tracking_state": "normal"
}
```

Use actual values.

---

# 10. MATRIX SERIALIZATION — CRITICAL

Swift SIMD matrices are column-major internally.

JSON nested arrays are ambiguous.

Create explicit conversion functions so matrices are serialized as documented ROW arrays:

```text
[
  [m00, m01, m02, m03],
  [m10, m11, m12, m13],
  [m20, m21, m22, m23],
  [m30, m31, m32, m33]
]
```

Do the same for 3×3 intrinsics.

Include in `session.json`:

```json
{
  "camera_transform_source": "ARCamera.transform",
  "camera_transform_storage": "row-major nested arrays",
  "camera_transform_modified": false,
  "intrinsics_storage": "row-major nested arrays"
}
```

Add round-trip tests:

```text
Swift matrix
→ JSON
→ parsed matrix
→ equals original within tolerance
```

A coordinate-system bug invalidates the whole project.

---

# 11. FRAME SAMPLING

Do NOT save every ARFrame.

Create a dedicated `FrameSampler`.

Initial mode:

```text
fixed-rate
```

Default:

```text
5 Hz
```

Configurable:

```text
1 Hz
5 Hz
10 Hz
```

Design its interface so future policies can use:

```text
translation threshold
rotation threshold
blur score
overlap score
new coverage
tracking quality
scene change
```

without rewriting the recorder.

Keep policy separate from storage.

---

# 12. THREADING / PERFORMANCE

Never do heavy disk I/O directly in the ARSession callback.

Required design:

```text
ARSessionDelegate
↓
lightweight eligibility check
↓
safe data capture
↓
background serial writer queue
↓
disk
```

Prevent:

```text
UI blocking
ARSession blocking
unbounded queue growth
duplicate frame writes
concurrent metadata corruption
```

Use bounded memory.

---

# 13. BACKPRESSURE / STORAGE / INTERRUPTION FALLBACKS

## Writer backpressure

Use a bounded queue.

If it approaches capacity:

```text
skip new sampled frame
increment dropped-frame counter
show warning if sustained
```

Never let RAM grow indefinitely.

Track:

```text
frames_requested
frames_saved
frames_dropped_writer_backpressure
```

## Disk space

Check free disk before and during recording.

If storage becomes dangerously low:

```text
stop recording safely
drain/flush writes
finalize metadata
mark reason
show clear error
```

Do not intentionally fill the phone during testing; simulate destructive disk conditions via abstractions/mocks.

## App/AR interruptions

Handle:

```text
background
phone lock
ARSession interruption
camera unavailable
```

Safe default:

```text
pause/stop capture
flush writes
preserve valid session
mark interrupted
```

## Tracking loss

Store tracking state for every frame.

Suggested policy:

```text
normal → valid
limited → save/flag low quality
notAvailable → don't use as reconstruction keyframe
```

Do not discard the entire session.

## Missing LiDAR

If RGB+pose exist but `sceneDepth` is missing:

```text
save RGB + pose if policy permits
depth_path = null
depth_status = unavailable
```

Do not crash.

Future Gaussian Splat reconstruction may still use the frame.

---

# 14. DEPTH CONFIDENCE

Preserve original confidence values.

Do NOT filter low-confidence measurements on the phone.

Filtering belongs downstream.

Mac tools should support configurable confidence thresholds so we can compare geometry cleanliness vs coverage without recollecting data.

---

# 15. LIVE DEBUG UI

Show:

```text
Gauzensplat Capture

LiDAR
ACTIVE / UNAVAILABLE

AR Tracking
NORMAL / LIMITED / UNAVAILABLE

Depth
256 × 192

Valid depth
XX.X%

Confidence
Low XX%
Medium XX%
High XX%

Capture Rate
5 Hz

Recording
00:01:42

Frames Captured
510

Frames Dropped
2

Writer Queue
3 / 20

Storage Free
XX GB

[ START ]

[ STOP ]

[ EXPORT LAST CAPTURE ]
```

UI styling is secondary to trustworthy data.

Optionally show raw depth/confidence previews for debugging only.

---

# 16. SESSION STATE MACHINE

Use a clear state machine:

```text
idle
preparing
recording
stopping
completed
failed
```

Handle illegal actions:

```text
START twice
STOP while idle
EXPORT before finalization
failure during preparation
```

safely.

When START is pressed:

1. validate AR session
2. verify storage
3. create session directory
4. write session metadata
5. initialize writer
6. reset counters
7. record start time
8. enter recording

When STOP is pressed:

1. stop accepting new frames
2. enter stopping
3. drain queue
4. flush metadata
5. write summary
6. verify session
7. mark complete

---

# 17. EXPORT / TRANSFER MODES

Support TWO transfer modes:

## A. Live local-Wi-Fi streaming

During capture, mirror recorded data to the Python server running on the laptop.

## B. Manual export fallback

Use standard local iOS mechanisms:

```text
Files
share sheet
AirDrop
```

If needed, package the capture into a standard ZIP/archive.

There is NO cloud backend. The Python server is local to the user's LAN/hotspot.

Manual export must remain available even if live streaming fails.

---

# 18. MAC VALIDATOR

Create:

```text
tools/arkit_capture/inspect_capture.py
```

Usage:

```bash
python tools/arkit_capture/inspect_capture.py /path/to/capture
```

Generate:

```text
validation report
trajectory.csv
trajectory_3d.png
trajectory_topdown.png
lidar_cloud.ply
summary.json
```

Avoid heavy ML dependencies.

Validate:

```text
format version
JSONL integrity
unique IDs
monotonic timestamps
file existence
file sizes
matrix dimensions
finite matrices
depth dimensions
confidence dimensions
NaN/inf depth
tracking states
orphan files
truncated files
```

Classify issues:

```text
ERROR
WARNING
RECOVERABLE
```

Partial/incomplete captures should still be inspectable when possible.

---

# 19. INTRINSICS SCALING

RGB and depth dimensions differ.

For depth unprojection, scale intrinsics to depth resolution.

Conceptually:

```text
sx = depth_width / image_width
sy = depth_height / image_height

fx_d = fx * sx
fy_d = fy * sy
cx_d = cx * sx
cy_d = cy * sy
```

Verify exact ARKit assumptions against Apple's APIs/sample before relying on this.

Test:

```text
same-size
uniform scale
non-uniform scale
principal point scaling
invalid dimensions
```

---

# 20. CAMERA TRAJECTORY

Use raw ARKit camera transforms to generate:

```text
trajectory.csv
trajectory_topdown.png
trajectory_3d.png
```

Include:

```text
frame_id
timestamp
x
y
z
tracking_state
```

Mark START/END.

Calculate:

```text
duration
path length
net displacement
start→end distance
average velocity
max frame translation
max frame rotation
```

Flag suspicious transforms/timestamps.

Do not silently correct them.

---

# 21. BASIC LIDAR POINT CLOUD

For selected frames:

```text
depth pixel
↓
depth-resolution intrinsics
↓
camera-space XYZ
↓
ARKit camera transform
↓
world-space XYZ
```

Filter:

```text
invalid depth
confidence threshold
optional min/max range
spatial subsampling
```

Save:

```text
lidar_cloud.ply
```

Correct XYZ is the first priority.

Colorize only if the calibration is clearly correct.

Report:

```text
point count
bounding box
extent
median distance
```

Warn on likely mirrored/upside-down/exploding geometry.

---

# 22. TESTING PHILOSOPHY

Testing is NOT a final stage.

For every major module:

```text
implement
↓
unit test
↓
integration test
↓
continue
```

Do not finish the whole implementation before testing.

---

# 23. SWIFT UNIT TESTS

At minimum:

## Matrix serialization

```text
identity
translation
rotation
random rigid transforms
JSON round trip
```

## Intrinsics scaling

```text
same resolution
1920×1440 → depth resolution
uniform/non-uniform scale
invalid dimensions
```

## State machine

```text
valid transitions
double START
double STOP
STOP while idle
export before complete
preparation failure
```

## FrameSampler

```text
1/5/10 Hz
irregular timestamps
long pause
invalid timestamp
```

## Queue/backpressure

```text
writer faster than capture
writer slower than capture
queue full
drop counter
recovery
```

## File/session naming

```text
sequential IDs
UUID uniqueness
no overwrite
```

---

# 24. PYTHON UNIT TESTS

Test:

```text
metadata parsing
matrix parsing
matrix roundtrip fixtures
depth decode
confidence decode
wrong byte count
intrinsics scaling
depth unprojection
identity pose
known translated pose
trajectory length
start/end distance
PLY output
format versions
missing-depth optional frames
```

Use synthetic geometry.

For example:

```text
constant depth plane
+
known intrinsics
+
identity pose
→ expected plane
```

---

# 25. CROSS-LANGUAGE GOLDEN TEST

Create at least one fixture serialized by Swift and parsed by Python.

Verify:

```text
Swift matrix → Python matrix
Swift depth binary → Python values
Swift confidence binary → Python values
```

within tolerance.

This prevents iOS/Mac format disagreement.

---

# 26. SYNTHETIC INTEGRATION TEST

Create a tiny synthetic session:

```text
3 frames
known timestamps
known transforms
small depth maps
known confidence
```

Run the complete Mac inspection pipeline.

Assert:

```text
known trajectory
known path length
known point cloud
valid report
```

---

# 27. PHYSICAL DEVICE TEST MATRIX

Document and support these tests.

## A. Stationary — 30 sec

Expected:

```text
small trajectory drift
stable depth
no giant jumps
no corruption
```

## B. Straight line — 2–5 m

Expected:

```text
roughly straight metric trajectory
plausible distance
aligned LiDAR geometry
```

## C. Loop

Walk:

```text
forward
right
back
left
```

Expected:

```text
loop-like trajectory
measurable start/end drift
```

Do NOT hide drift.

## D. Orbit — 20–30 sec

Orbit desk/chair/table.

Expected:

```text
arc/orbit camera trajectory
recognizable LiDAR geometry
strong overlap
```

This should become the first later Brush dataset.

---

# 28. STRESS TESTS

## Recording duration

Test:

```text
30 sec
2 min
5 min
10 min
```

Measure:

```text
storage growth
frame counts
writer backlog
drops
metadata integrity
export reliability
memory behavior
```

Target: roughly linear disk growth and bounded memory.

## Capture rate

Test:

```text
5 Hz
10 Hz
```

Optionally higher only for engineering stress.

The system should drop sampled frames safely rather than crash.

## Rapid movement

Test:

```text
fast walking
fast pan
fast rotation
stop/start
```

Expected: tracking warnings/low-quality flags, not crashes.

## Low texture / bad lighting

Test:

```text
blank wall
plain hallway
dark corner
```

Expected: tracking degradation is recorded correctly.

## LiDAR-hard surfaces

Test:

```text
mirror
glass
window
shiny metal
dark material
```

Expected: invalid/noisy depth remains visible in raw data; confidence filtering prevents catastrophic point clouds.

Never invent replacement depth.

## Occlusion

Have a person walk through/stand in front.

We are NOT implementing person segmentation yet.

Capture must remain valid.

Document that future masking will be required.

## Interruptions

Test:

```text
lock phone
background app
AR interruption
permission denial
```

Expected: safe pause/stop and recoverable session.

## Storage pressure

Use mocks/test abstractions for destructive cases.

Test low storage before/during capture and write failures.

Expected: safe finalization, not corruption.

---

# 29. CORRUPTED DATA TESTS

Mac tools must detect:

```text
truncated metadata.jsonl
missing RGB
missing depth
missing confidence
wrong byte size
duplicate frame
bad JSON
NaN matrix
unsupported format version
```

Recover useful completed frames where possible.

Do not require perfection to recover partial sessions.

---

# 30. PERFORMANCE / SCALABILITY RULES

The phone recorder must:

```text
stream to disk
use bounded queues
use bounded RAM
append metadata incrementally
never reload entire recordings
```

30-second and 10-minute captures must use the same architecture.

Disk usage should be the primary scaling factor, not memory.

---

# 31. FUTURE ROVER SCALABILITY

Do NOT implement rover communication.

But preserve extension points for future optional metadata:

```json
{
  "rover": {
    "timestamp": null,
    "pose": null,
    "slam_confidence": null
  }
}
```

Do not generate fake values.

Future rover and ARKit clocks will require explicit timestamp synchronization.

Document this.

---

# 32. FUTURE SCENE CHUNKING

Long captures will eventually become:

```text
continuous recording
↓
scene A
scene B
scene C
↓
separate splats
```

Every raw frame must therefore retain stable:

```text
session_id
frame_id
timestamp
```

Future tooling should be able to add:

```text
scene_id
```

without modifying raw capture data.

Do NOT implement scene clustering now.

---

# 33. FUTURE BRUSH INTEGRATION

Preserve everything needed later to create:

```text
images/
masks/
transforms.json
init.ply / points3D
```

Conceptually:

```text
ARKit poses
→ Brush camera representation

LiDAR depth
→ fused metric point cloud
→ Brush initialization
```

Do NOT perform this conversion on the phone.

Raw ARKit data remains the source of truth.

---

# 34. FUTURE KEYFRAME SELECTION

The current fixed-rate sampler must later be replaceable with a policy using:

```text
translation
rotation
tracking quality
depth coverage
motion blur
new view coverage
scene change
```

Do not hardwire recording logic to only a timer.

---

# 35. PRIVACY / LOCAL-FIRST

This app records:

```text
camera imagery
environment geometry
possibly people
```

For this milestone:

```text
all data stays local
```

Do not upload anything.

Export happens only through explicit user action.

---

# 36. STRUCTURED LOGGING / SESSION SUMMARY

Log:

```text
session start/stop
tracking-state changes
depth availability changes
writer errors
frame drops
interruptions
storage warnings
export
```

Do not log raw sensor payloads.

Final session summary should include:

```text
duration
frames_considered
frames_saved
frames_dropped
frames_without_depth
tracking state counts
average valid depth %
storage bytes
recording status
interruption count
```

---

# 37. IMPLEMENTATION ORDER

Work in this order:

## Phase 1 — Inspect repository

Choose isolated locations.

Do not modify reconstruction code.

## Phase 2 — Define format first

Implement/document:

```text
session.json
metadata.jsonl
depth binary
confidence binary
```

Write Python parsers/tests first.

## Phase 3 — Math

Implement/test:

```text
matrix serialization
intrinsics scaling
trajectory extraction
depth unprojection
```

## Phase 4 — Xcode / ARKit app

Implement ARKit session + sceneDepth + health UI.

## Phase 5 — Recorder

Implement sampler, state machine, background writer.

Run tests immediately.

## Phase 6 — Reliability

Backpressure, storage, interruptions, missing depth.

Run edge-case tests.

## Phase 7 — Export

Implement local export.

## Phase 8 — Mac inspector

Validation, trajectory, point cloud.

## Phase 9 — Automated stress tests

Run all non-device tests.

## Phase 10 — Device handoff

Provide exact iPhone test workflow.

---

# 38. NON-GOALS

Do NOT implement:

```text
web app
rover hardware
robot SLAM
Bluetooth rover control
Raspberry Pi
COLMAP reconstruction
Brush training
Gaussian Splatting
HunyuanWorld
Depth Anything
GLUEMAP
SAM
person segmentation
generative AI
cloud backend
accounts
authentication
trip gallery
audio pipeline
```

This milestone is ONLY:

```text
native iPhone sensor capture
+
robust local export
+
Mac verification
```

---

# 39. DOCUMENTATION DELIVERABLES

Create:

```text
IPHONE_LIDAR_CAPTURE.md
IPHONE_LIDAR_CAPTURE_TEST_REPORT.md
```

The main documentation must cover:

```text
Xcode setup
physical iPhone deployment
architecture
capture format
coordinate conventions
testing
export
Mac validation
known failure modes
future Brush integration
future rover integration
```

The test report must clearly distinguish:

```text
automated tests actually run
stress tests actually run
tests that require a physical iPhone
known failures
fallback behavior
```

Do not claim a hardware test passed unless physically run.

---

# 40. EXACT USER SETUP EXPERIENCE

README instructions should be approximately:

```text
1. Open ios/GauzensplatCapture/GauzensplatCapture.xcodeproj in Xcode.

2. Connect iPhone 16 Pro.

3. Select iPhone as run destination.

4. Configure development team/signing.

5. Enable Developer Mode if required.

6. Press Run.

7. Xcode installs Gauzensplat Capture onto the phone.

8. Launch app.

9. Confirm:
   LiDAR ACTIVE
   Tracking NORMAL

10. Press START.

11. Walk around environment.

12. Press STOP.

13. Export through Files/AirDrop/share sheet.

14. On Mac:

python tools/arkit_capture/inspect_capture.py <capture>

15. Inspect:

trajectory_topdown.png
trajectory_3d.png
trajectory.csv
lidar_cloud.ply
summary.json
```

---

# 41. ACCEPTANCE CHECKLIST

## Xcode

- [ ] native project exists
- [ ] builds if toolchain available
- [ ] Swift + SwiftUI + ARKit
- [ ] real-device target supported
- [ ] camera permission configured

## Capture

- [ ] RGB saved
- [ ] raw ARKit camera transform saved
- [ ] intrinsics saved
- [ ] sceneDepth saved
- [ ] confidence saved
- [ ] timestamps saved
- [ ] tracking state saved

## Reliability

- [ ] bounded writer queue
- [ ] dropped-frame fallback
- [ ] low-storage fallback
- [ ] interruption fallback
- [ ] missing-depth fallback
- [ ] safe capture state machine
- [ ] partial-session recovery

## Format

- [ ] versioned
- [ ] extensible
- [ ] documented
- [ ] incrementally written

## Mac

- [ ] validator
- [ ] trajectory CSV
- [ ] trajectory plots
- [ ] path metrics
- [ ] depth/confidence stats
- [ ] point cloud
- [ ] corruption detection

## Tests

- [ ] Swift unit tests
- [ ] Python unit tests
- [ ] cross-language golden tests
- [ ] synthetic integration capture
- [ ] automated edge-case tests
- [ ] stress-test procedures

---

# 42. FINAL REPORT

After implementation return:

## Files created

## Files modified

## Architecture

## Build status

State exactly what compiled.

## Automated test results

Provide actual pass/fail counts.

## Stress-test results

Only claim what was actually executed.

## Physical iPhone tests remaining

Clearly separate from completed tests.

## How to run in Xcode

## How to record

## How to export

## How to inspect on Mac

## Output files

## Known limitations

## Fallback behaviors

## Future scaling path

Explain specifically how this foundation later supports:

```text
ARKit → Brush cameras
LiDAR → Brush initialization
pose-aware keyframes
long recordings → scene chunks
future rover SLAM → optional secondary trajectory
person masks
audio synchronization
```

---

# 43. DEFINITION OF SUCCESS

The project succeeds when I can physically do this:

```text
Mac
↓
Xcode
↓
install Gauzensplat Capture on iPhone 16 Pro
↓
open app
↓
LiDAR ACTIVE
↓
START
↓
walk around desk / room
↓
STOP
↓
EXPORT
↓
Mac
↓
python inspect_capture.py <session>
↓
see trajectory matching my physical movement
↓
see recognizable LiDAR geometry
```

Only after this is trustworthy will we integrate it with Gaussian Splatting.

Do not skip validation to jump ahead.


---

# 44. LOCAL WI-FI STREAMING — REQUIRED ADDITION

The previous capture-only design is not enough.

I also want to test the complete **send + receive + persistence path between the phone and laptop over local Wi-Fi**.

Future topology:

```text
                        LOCAL WI-FI LAN
                 (router / travel router / hotspot)
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
        iPhone 16 Pro      Mac laptop        ESP32
        ARKit + LiDAR      Python server      odometry
             │                ▲                │
             └──── RGB/depth ─┤                │
                  poses/meta  │                │
                              ├──── odometry ───┘
                              │
                              ▼
                    synchronized session
```

For the current milestone, the ESP32 hardware may not physically exist yet.

Therefore:

- implement the laptop server interfaces now;
- implement a Python ESP32 simulator;
- make the real ESP32 a future drop-in client.

The iPhone recording app must work both:

```text
OFFLINE:
iPhone records locally only

ONLINE:
iPhone records locally
+
mirrors data to laptop live
```

The LOCAL copy is always the source of truth.

Wi-Fi must NEVER be required for the camera/LiDAR recorder to keep functioning.

---

# 45. NETWORK TOPOLOGY

All participating devices must be on the same local IP network.

Supported development topology:

```text
Option A — preferred:
Mac + iPhone + future ESP32
→ same normal Wi-Fi router / travel router

Option B:
Mac-hosted/local hotspot where practical
→ iPhone + ESP32 join it

Option C:
another local LAN providing peer-to-peer IP connectivity
```

Do not depend on internet connectivity.

Do not assume cloud DNS.

Do not hardcode a developer-machine IP address.

For V1, support:

```text
manual server URL/IP entry
```

for example conceptually:

```text
http://192.168.x.x:8765
```

Persist the last successful server address locally.

If straightforward and reliable, add OPTIONAL Bonjour/mDNS discovery later behind the same connection interface, but do not block the milestone on it.

The iOS app must include the appropriate Local Network privacy usage description required for direct local-network communication.

---

# 46. TRANSPORT ARCHITECTURE

Do NOT put all networking directly inside ARSessionController.

Create a transport abstraction.

Suggested shape:

```text
CaptureCoordinator
│
├── LocalCaptureStore
│
└── CaptureTransport
      ├── OfflineTransport
      └── WiFiLaptopTransport
```

Conceptually:

```swift
protocol CaptureTransport {
    func connect() async throws
    func beginSession(_ session: ...)
    func enqueue(...)
    func endSession(...)
    func disconnect()
}
```

The exact Swift API may differ.

The critical rule is:

> Capture logic must not care whether the laptop exists.

Future transports may include:

```text
local Wi-Fi
cloud upload
rover/Raspberry Pi
USB
```

without rewriting ARKit capture.

---

# 47. RECOMMENDED NETWORK PROTOCOL SPLIT

Use a reliable protocol first.

Recommended V1:

```text
WebSocket:
    connection lifecycle
    handshake
    heartbeat
    clock sync
    server status
    live telemetry
    control messages
    ESP32 odometry

HTTP POST or equivalent reliable request/response upload:
    RGB keyframes
    depth files
    confidence files
    metadata bundles
    optional video segments
```

A single WebSocket for all binary payloads is also acceptable if the implementation is demonstrably bounded-memory and robust, but prefer separating control/telemetry from larger bulk payloads.

Do NOT use raw UDP for critical iPhone capture data.

For ESP32 odometry:

```text
V1 default = WebSocket
```

because it provides:

```text
ordering
connection state
easy reconnection
simple acknowledgements
```

Architect the laptop odometry receiver so a future UDP transport can be added.

Optionally implement a UDP receiver now ONLY if cleanly isolated and tested.

UDP odometry must include:

```text
sequence number
device timestamp
session ID
```

so packet loss/reordering can be measured.

Do not assume UDP delivery.

---

# 48. PYTHON LAPTOP SERVER

Create a local Python server, for example:

```text
tools/live_capture_server/
```

Suggested modules:

```text
server.py
session_manager.py
phone_protocol.py
odometry_protocol.py
clock_sync.py
storage.py
models.py
dashboard.py
tests/
simulate_phone.py
simulate_esp32.py
```

A framework such as FastAPI is acceptable if dependency cost is reasonable.

The server should bind to:

```text
0.0.0.0:<configurable-port>
```

for LAN access.

Default port may be:

```text
8765
```

but keep it configurable.

On startup print clearly:

```text
Gauzensplat Live Capture Server

Listening:
http://<LAN-IP>:8765

Phone WebSocket:
ws://<LAN-IP>:8765/ws/phone

ESP32 WebSocket:
ws://<LAN-IP>:8765/ws/odometry
```

If the Mac firewall blocks access, document the user-facing fix.

---

# 49. SERVER HEALTH / CONNECTION TEST

Implement a basic endpoint:

```text
GET /health
```

Response conceptually:

```json
{
  "status": "ok",
  "server_time_ns": 123,
  "protocol_version": 1
}
```

The iPhone app should have a connection panel:

```text
Laptop Server

Address:
[ 192.168.1.20:8765 ]

[ TEST CONNECTION ]

Status:
CONNECTED

RTT:
8 ms

Clock offset:
+1.4 ms
```

The test must verify actual two-way communication.

Do NOT display CONNECTED solely because a socket object was created.

Connection test success means:

```text
phone sends request/ping
↓
laptop receives
↓
laptop responds
↓
phone validates response
```

---

# 50. PROTOCOL VERSIONING

Network messages must be versioned.

Every handshake should include something like:

```json
{
  "protocol_version": 1,
  "client_type": "iphone",
  "device_session_id": "...",
  "app_version": "..."
}
```

Server must reject unsupported major protocol versions clearly.

This is separate from the capture-file `format_version`.

Maintain:

```text
capture_format_version
network_protocol_version
```

as distinct concepts.

---

# 51. SESSION NEGOTIATION

When live recording starts:

```text
iPhone
↓
BEGIN_SESSION
↓
laptop
↓
server_session_id + acknowledgement
```

Associate all incoming data with:

```text
session_id
```

The same session should later contain:

```text
phone frames
ARKit poses
LiDAR
future ESP32 odometry
future rover metadata
```

The server creates a session directory immediately.

Example:

```text
live_sessions/
└── <session_id>/
    ├── phone/
    │   ├── frames/
    │   ├── depth/
    │   ├── confidence/
    │   └── metadata.jsonl
    ├── rover/
    │   └── odometry.jsonl
    ├── sync/
    │   └── clock_sync.jsonl
    └── server_session.json
```

Keep this compatible with or convertible to the phone's local capture format.

---

# 52. LOCAL-FIRST MIRRORING

For every accepted capture frame:

```text
ARFrame accepted
↓
write local phone files
↓
enqueue network transfer reference
↓
continue capture
```

Networking must NEVER block the ARKit callback.

If the laptop is connected:

```text
upload in background
```

If disconnected:

```text
leave data safely on phone
mark pending upload
continue recording
```

The network queue should reference data already persisted on disk where practical rather than holding large depth/RGB buffers indefinitely in RAM.

---

# 53. NETWORK BACKPRESSURE

Maintain a bounded in-memory upload queue.

If the laptop becomes slow:

```text
capture continues locally
network backlog grows on disk
RAM stays bounded
```

Do NOT drop the local capture merely because live transmission is slow.

Possible network states:

```text
connected
degraded
offline
reconnecting
syncing_backlog
```

Show them in the phone UI.

Track:

```text
network_items_pending
network_bytes_pending
network_items_sent
network_items_acked
network_retries
```

---

# 54. FRAME / PAYLOAD IDENTITY

Every transmitted object must be independently identifiable.

For example:

```text
session_id
frame_id
payload_type
sequence
timestamp
byte_length
checksum
```

Payload types might include:

```text
rgb
depth
confidence
frame_metadata
video_segment
session_manifest
```

Do not infer file identity solely from network arrival order.

---

# 55. CHECKSUMS AND ACKNOWLEDGEMENTS

For each bulk payload, calculate a checksum such as SHA-256.

Phone sends:

```text
frame 52 depth
byte_count
checksum
```

Server writes atomically:

```text
temporary file
↓
verify size/checksum
↓
rename to final path
↓
ACK
```

Phone only marks a payload delivered after receiving ACK.

Duplicate upload of the same:

```text
session_id + frame_id + payload_type + checksum
```

must be IDEMPOTENT.

It must not create duplicate data.

---

# 56. RETRY / RECONNECT

When Wi-Fi disappears:

```text
phone local recording continues
↓
network transport enters offline
↓
periodic reconnect with backoff
↓
server available
↓
re-handshake
↓
resume pending uploads
```

Use bounded/exponential backoff rather than rapid reconnect loops.

Do not lose unsent files.

Do not re-upload the whole session blindly.

---

# 57. END-OF-SESSION RECONCILIATION

At STOP:

```text
phone finalizes local session
↓
phone sends session manifest
↓
server compares received payloads
↓
server responds with missing/corrupt items
↓
phone retries missing items
```

Generate a reconciliation result:

```text
local_frames: 600
server_frames: 600
missing: 0
checksum_failures: 0
```

If network is unavailable:

```text
recording still completes locally
live_mirror_status = incomplete
```

Later reconnect/export can finish synchronization.

This is the key proof that SEND + RETRIEVAL are correct.

---

# 58. CONTINUOUS VIDEO

The primary reconstruction input remains timestamped ARKit RGB/keyframes.

If continuous video is also implemented:

```text
do NOT attempt to send an uncompressed 60-FPS pixel stream
```

Encode video efficiently using Apple's native media APIs.

Prefer segmented compressed video, for example conceptually:

```text
video/
    segment_000001.*
    segment_000002.*
```

with:

```text
segment start timestamp
segment end timestamp
frame/time mapping where available
```

Transmit completed segments asynchronously.

The video writer must use the ARKit image stream or another architecture that does NOT fight ARKit for camera ownership.

If robust continuous-video recording materially expands scope, implement the transport/protocol support and document it as the next step; do NOT destabilize RGB+pose+LiDAR capture.

At minimum V1 live streaming MUST support every saved reconstruction keyframe:

```text
RGB
pose
intrinsics
depth
confidence
timestamps
```

---

# 59. ESP32 / FUTURE ROVER ODOMETRY

The ESP32 will connect to the SAME local Wi-Fi network.

Default V1 transport:

```text
WebSocket
```

Suggested endpoint:

```text
/ws/odometry
```

Each odometry record should contain at minimum:

```json
{
  "protocol_version": 1,
  "type": "odometry",
  "session_id": "...",
  "device_id": "...",
  "sequence": 42,
  "device_time_us": 123456789,
  "payload": {}
}
```

Do NOT invent exact wheel/pose fields before the hardware teammate finalizes them.

Support a generic/versioned payload.

Document expected future fields such as:

```text
x_m
y_m
yaw_rad
linear_velocity
angular_velocity
wheel_ticks
IMU
SLAM pose
confidence
```

but keep them optional.

---

# 60. ESP32 SIMULATOR — REQUIRED NOW

Because the hardware is not available, implement:

```text
simulate_esp32.py
```

It should connect to the same server as a real future ESP32 and emit synthetic timestamped odometry.

Configurable rates:

```text
1 Hz
10 Hz
20 Hz
50 Hz
100 Hz
```

Simulated paths:

```text
stationary
straight line
square
circle
random smooth path
```

This lets us fully test:

```text
server connection
WebSocket reception
timestamps
sequence numbers
storage
dashboard
clock synchronization
session association
```

before the real ESP32 exists.

---

# 61. CLOCK SYNCHRONIZATION — CRITICAL

Do NOT directly compare:

```text
ARFrame.timestamp
ESP32 micros()
Mac monotonic clock
```

as if they share an epoch.

They do not.

Preserve ALL raw device timestamps.

Also establish a laptop-server time mapping.

Use an NTP-like ping/pong exchange.

Conceptually:

```text
client send at t0_client
server receive t1_server
server respond at t2_server
client receive t3_client
```

Estimate:

```text
RTT
clock offset
```

Repeat periodically.

Store clock-sync samples.

For each device maintain:

```text
raw_device_timestamp
estimated_server_time
clock_offset_estimate
sync_quality / RTT
```

Never overwrite raw timestamps with adjusted values.

This becomes essential when later matching:

```text
RGB frame
LiDAR
ARKit pose
ESP32 odometry
audio
```

---

# 62. CLOCK SYNC TESTING

Test with synthetic clients where known offsets are injected.

Examples:

```text
client clock +250 ms
client clock -3 sec
slowly drifting clock
jittery 5–100 ms network latency
```

Verify the server estimates offset within a reasonable tolerance.

Test that high-RTT samples are down-weighted/rejected if you implement filtering.

Do not claim millisecond-level synchronization without measuring it.

---

# 63. REAL-TIME LAPTOP DASHBOARD

Create a simple local diagnostic page or terminal dashboard.

It should show:

```text
Session: <id>

PHONE
Connected: yes
Last frame: 000521
Capture rate: 5.0 Hz
Receive rate: 4.9 Hz
Network: 12 Mbps
Pending: 4
RTT: 9 ms
Clock offset: ...

Depth available: 99.2%
Tracking normal: 97%

ESP32
Connected: simulated / real
Odometry rate: 20 Hz
Last sequence: 1841
Packets/messages missed: 0
Clock offset: ...

SERVER
Stored frames: 517
Bytes written: ...
Errors: 0
```

Optional:

```text
latest RGB thumbnail
top-down ARKit trajectory
top-down odometry trajectory
```

Do not spend excessive time styling.

This is an engineering observability surface.

---

# 64. PHONE NETWORK UI

Add:

```text
Laptop server address
TEST CONNECTION
connect/disconnect
connection status
RTT
clock sync status
bytes sent
pending uploads
last acknowledged frame
```

Recording must still be possible when:

```text
Laptop: OFFLINE
```

Make the distinction clear:

```text
Capture: RECORDING
Laptop mirror: OFFLINE
```

instead of failing the whole capture.

---

# 65. SERVER-SIDE LIVE DATA VERIFICATION

As frames arrive, verify:

```text
session ID valid
frame ID valid
payload length
checksum
metadata parse
depth dimensions
confidence dimensions
duplicate identity
```

Reject malformed payloads with an explicit error response.

Do not write corrupted data as valid capture files.

---

# 66. NETWORK TEST MATRIX

Testing must be implemented THROUGHOUT, not after.

## Test A — health handshake

```text
phone/simulator → server /health
server response verified
```

## Test B — WebSocket handshake

Verify:

```text
connect
protocol version
client identity
session negotiation
ping/pong
clean close
```

## Test C — one frame end-to-end

Send synthetic:

```text
RGB
depth
confidence
metadata
```

Verify byte-for-byte/checksum equality on laptop.

## Test D — 100 frames

Send 100 synthetic frames.

Verify:

```text
100 local expected
100 server received
0 duplicates
0 missing
checksums match
```

## Test E — duplicate delivery

Send same payload twice.

Server should store one canonical object and ACK both idempotently.

## Test F — out-of-order delivery

Deliver frame 12 before frame 11.

Server must store correctly using identity, not arrival order.

## Test G — disconnect mid-frame/session

Break connection.

Verify:

```text
phone keeps local capture
reconnect
resume
manifest reconciliation
server ends complete
```

## Test H — server restart

Kill/restart Python server during recording.

Phone must reconnect and recover pending uploads.

## Test I — slow laptop

Artificially delay server writes.

Verify network backlog grows without ARKit capture crashing.

## Test J — high latency / jitter

Inject artificial server delay.

Measure RTT and sync quality.

## Test K — corruption

Alter a payload/checksum.

Server must reject it and phone must retry.

## Test L — long mirror session

Run simulated stream for:

```text
10 min
30 min
```

without unbounded memory growth.

---

# 67. BANDWIDTH STRESS TESTS

Measure approximate bandwidth for:

```text
1 Hz
5 Hz
10 Hz
```

of:

```text
JPEG
depth Float32
confidence
metadata
```

Report:

```text
bytes/sec
MB/min
GB/hour estimate
```

Do not guess.

Measure from test data.

Test throttled server throughput.

System should degrade as:

```text
network mirror falls behind
→ local recording remains healthy
```

rather than:

```text
network slow
→ ARKit recorder collapses
```

---

# 68. NETWORK FAILURE FALLBACK TABLE

Document and implement:

| Scenario | Required behavior |
|---|---|
| laptop absent at START | record locally, show mirror offline |
| wrong laptop IP | connection test fails cleanly |
| Wi-Fi disconnect | local recording continues |
| server crash | reconnect with backoff |
| server disk full | server NACK/error; phone retains local copy |
| payload checksum mismatch | retry |
| duplicate payload | idempotent ACK |
| slow server | bounded RAM, disk-backed pending queue |
| phone app interruption | finalize local session safely |
| session reconnect | resume same session |
| clock-sync failure | preserve raw timestamps; mark sync degraded |
| ESP32 absent | phone session still works |
| phone absent | ESP32 server ingestion can still be tested |
| ESP32 packets/messages lost | detect using sequence numbers |

---

# 69. OPTIONAL UDP ODOMETRY PATH

WebSocket is the default.

If UDP is implemented:

Laptop should listen on a configurable UDP port.

Every datagram must include:

```text
protocol_version
session_id
device_id
sequence
device_timestamp
payload
```

Server tracks:

```text
received
missing sequence numbers
duplicates
out-of-order
estimated packet loss
```

UDP data is best-effort.

Do NOT implement acknowledgements/retransmission that accidentally recreate TCP unless there is a specific reason.

Keep UDP behind the same odometry-ingestion abstraction so ESP32 transport can change later.

---

# 70. LOCAL NETWORK SECURITY SCOPE

This is a development/local-hardware system.

Do not build account authentication yet.

However:

- bind only as intended;
- clearly show the server address;
- use a random session token or pairing token if simple;
- reject data for unknown/nonexistent sessions;
- sanitize file/path identifiers;
- NEVER allow client-provided arbitrary filesystem paths;
- write only inside the configured capture root.

The server must not become an arbitrary file-write endpoint.

---

# 71. TEST WITHOUT THE IPHONE

Create:

```text
simulate_phone.py
```

It should emit the SAME network protocol as the iOS app.

Generate synthetic:

```text
RGB files
depth
confidence
metadata
poses
```

This allows end-to-end laptop server testing before Xcode/device testing.

Support:

```text
--frames
--rate
--disconnect-after
--reconnect-after
--corrupt-every
--duplicate-every
--latency
```

or equivalent test controls.

Do not maintain a separate fake protocol.

Simulator and iPhone must share the documented protocol contract.

---

# 72. THREE-LAYER TESTING

The complete system should have:

## Layer 1 — pure unit tests

```text
protocol serialization
checksums
clock math
session state
storage
```

## Layer 2 — local simulated integration

```text
simulate_phone
+
simulate_esp32
+
Python server
```

Run automatically on the Mac.

## Layer 3 — real-device integration

```text
iPhone 16 Pro
+
Python server
```

Later:

```text
ESP32
+
same server
```

Do not require physical hardware for Layers 1–2.

---

# 73. FIRST REAL WI-FI ACCEPTANCE TEST

On Mac:

```text
python tools/live_capture_server/server.py
```

Server prints LAN IP.

On iPhone:

```text
open Gauzensplat Capture
enter laptop server IP
tap TEST CONNECTION
```

Expected:

```text
CONNECTED
RTT visible
clock sync healthy
```

Press START.

Walk around desk for ~30 seconds.

Laptop dashboard should update live:

```text
frames increasing
depth arriving
camera pose arriving
bytes increasing
```

Press STOP.

Expected reconciliation:

```text
Phone local frames: N
Laptop frames: N
Missing: 0
Checksum failures: 0
```

Then run the existing/offline inspector against the LAPTOP'S received session:

```text
python tools/arkit_capture/inspect_capture.py <server-session>
```

It must produce the same:

```text
trajectory
depth stats
lidar_cloud.ply
```

without manually AirDropping the capture.

This verifies:

```text
CAPTURE
+
SEND
+
RECEIVE
+
STORE
+
RETRIEVE
+
RECONSTRUCT BASIC GEOMETRY
```

end-to-end.

---

# 74. FULL FUTURE DATA FLOW

Design toward this eventual topology:

```text
                        ┌────────────────────┐
                        │   iPhone 16 Pro    │
                        │                    │
                        │ RGB / video        │
                        │ ARKit pose         │
                        │ intrinsics         │
                        │ LiDAR + confidence │
                        │ timestamps         │
                        └─────────┬──────────┘
                                  │
                             local Wi-Fi
                                  │
                                  ▼
┌──────────────┐          ┌───────────────────┐
│    ESP32     │          │   Laptop Server   │
│              │─────────▶│                   │
│ odometry     │  Wi-Fi   │ session ingest    │
│ IMU later    │          │ time alignment    │
│ SLAM later   │          │ local storage     │
└──────────────┘          │ live diagnostics  │
                          └─────────┬─────────┘
                                    │
                                    ▼
                          synchronized capture
                                    │
                                    ▼
                         future scene/keyframes
                                    │
                                    ▼
                             future Brush
                                    │
                                    ▼
                          Gaussian memory scene
```

Do NOT implement Brush or rover control now.

But do not create any transport/session design that blocks this path.

---

# 75. UPDATED DEFINITION OF SUCCESS

The milestone succeeds when I can do BOTH offline and online workflows.

## Offline

```text
iPhone records
↓
STOP
↓
manual export
↓
Mac inspector
↓
correct trajectory + LiDAR cloud
```

## Live Wi-Fi

```text
Mac runs Python server
↓
iPhone connects over same local Wi-Fi
↓
connection test passes
↓
clock sync measured
↓
START
↓
phone saves locally + streams
↓
laptop receives live RGB/depth/pose
↓
STOP
↓
manifest reconciliation reports complete
↓
Mac inspector runs directly on received session
↓
correct trajectory + LiDAR cloud
```

And without ESP32 hardware:

```text
simulate_esp32.py
↓
same Wi-Fi/server protocol
↓
timestamped odometry received
↓
stored under same session
↓
sequence loss + rate + clock sync visible
```

Only after this foundation is reliable should we plug in the real ESP32/rover and Gaussian Splat reconstruction.
