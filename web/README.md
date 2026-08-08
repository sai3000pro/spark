# Spark

A companion robot that follows you, decides on its own what was worth keeping, and lets you relive
the trip afterwards. Named for the spark that makes a moment a moment.

This repo is the **web side + the detection pipeline**.

```bash
npm install
npm run dev        # dev server (the three.js chunk takes ~10s to compile on first hit)
npm run build && npm start   # what you should demo on — much snappier
npm run verify     # asserts the pipeline's invariants over the mock trip
npm run typecheck
npm run lint
```

`npm run verify`, `typecheck` and `lint` are all green on `main`. Keep them that way — `verify` in
particular is the guardrail that catches a UI change quietly breaking the data.

---

## Read this first: the contract

**`lib/types.ts` is the single source of truth.** Three stages, cheapest first:

```
Detection[]        every frame, on-device, ~10fps, disposable
     │  scoreCandidates()      ← metadata + audio envelope + odometry only, never pixels
     ▼
MomentCandidate[]  a window flagged as interesting + WHY (triggers), promoted or discarded
     │  promoteToMoment()      ← the expensive stage; only runs on survivors
     ▼
Moment[]           splat + transcript + object sightings + music + vibe
```

**Add fields to `lib/types.ts`, not at the call site.** Everything downstream — splat anchors,
"where is my X?", the trip replay, the ingest endpoints — reads these shapes. If you need something
the contract doesn't carry, widen the contract.

One unit trap worth knowing, because it already caused a bug: `TrackPoint.heading` is **radians**
from +x, while `ObjectIndexEntry.navTarget.heading` is a **compass bearing in degrees**, 0–360. Both
are documented in place.

## What's real vs. mocked

Real, and load-bearing:

- `lib/pipeline.ts` — sliding-window candidate scoring, weighted triggers, `promoteToMoment`
  collapsing detections into `ObjectSighting[]` by `trackId`. Runs on mock data today and the
  robot's output tomorrow.
- `lib/objectIndex.ts` — the "where is my X?" index: alias matching, fuzzy fallback, nav targets.
- `lib/momentQA.ts` + `lib/tripQA.ts` — retrieval over the real transcript. The prose is templated;
  the topics, quotes, speaker stats and citations are computed.
- `lib/detector.ts` + `/detect` — a real object detector running in your browser, emitting real
  `Detection[]` that go through the same `scoreCandidates`.
- `app/api/ingest/*` — validated ingest endpoints (`GET` either one for its own contract docs).

Mocked:

- `lib/mock/trip-waterloo-park.ts` — one authored trip. It authors only the **human** layer
  (titles, transcripts, music, vibe). Candidates, moment spans, object sightings, keyframes and the
  object index are all produced by *actually running the pipeline* over generated detections. That
  is why the three timeline lanes agree with each other, and `npm run verify` asserts it. **Please
  don't "simplify" this into hand-authored moments** — the consistency is the whole pitch.
- Keyframe images — procedural SVG stand-ins seeded per frame (`lib/mock/placeholder.ts`). Set
  `url` on a `Keyframe` and the real photo renders instead; nothing else changes.
- Robot telemetry in the status bar (follow mode, 78% battery).

## Design

The visual language comes from the Figma Make iteration: dark cinematic / spatial observatory,
Outfit + Inter + JetBrains Mono, luminous teal primary and amber accent.

Tokens live in **`app/globals.css`** and are mirrored as raw hex in **`lib/theme.ts`** for SVG,
canvas and WebGL, which can't use Tailwind classes. Change one, change both.

Two accent families, and the split carries meaning:

| family | means |
|---|---|
| `machine-*` (teal) | the robot layer — detections, tracks, confidence, nav |
| `memory-*` (amber) | the human layer — moments, places, music, transcript |
| `signal` / `compute` / `warn` / `fail` | ready · reconstructing · stand-in data · failed |

Label-family colours in `lib/mock/labels.ts` are a separate, **validated** categorical scale:
all 21 pairs checked on all three dark surfaces (min contrast 3.63:1, protan ΔE 8.7, deutan ΔE 7.5).
Re-run that check before hand-picking a replacement.

## Adding a trip

1. Copy `lib/mock/trip-waterloo-park.ts`. Author only the human layer: the `SPECS` array (title,
   summary, time window, people, transcript, music, vibe) plus the object tracks you want present.
2. Let `buildTrip()` run `scoreCandidates` / `promoteToMoment` over generated detections as it
   already does. Don't hand-write `MomentCandidate`s.
3. Add it to `listTrips()` in `lib/tripData.ts`.
4. Extend `scripts/verify-pipeline.ts` to cover it.

`buildTrip()` is currently hardcoded to the one trip and memoized. Making it take a `TripSpec`
argument is the natural next refactor and would give the albums grid more than one card.

## Tuning the detector → moment behaviour

Everything lives at the top of `lib/pipeline.ts`:

- `TRIGGER_WEIGHTS` — per-trigger contribution. `laughter` is deliberately the strongest single
  signal; audio beats vision.
- `PIPELINE_CONFIG.windowThreshold` (0.30) — a window must reach this to join a candidate.
- `PIPELINE_CONFIG.promoteThreshold` (0.62) — a candidate must reach this to become a Moment.
- `PIPELINE_CONFIG.minCandidateSec` (12) — shorter than this and there isn't enough parallax to
  reconstruct a splat.

Known knob worth being deliberate about: `face_count` alone can never clear `windowThreshold`
(2 people scores 0.174). That's intentional — people are *always* in frame when the robot is
following you — but raise its weight if you want "just us hanging out" to become a moment.

Change a weight and run `npm run verify`; it fails loudly if a moment stops being found.

## Day-2 integration seams

| Seam | What to change |
|---|---|
| `POST /api/ingest/detections` | Validates + scores, doesn't persist. One `TODO` marks the DB insert. |
| `POST /api/ingest/moments` | Same shape. Invalid payloads get a 400 naming the field. |
| `GET /api/trips/:tripId` | Reads `lib/mock`; swap for the DB behind the same `TripView` shape. |
| `components/relive/SplatViewer.tsx` | Switches purely on `moment.splat.status`. Drop a `.spz` in `public/mock/splats/` and it renders for real. |
| `components/atlas/AtlasMap.tsx` | Keep `{ path, moments }`; swap internals for MapLibre if you get GPS. |
| `lib/momentQA.ts` / `lib/tripQA.ts` | Replace the templated `run()` bodies with a Claude call; keep the citation ids. |
| `components/relive/ReliveOverlay.tsx` | The soundtrack card opens `music.spotifyUri`; wire the playback SDK here. |

The splat stage probes the asset with a `HEAD` request first and falls back to a synthetic point
cloud built from each object's `worldPos`, badged honestly as `synthetic preview`. So the demo works
with zero assets and upgrades itself the moment a real capture appears.

## Demo path

1. `/` → **the atlas**: the whole day as a full-screen risograph park map, every kept moment a
   numbered sticker-pin in its own ink.
2. Press **play** on the day bar: the robot re-walks its odometry at 120× while pins pop from
   outline to full ink as the playhead reaches them. Scrub the bar or click a chip to jump.
3. Click any pin → the moment **expands into its Gaussian splat**: the night takeover with the
   3D stage, what was seen (click an object row and the camera flies to its anchor), what was
   said, and the soundtrack Spark picked. `←`/`→` step between moments, `esc` back to the map.
4. `⌘K` → "where is my nalgene" (alias → bottle) → *Step into the splat* → lands inside the
   picnic-table moment with the bottle anchor focused → *Send robot here* shows the nav pose.
5. `/detect` → load YOLOS-tiny, drop a photo, watch real detections become a real candidate.
6. The **Phone** toggle (bottom right) shows the on-robot view.

## Gotchas

- **Demo on `npm run build && npm start`.** In dev, the three.js chunk takes ~10s to compile the
  first time you open a moment.
- The 3D canvas needs the tab to be **visible**. R3F won't initialise until it measures a non-zero
  size, and in a hidden/background tab `requestAnimationFrame` never runs so `ResizeObserver` never
  fires. Not a bug in the app, but it will look like one if you demo from a background tab.
- The **Phone** preview is an `<iframe>`, not a scaled div, and it has to be. Tailwind breakpoints
  resolve against the viewport, so a plain 390px-wide box renders the *desktop* layout crushed into
  390px. An iframe has its own viewport, so every existing `sm:`/`md:` rule resolves correctly.
- The 4 `npm audit` highs are all inside `onnxruntime-node`/`sharp` — the **Node-side** backends of
  Transformers.js, which never execute since we run in-browser on WASM/WebGPU.
- `onnx-community/rtdetr_v2_r18vd` does **not** exist (401). Don't "fix" the detector default to it.
  Verified working: `Xenova/yolos-tiny` (default) and `Xenova/detr-resnet-50`.
- `Journey Moment Capture App/` is the Figma Make export, kept locally as a design reference and
  gitignored. It's a separate Vite app — not part of this build, and excluded from tsconfig/eslint.
