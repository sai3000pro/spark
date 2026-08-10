# Gauzensplat Capture Pipeline

iPhone LiDAR + local Wi-Fi capture foundation for Gauzensplat: record
synchronized RGB + ARKit pose + intrinsics + LiDAR depth + confidence on an
iPhone 16 Pro, mirror it live to a laptop over local Wi-Fi (with ESP32 odometry
ingest), and validate the trajectory + LiDAR geometry on the Mac. Reconstruction
(Brush / Gaussian Splatting) is intentionally **out of scope** — this is the
trustworthy sensing + transport layer only.

Built phase-by-phase per
`gauzensplat_master_iphone_wifi_esp32_implementation_prompt.md`. Status per phase:
**`IMPLEMENTATION_STATUS.md`**. Full docs: **`IPHONE_LIDAR_CAPTURE.md`**. Test
results (what actually ran vs awaiting hardware): **`IPHONE_LIDAR_CAPTURE_TEST_REPORT.md`**.

## Components

| Path | What |
|---|---|
| `ios/` | Native Swift/SwiftUI/ARKit recorder + Mac-testable core (`swift run CoreCheck`) |
| `tools/arkit_capture/` | Offline inspector + format library (`inspect_capture.py`) |
| `tools/live_capture_server/` | Stdlib Wi-Fi server, phone/ESP32 simulators, dashboard |

## 60-second tour (no phone needed)

```bash
# 1. Mac tooling (venv recommended; server needs no deps)
python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements.txt

# 2. Run all automated tests
python -m unittest discover -s tools/arkit_capture/tests -t .        # 62 tests
python -m unittest discover -s tools/live_capture_server/tests -t .  # 40 tests
( cd ios && swift run CoreCheck )                                    # 23 checks

# 3. Live end-to-end with simulators
python tools/live_capture_server/server.py --port 8790 &
python tools/live_capture_server/simulate_phone.py --port 8790 --frames 25 \
    --disconnect-after 10 --duplicate-every 6 --corrupt-every 8
#   -> prints session_id=... and "complete=True missing=0"
python tools/live_capture_server/simulate_esp32.py --port 8790 \
    --session <session_id> --path circle --rate 20 --duration 3 --fast
python tools/arkit_capture/inspect_capture.py live_sessions/<session_id>/phone
#   -> trajectory.csv, trajectory_*.png, lidar_cloud.ply, summary.json
```

## On a real iPhone 16 Pro
See `ios/README.md` (XcodeGen or manual Xcode). Record → EXPORT → run
`inspect_capture.py`, or ENABLE LIVE MIRROR to stream to the server and inspect
the received session directly.

## Design guarantees (enforced in code + tests)
- **Local capture is the source of truth**; Wi-Fi is never required to record.
- Bounded RAM: bounded writer queue + disk-referenced network backlog.
- Idempotent, checksummed, reconciled transport: missing = 0, checksum failures
  = 0 on healthy sessions; duplicates never create duplicate files.
- One format contract, verified across Swift ⇄ Python by a byte-level golden test.
- Raw ARKit transforms + raw depth + raw confidence + raw timestamps preserved
  for future Brush / rover / masking / audio integration.

Untouched: the existing ComfyUI / Brush / Hunyuan reconstruction paths.
