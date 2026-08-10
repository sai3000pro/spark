# Boot & Connect — Gauzensplat / Reconstruction Studio

How to start the whole backend and connect an iPhone to capture live Gaussian splats.
Written for future agents. Paths are for this machine (`notjackl3`); adjust if moved.

Repo root: `/Users/notjackl3/Programming/hunyuanworld-mirror`

---

## 1. What runs (services & ports)

| Service | Port | Run from | Purpose |
|---|---|---|---|
| **Studio backend** | **8899** | `ComfyUI/` | The core. Phone connects here (WS). Serves album, bigview, `/api/*`, runs live recon + transcription. |
| Live splat viewer (`:8765` shader) | 8765 | `ComfyUI/` | The custom `?mode=splat` viewer used by `?live=` decoded plys. |
| Web app (Spark: Album/Map/Capture) | 3000 | `web/` | Next.js UI. Server-fetches `:8899/api/runs`. Optional — bigview on `:8899` works standalone. |

> `:8901` on this machine is **CapCut** (unrelated) — do not touch.
> A second studio instance sometimes runs on `:8955` — only `:8899` matters for the phone.

---

## 2. Prerequisites (already set up here)

- **Two Python venvs** (do NOT mix):
  - `ComfyUI/.venv` (py3.12) — has numpy + plyfile + torch + transformers + faster-whisper + PIL. **This is what the studio server runs under.** Referred to as `PY = ComfyUI/.venv/bin/python`.
  - root `.venv` (py3.14) — numpy, NO plyfile. Used by `tools/arkit_capture` CLIs.
  - Live-recon export/decode shell out via `PY`, so they're venv-agnostic.
- **Brush binary** (the Gaussian-splat trainer): `/Users/notjackl3/Programming/brush-app-aarch64-apple-darwin/brush_app`. Trains from an ARKit-posed COLMAP dir; NO SfM solve needed.
- macOS + Apple Silicon (MPS). Brush uses the GPU; a single in-process `GPU_LOCK` serialises all Brush runs (live cadence + offline full-runs) so they never overlap.

---

## 3. Boot the backend

Start each in its own background shell (in this session, prefix a command with `!` to run it live).

### a) Studio backend (:8899) — REQUIRED, phone connects here
```bash
cd /Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI
LIVE_RECON=1 LIVE_TRANSCRIBE=1 STUDIO_PORT=8899 \
  .venv/bin/python studio/server.py > /tmp/studio_live.log 2>&1 &
```
- `LIVE_RECON=1` → builds splats progressively while the phone scans (default OFF without it).
- `LIVE_TRANSCRIBE=1` → live speech→text per session (CPU int8 Whisper; fail-safe).
- On start it prints: `Reconstruction Studio  http://localhost:8899/   (phone: <LAN-IP>:8899)`.

### b) Live viewer (:8765) — optional (only for the `?mode=splat` decoded viewer)
```bash
cd /Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI
.venv/bin/python -c "import sys,time; sys.path.insert(0,'custom_nodes/ComfyUI-HunyuanWorld-Mirror'); \
from viewer_server import ViewerServer; ViewerServer.start(8765); \
import time
while True: time.sleep(3600)" > /tmp/viewer_8765.log 2>&1 &
```

### c) Web app (:3000) — optional (Album/Map/Capture UI; needs internet for map tiles)
```bash
cd /Users/notjackl3/Programming/hunyuanworld-mirror/web
npm run dev > /tmp/web_dev.log 2>&1 &   # next dev; predev copies the maplibre worker
```
`web/.env` sets `NEXT_PUBLIC_STUDIO_URL=http://localhost:8899` (default) — the UI reads splats from the studio.

### Verify it's up
```bash
lsof -tiTCP:8899 -sTCP:LISTEN          # studio pid
curl -s localhost:8899/api/live/list   # {"runs":[...]}
open http://localhost:8899/            # studio (Capture/Sessions/Reconstruct)
open http://localhost:3000/album       # web album (if :3000 running)
```

---

## 4. Connect the phone (live capture)

The iOS app **GauzensplatCapture** (bundle `com.gauzensplat.capture`, team `42LZF4Q3RR`) streams
ARKit RGB + LiDAR depth + confidence + camera poses + audio over Wi-Fi to the studio.

1. **Same Wi-Fi** for phone and laptop.
2. **Get the laptop's LAN IP:**
   ```bash
   ipconfig getifaddr en0   # e.g. 192.168.12.31  (this machine, today)
   ```
   (Or read it from the studio startup line `(phone: <ip>:8899)`.)
3. In the app, point it at **`<LAN-IP>:8899`** (e.g. `192.168.12.31:8899`).
   The app opens a WebSocket to `ws://<LAN-IP>:8899/ws/phone` (odometry: `/ws/odometry`).
4. Hit **Record**. The server auto-creates `sess_<id>`, spins up its LiveReconManager (if `LIVE_RECON=1`)
   and a transcribe worker, and starts publishing a live splat you can watch at:
   ```
   http://localhost:8899/bigview?live=6&run=sess_<id>&ply=<.../runs/live_sess_<id>/current.ply>
   ```
5. **Stop** on the phone → end_session → a final higher-quality pass runs and the scan registers in the album.

Deploy/refresh the app to a device (if needed):
```bash
xcodebuild -destination 'platform=iOS,id=<udid>' -allowProvisioningUpdates ...   # signing automatic
xcrun devicectl device install app --device <udid> <built.app>
# stream logs / crashes: xcrun devicectl device process launch --console --terminate-existing --device <udid> com.gauzensplat.capture
```

---

## 5. Producing the "full splat" (high-quality, offline) for a finished scan

The live preview is 900px/low-step. The **full pipeline** re-exports rotated + sharp-filtered and trains 15k steps:
```bash
curl -s -X POST http://localhost:8899/api/live/full-run \
  -H "Content-Type: application/json" \
  -d '{"session":"sess_<id>","label":"Full splat","steps":15000}'
# -> {"queued":"full-sess_<id12>-<n>"} ; lands in the album when done (progressive; watch with &live=10)
```
It exports to `ComfyUI/brush_data/live-<sid>` (an album-allowed path). Object detection is a **separate** step
(the splat pipeline doesn't run it):
```bash
PY=ComfyUI/.venv/bin/python
$PY tools/video_intel/object_catalog.py ComfyUI/brush_data/live-<sid> \
  --out ComfyUI/studio/runs/<run-id>/objects.json --detector detr --device cpu \
  --stride 5 --thresh 0.6 --min-views 3 --skip person        # --labels "..." to target the scene
$PY tools/video_intel/object_quality.py ComfyUI/studio/runs/<run-id>   # needs the final ply
```

---

## 6. Stop everything (this project only — leave CapCut/:8901 alone)

```bash
# studio servers (:8899 + any :8955) — target by port, NOT `pkill -f studio/server.py`
for port in 8899 8955; do kill $(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null) 2>/dev/null; done
kill $(lsof -tiTCP:8765 -sTCP:LISTEN 2>/dev/null) 2>/dev/null   # viewer
kill $(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null) 2>/dev/null   # web dev
pkill -f transcribe_worker.py 2>/dev/null                       # CPU whisper workers
pkill -f brush_app 2>/dev/null                                  # any GPU trainer
```

---

## 7. Gotchas (learned the hard way)

- **Live managers relaunch a killed Brush** (final-pass retries) — killing the Brush alone won't stop a live session; it respawns. To truly stop a manager: `POST /api/live/delete {session}` (⚠ removes that run's live splat + `live_datasets/<sid>`, KEEPS raw frames) **or** restart the studio server (non-destructive — clears in-memory managers, deletes nothing).
- **GPU is serialized** (`GPU_LOCK`): a live cadence and an offline full-run never run at once; a queued full-run waits behind an in-flight live pass. Data placement, not deletion, is how the album serves live frames.
- **`_allowed()` must include the frames' dir** or `/file` + `/thumb` 404 (broken album covers/frames). Live datasets historically lived in `studio/live_datasets/` which was NOT allowed → relocate to `brush_data/` or use the server that has the fix.
- **Two ply formats:** bigview needs the RAW Brush ply (`f_dc`/log-scale); it header-sniffs and auto-corrects a decoded `current.ply`/`result.ply` to its `.raw.ply` sibling.
- **`pkill -f 'studio/server.py'` kills ALL studio instances** (e.g. :8899 AND :8955) — target by port instead.

See also memory files: `realtime-splat-architecture`, `gauzensplat-capture-pipeline`, `frontend-merge-platform`.
