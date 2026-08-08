# Setup

This repo holds the **Gauzensplat capture pipeline** — an iPhone LiDAR + Wi-Fi
(+ ESP32 odometry) capture system and the Mac-side tooling that turns captured
video into Gaussian splats.

Start with `README_GAUZENSPLAT_CAPTURE.md` for the what/why, and
`IMPLEMENTATION_STATUS.md` for what's built and tested. This file is just how to
get it running.

## Repo layout

```
tools/arkit_capture/       Offline Mac inspector: capture → trajectory/point cloud/validation (numpy + Pillow)
tools/live_capture_server/ Live phone↔laptop capture server + ESP32/phone simulators (Python stdlib only)
tools/video_intel/         Video → Gaussian-splat orchestration, pruning, semantics
ios/                       Native Swift/SwiftUI/ARKit recorder for iPhone 16 Pro (+ Mac-testable core)
```

## Important: the splat engine is an external dependency

The Gaussian-splat trainer itself (**Brush**, driven through
`ComfyUI/pipeline_run.py`) is **not vendored in this repo.** `tools/video_intel`
code shells out to it via `subprocess` and expects it to live in a `ComfyUI/`
directory **at the repo root**, next to `tools/`:

```python
# tools/video_intel/splat_batch.py
COMFY      = REPO / "ComfyUI"
PIPELINE   = COMFY / "pipeline_run.py"    # ← called, not included here
BRUSH_DATA = COMFY / "brush_data"
```

So everything **except** the actual splat-training step runs from a fresh clone.
`splat_batch.py` / `process_video.py` will only complete the splat step once you
place a working `ComfyUI/` (with Brush + `pipeline_run.py`) at the repo root. If
you don't have that folder yet, ask the original author for it — it's large
(tens of GB) and deliberately kept out of git.

## Prerequisites

- **macOS** with Xcode Command Line Tools (`xcode-select --install`)
- **Python 3.10+** (developed on 3.14)
- For the splat step only: a working `ComfyUI/` + Brush install (see above),
  plus COLMAP as required by that pipeline

## 1. Python tooling

The **live capture server and simulators are stdlib-only** — nothing to install.
Only the offline inspector (`tools/arkit_capture`) and parts of `video_intel`
need packages:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r tools/requirements.txt   # numpy, pillow, matplotlib(optional)
```

### Run the tests (no hardware needed)

```bash
python -m unittest discover -s tools/arkit_capture/tests -v
python -m unittest discover -s tools/live_capture_server/tests -v
```

Expected: ~102 Python tests pass (62 arkit_capture + 40 live_capture_server).

### Run the live capture server

```bash
python -m tools.live_capture_server.server --host 0.0.0.0 --port 8765 --root live_sessions
```

Point the iOS app (or the simulators) at `ws://<mac-ip>:8765`. Drive it without a
phone using the simulators:

```bash
python -m tools.live_capture_server.simulate_phone   # RGB/pose/depth mirror
python -m tools.live_capture_server.simulate_esp32   # odometry stream
```

> `live_sessions/` (recorded captures) is git-ignored — it's local data, not
> committed. Local capture is always the source of truth; Wi-Fi is optional.

## 2. iOS app (iPhone 16 Pro)

The Simulator can't exercise LiDAR — use a real device. The project is generated
with XcodeGen so nothing device-specific is checked in:

```bash
brew install xcodegen
cd ios
xcodegen generate        # -> GauzensplatCapture.xcodeproj
open GauzensplatCapture.xcodeproj
```

Set your signing team, then build/run on a physical iPhone 16 Pro. See
`ios/README.md` for the full walkthrough and the Mac-only core check
(`swift run CoreCheck`) that verifies the format/protocol contract without a
device.

## 3. Video → Gaussian splat (needs the ComfyUI/Brush dependency)

Once `ComfyUI/` is in place at the repo root:

```bash
# Produce many splat samples from one video
python -m tools.video_intel.splat_batch --video path/to/clip.mov --out tools/video_intel/out/myrun --smoke

# Inspect / prune a resulting .ply
python -m tools.video_intel.splat_tools inspect tools/video_intel/out/myrun/*.ply
```

Sample outputs from earlier runs are under `tools/video_intel/out/` for
reference.

### Optional: semantic frame selection (LLM)

`tools/video_intel/semantics.py` can score frames via Gemini or OpenAI. Keys are
read from **environment variables** — never commit them:

```bash
export GEMINI_API_KEY=...     # or
export OPENAI_API_KEY=...
```

(The code also falls back to `tools/video_intel/.secrets/*.key`, but that folder
is git-ignored and intentionally not in this repo. Prefer env vars.)

## What's git-ignored (and why it's not here)

`.venv/`, `__pycache__/`, `.build/`, Xcode userdata, `.DS_Store`,
`live_sessions/` (local capture data), `**/.secrets/` + `*.key` (API keys), and
the `ComfyUI/` splat engine (huge, external). See `.gitignore`.
