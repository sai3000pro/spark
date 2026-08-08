# Spark

A companion robot that follows you, decides on its own what was worth keeping, and lets you relive
the trip afterwards. Named for the spark that makes a moment a moment.

An iPhone + speaker rides on the robot. It watches and listens while you walk, captures the moments
that matter without being asked, reconstructs them as Gaussian splats you can poke around, plays a
track that fits the mood, and remembers where you left things.

## The three parts

| Path | What it is | Language |
|---|---|---|
| [`ios/`](ios/) | On-robot capture — ARKit/LiDAR recorder for iPhone 16 Pro, streams RGB + pose + depth | Swift / SwiftUI |
| [`tools/`](tools/) | Mac-side pipeline — live capture server, ESP32 odometry, video → Gaussian splat | Python |
| [`web/`](web/) | Trip replay + the detection → moment pipeline. What you see after the walk | TypeScript / Next.js |

They meet in two places:

- **Splats.** `tools/video_intel` produces `.ply`/`.spz` files. Drop one in
  `web/public/mock/splats/` and set `url` on the moment's `splat` — the web viewer switches from its
  synthetic preview to the real reconstruction with no code change.
- **Detections and moments.** `web/` exposes `POST /api/ingest/detections` and
  `POST /api/ingest/moments`, both validating against the contract in `web/lib/types.ts`. That's the
  seam the robot posts through.

## Start here

- **Web app** → [`web/README.md`](web/README.md). `cd web && npm install && npm run dev`.
  Read `web/lib/types.ts` first: it's the `Detection → MomentCandidate → Moment` contract everything
  downstream codes against.
- **Capture pipeline** → [`SETUP.md`](SETUP.md) for prerequisites and how to run it, then
  [`docs/README_GAUZENSPLAT_CAPTURE.md`](docs/README_GAUZENSPLAT_CAPTURE.md) for the what/why and
  [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for what's built and tested.
- **iOS app** → [`ios/README.md`](ios/README.md).

## Repo layout

```
ios/      Swift capture app (XcodeGen — run `xcodegen generate` first)
tools/    Python: arkit_capture · live_capture_server · video_intel
web/      Next.js app: trip replay, pipeline timeline, object search, detector bench
docs/     Capture-pipeline design docs, status, test reports
SETUP.md  Capture-pipeline setup
LICENSE   MIT
```

## Two things that aren't in git

- **`ComfyUI/`** — the Gaussian-splat trainer (Brush + `pipeline_run.py`) is an external dependency
  expected at the repo root. Tens of GB, deliberately not vendored. Everything except the actual
  splat-training step runs from a fresh clone. See `SETUP.md`.
- **`web/Journey Moment Capture App/`** — the Figma Make export the web design came from. Kept
  locally as a visual reference; it's a separate Vite app and not part of any build.

## State of things

`web/` is green on `npm run typecheck`, `npm run lint` and `npm run verify` — the last of which
asserts that the trip-replay data is internally consistent (every moment traces to a promoted
candidate, every candidate to detections inside its window). Run it after touching anything in
`web/lib/`.

The capture pipeline's Python suites pass without hardware (~102 tests); the iPhone/ESP32 paths are
documented as awaiting hardware in
[`docs/IPHONE_LIDAR_CAPTURE_TEST_REPORT.md`](docs/IPHONE_LIDAR_CAPTURE_TEST_REPORT.md).
