# spark_studio — video in, Gaussian splat out, on this machine

The reconstruction the web app has always assumed exists. `web/lib/studio.ts` is
a client for a studio server; that server lived in a 125 GB ComfyUI checkout on
one Apple Silicon Mac and was never in this repository. This replaces it, owes
nothing to ComfyUI, and depends on the standard library plus three tools.

## The thing people get wrong first

**COLMAP does not make the splat.** This is two different problems:

```
walk.mp4 ──ffmpeg──▶ frames ──COLMAP──▶ camera poses ──Brush──▶ walk.ply
                              (stage 2)                (stage 3)
```

**Stage 2** works out where the camera was for each frame — structure from
motion. It produces no model of the scene, just poses and a sparse dust of tie
points. You cannot look at it. **Stage 3** is the one that makes the splat.

This is also why there is no browser-only path. Stage 3 runs in a browser fine
(Brush is wgpu). Stage 2 has *no* browser implementation in existence — no
SfM has ever been compiled to WASM. Poses have to come from somewhere else:
a machine like this one, or a phone that ran ARKit and already knows.

## Install

```bash
python -m venv .venv-splat
.venv-splat/Scripts/python -m pip install pycolmap imageio-ffmpeg numpy pillow plyfile

git clone https://github.com/ArthurBrussee/brush
cargo install --path brush/apps/brush-cli --root .venv-splat   # needs Rust >= 1.85
```

`pycolmap` ships prebuilt wheels for Windows, macOS and Linux — no C++ build.
`imageio-ffmpeg` brings its own ffmpeg binary. Only Brush compiles, and only
once.

Check it:

```bash
python -m spark_studio doctor
```

It reports each tool by **running** it, not by checking a path exists, and
prints the exact line to fix anything missing.

## Use

```bash
python -m spark_studio selftest              # reconstruct a scene we generate
python -m spark_studio walk.mp4 -o walk.ply  # reconstruct real footage
python -m spark_studio walk.mp4 -o walk.ply --preset fast
python -m spark_studio serve                 # the companion server
```

`selftest` renders a synthetic scene with dense multi-scale texture and a camera
that genuinely translates, then reconstructs it. If that fails, the install is
at fault rather than your footage — which is the whole reason it exists.

Presets: `fast` (10k steps @1280px), `balanced` (30k @1600), `high` (50k @1920).

## What it costs

Measured on an Intel laptop with **no CUDA**:

| | |
|---|---|
| Feature extraction, 119 frames @1080×1920 | ~2.5 min (~6.5k features/frame) |
| Full solve, 60 synthetic frames | 135 s, 60/60 placed, 0.41 px error |

Training is the other half and scales with `--total-train-iters`. Budget an
hour for a real clip at `balanced` and be pleasantly surprised.

## Serving the web app

```bash
python -m spark_studio serve            # :8899, the port lib/studio.ts defaults to
python -m spark_studio serve --host 0.0.0.0   # reachable from a phone on the LAN
```

The integration has **no protocol**. `web/lib/splatJobs.ts` writes an uploaded
clip to `web/.uploads/<jobId>.mp4` and derives "ready" from
`web/public/mock/splats/<jobId>.ply` existing. So the server watches one
directory and writes to the other; nothing POSTs anything back, and a restart of
either side loses nothing. The files are the state.

Endpoints match what `lib/studio.ts` already expects: `/health`,
`/api/capture/status`, `/api/live/list`, `/api/live_splat`, `/api/runs`,
`/file?path=`, `POST /api/live/delete`. Plus `/api/queue` for what the watcher
is doing right now.

`/file?path=` takes an absolute path — the shape of an arbitrary-read bug — so
every request is resolved and fenced to directories this server owns. Anything
else is 403.

## What "live" honestly means

Not one optimiser ingesting frames. No splat trainer works that way: training
needs poses, and poses for frame N+1 do not exist until the solver has seen it.
Anything claiming a single continuous process is describing SLAM.

Two loops at different speeds:

- **poses extended incrementally** as frames land (seconds — `incremental_mapping`
  takes an `input_path` to extend a model rather than rebuild it)
- **trainer restarted** on the larger set every ~90 s, seeded from the splat it
  produced last time

From outside it looks continuous, because Brush's `--export-every` writes
`export_<iter>.ply` throughout a run and the viewer reads the newest. `status()`
carries `stale_seconds`, so a session that stops advancing says so instead of
showing a two-minute-old splat as current.

## Two failure modes worth knowing

**Footage with no parallax cannot be solved.** Panning from one spot, or filming
a blank wall, gives COLMAP nothing to triangulate — it will say so rather than
produce a wrong answer. Walk *around* the subject.

**Partial registration is the common outcome, not failure.** COLMAP registers
what it can and drops the rest, so a corridor can come back as 38 of 150 frames
and a valid-looking reconstruction of the first eight metres. `registered` and
`total` are separate fields everywhere here and never collapsed into a boolean,
and a shortfall is reported as a warning on the run.

## Layout

| file | |
|---|---|
| `doctor.py` | what is installed, measured by running it |
| `frames.py` | video → frames, fps scaled to clip length |
| `poses.py` | stage 2, behind a `PoseSolver` seam |
| `train.py` | stage 3, the Brush wrapper |
| `pipeline.py` | the three stages, resumable per stage |
| `live.py` | progressive reconstruction |
| `server.py` | the studio API and the `.uploads` watcher |
| `synth.py` | a scene that must solve, so failures mean the install |
| `cli.py` | `doctor` \| `serve` \| `selftest` \| `<video>` |

The `PoseSolver` seam in `poses.py` is where ARKit slots in.
`tools/arkit_capture/export_colmap.py` already writes the exact COLMAP triple
from an iPhone capture **without solving anything** — for that path, stage 2
costs nothing and cannot fail on textureless scenes. It needs the native iOS
app, which is not yet wired to the web app.
