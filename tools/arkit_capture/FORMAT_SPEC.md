# Gauzensplat Capture Format Contract

Single source of truth for the on-disk capture format and the Wi-Fi wire
protocol. Enforced by `tools/arkit_capture/formats.py` (Python) and mirrored by
the iOS `Math/MatrixSerialization.swift` + `Storage/MetadataWriter.swift`.

Two **independent** version numbers:

| Concept | Constant | Value |
|---|---|---|
| On-disk capture schema | `CAPTURE_FORMAT_VERSION` | 1 |
| Wi-Fi wire protocol | `NETWORK_PROTOCOL_VERSION` | 1 |

Every parser MUST check `format_version` and warn (not crash) on a newer major
version. Unknown optional fields MUST be preserved/ignored, never rejected.

## Capture directory layout

```
capture_<timestamp>_<uuid>/
├── session.json          # one object, session-level metadata
├── metadata.jsonl        # one JSON object per accepted frame (append-only)
├── frames/000000.jpg     # RGB, native ARKit capturedImage geometry
├── depth/000000.f32      # little-endian float32, row-major, meters
├── confidence/000000.u8  # uint8, row-major, ARConfidenceLevel 0/1/2
└── diagnostics/          # logs, summary.json (written at finalize)
```

## Matrix serialization — CRITICAL

Swift SIMD matrices are **column-major** internally. To remove all ambiguity,
matrices are serialized as **row-major nested arrays**:

```
[[m00, m01, m02, m03],
 [m10, m11, m12, m13],
 [m20, m21, m22, m23],
 [m30, m31, m32, m33]]
```

- `camera_transform` — 4×4 `ARCamera.transform`, **camera-to-world**, stored
  RAW. Never inverted, axis-flipped, COLMAP-converted, or scale-normalised on
  the phone. `session.json.camera_transform_modified == false`.
- `camera_intrinsics` — 3×3, same row-major convention, at RGB resolution.
- Camera world position = translation column = `[m03, m13, m23]`.

## Depth binary (`.f32`)

- little-endian `float32`, row-major, length = `depth_width * depth_height`.
- units: **meters**, positive distance from the camera.
- `depth_format = "float32_le"`, `depth_units = "meters"`.
- Raw `sceneDepth` only. `smoothedSceneDepth` is never silently substituted.

## Confidence binary (`.u8`)

- `uint8`, row-major, length = `depth_width * depth_height`.
- `ARConfidenceLevel`: `0 = low`, `1 = medium`, `2 = high`.
- Original values preserved; **no on-phone filtering**. Thresholding is a
  downstream (Mac) decision.

## Frame metadata record (`metadata.jsonl`)

Mandatory keys (hard error if missing): `frame_id`, `timestamp`, `rgb_path`,
`image_width`, `image_height`, `camera_transform`, `camera_intrinsics`,
`tracking_state`.

Optional: `session_time`, `depth_path`, `confidence_path`, `depth_width`,
`depth_height`, `depth_format`, `depth_units`, `confidence_format`,
`depth_status`, `tracking_reason`, and any future field (kept in `extra`).

`tracking_state ∈ {normal, limited, notAvailable}`.

Missing LiDAR → `depth_path = null`, `depth_status = "unavailable"`; the frame
is still valid (RGB + pose usable for future reconstruction).

## Identity

- `session_id` — UUID string, stable for the whole recording.
- `frame_id` — monotonic integer, unique within a session, drives file names.
- Future tooling may add `scene_id` without touching raw capture data.

## Depth unprojection convention

depth pixel `(u=col, v=row)`, depth `d` (m, >0), depth-scaled intrinsics
`(fx, fy, cx, cy)`; camera space is ARKit's (+x right, +y up, **−z forward**):

```
x_cam = (u - cx) / fx * d
y_cam = -(v - cy) / fy * d
z_cam = -d
world = camera_transform @ [x_cam, y_cam, z_cam, 1]
```

Intrinsics are scaled RGB→depth by `sx = depth_w/image_w`, `sy = depth_h/image_h`
(fx,cx scale by sx; fy,cy by sy). Confirm signs on device: a wall in front must
render in front, upright, not mirrored.

## Network protocol (see `tools/live_capture_server`)

- Control/telemetry/odometry: WebSocket, versioned JSON messages.
- Bulk payloads (rgb/depth/confidence/metadata): length-prefixed binary frames
  carrying `session_id + frame_id + payload_type + sequence + byte_length +
  sha256`; server writes temp→verify→rename→ACK; duplicates idempotent.
- `format_version` (file) and `protocol_version` (wire) are distinct.
