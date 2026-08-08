# Gauzensplat Capture — iOS app

Native Swift / SwiftUI / ARKit recorder for iPhone 16 Pro. Records synchronized
RGB + ARKit camera pose + intrinsics + LiDAR `sceneDepth` + confidence +
timestamps to a versioned on-disk format, with optional live Wi-Fi mirroring to
the Mac capture server. **Local capture is always the source of truth; Wi-Fi is
never required to record.**

## Layout

```
ios/
├── Package.swift                       # SwiftPM: pure-logic core + CoreCheck runner + XCTest
├── Sources/GauzensplatCaptureCore/     # Foundation+simd+CryptoKit only (compiles on Mac)
├── Sources/CoreCheck/                  # runnable mirror of the tests (no XCTest needed)
├── Tests/GauzensplatCaptureCoreTests/  # XCTest (runs in Xcode / full-Xcode Mac)
├── GauzensplatCapture/                 # the iOS app (ARKit / SwiftUI / URLSession)
│   ├── App/          GauzensplatCaptureApp, CaptureViewModel, Info.plist
│   ├── Capture/      ARSessionController, CaptureCoordinator
│   ├── Sensors/      ARFrameExtraction
│   ├── Network/      WiFiLaptopTransport, ConnectionTester
│   └── UI/           CaptureView, ConnectionPanel, DebugView, ExportSheet
└── project.yml                         # XcodeGen spec -> GauzensplatCapture.xcodeproj
```

The `GauzensplatCaptureCore` framework holds the contract-critical code (matrix
serialization, intrinsics scaling, depth/confidence codecs, state machine,
sampler, bounded queue, protocol, clock sync). The app target reuses it; the
same sources compile on the Mac so the contract is verified without a device.

## Build & run on a physical iPhone 16 Pro

The iOS Simulator cannot exercise LiDAR — use a real device.

### Option A — XcodeGen (recommended)

```bash
brew install xcodegen
cd ios
xcodegen generate
open GauzensplatCapture.xcodeproj
```

1. Connect the iPhone 16 Pro via USB.
2. Select the **GauzensplatCapture** scheme and the device as the run destination.
3. In **Signing & Capabilities**, choose your Apple Developer **Team** (or set
   `DEVELOPMENT_TEAM` in `project.yml` and re-generate). Automatic signing is on.
4. On the phone: **Settings → Privacy & Security → Developer Mode → On** (reboot).
5. Press **Run (⌘R)**. Xcode installs *Gauzensplat Capture*.
6. On first launch, allow **Camera** and (for mirroring) **Local Network**.

### Option B — Manual Xcode project

1. **File → New → Project → iOS App** (SwiftUI, Swift). Delete its stub
   `ContentView`/`App` files.
2. **File → Add Package Dependencies… → Add Local…** and pick this `ios/` folder;
   add the **GauzensplatCaptureCore** library to your app target.
3. Drag the `GauzensplatCapture/` folder into the project (Create groups, add to
   the app target). Set the target's **Info.plist** to
   `GauzensplatCapture/App/Info.plist` (or copy its keys into your generated one —
   `NSCameraUsageDescription`, `NSLocalNetworkUsageDescription`,
   `UIRequiredDeviceCapabilities = arkit`).
4. Deployment target **iOS 16.0**, device family **iPhone**.
5. Set your Team, enable Developer Mode, Run.

## Verify the core on the Mac (no device)

```bash
cd ios
swift run CoreCheck     # runs the contract checks (Command Line Tools OK)
swift test              # full XCTest suite (requires full Xcode)
```

`CoreCheck` cross-checks the golden matrix rows, depth/confidence bytes, and
SHA-256 against the Python `tools/arkit_capture/tests/test_golden.py` values, so
iOS and Mac can never silently disagree on the format.

## Record → export → inspect

1. Confirm **LiDAR ACTIVE** and **AR Tracking NORMAL**.
2. **START**, walk around the desk/room, **STOP**.
3. **EXPORT LAST CAPTURE** → Files / AirDrop to the Mac (a `.zip`).
4. On the Mac:
   ```bash
   python tools/arkit_capture/inspect_capture.py /path/to/capture_XXXX
   ```
   Inspect `trajectory_topdown.png`, `trajectory_3d.png`, `trajectory.csv`,
   `lidar_cloud.ply`, `summary.json`.

## Live Wi-Fi mirroring

1. On the Mac: `python tools/live_capture_server/server.py` (prints its LAN IP).
2. In the app, enter `LAN-IP:8765`, tap **TEST CONNECTION** (verifies real
   two-way comms + RTT + clock offset), then **ENABLE LIVE MIRROR**, then START.
3. On STOP the app reconciles its manifest with the server (0 missing on a
   healthy session). Run the inspector directly on the server session:
   `python tools/arkit_capture/inspect_capture.py live_sessions/<sid>/phone`.

If the Mac firewall prompts, allow incoming connections for `python3`.
