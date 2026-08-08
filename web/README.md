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

- `lib/mock/trips/*.ts` — seven authored trips. They author only the **human** layer (titles,
  transcripts, music, vibe). Candidates, moment spans, object sightings, keyframes and the object
  index are all produced by *actually running the pipeline* over generated detections. That is why
  the three timeline lanes agree with each other, and `npm run verify` asserts it. **Please don't
  "simplify" this into hand-authored moments** — the consistency is the whole pitch.
- Keyframe images — procedural SVG stand-ins seeded per frame (`lib/mock/placeholder.ts`). Set
  `url` on a `Keyframe` and the real photo renders instead; nothing else changes.
- Robot telemetry in the app bar (follow pill, battery). Driven by the live session, but no robot
  is connected — the tooltip says so.
- **Live trip counters**, until a robot reports in. See "Starting a trip" below.

There is **no sign-in and no user accounts.** The app opens straight onto the albums. A live trip
therefore belongs to the installation rather than to a person, which is what a robot sitting in
someone's hallway actually is — see the header of `lib/liveTrip.ts` for where a `userId` would go if
accounts ever arrive.

## Design

Aurora night, from the brand sheet in `../design/`: navy `#0B0F1E`, brand orange `#F5A623`,
Poppins for display, Inter for prose, JetBrains Mono for every micro-label.

Tokens live in **`app/globals.css`** and are mirrored as raw hex in **`lib/theme.ts`** for SVG,
canvas and WebGL, which can't use Tailwind classes. Change one, change both.

Three colour families, and the last two are only ΔE 5.5 apart, so they are kept apart by **rule**
rather than by hue:

| family | means |
|---|---|
| `brand-*` (orange) | **a form, never a category.** Solid fills on primary actions, rings, focus, the glyph. Never in a chart, legend, chip or timeline. |
| `machine-*` (teal) | the robot layer — detections, tracks, confidence, nav |
| `memory-*` (amber) | **a category, never a fill.** Text and 10–12% tint chips, always beside a label. Never a solid button. |
| `signal` / `compute` / `warn` / `fail` | ready · reconstructing · stand-in data · failed |

The only two tones that can share a visual field are brand-400 solid and memory-300 text — ΔE 28.0,
unmistakable. The 5.5 pair can never co-occur. If you break that rule the palette collapses into
"two oranges that look like a mistake".

The ink ramp moves as a unit. `#0B0F1E` is *lighter* than the old near-black, so lifting only `--bg`
would collapse the 950↔900 separation from 1.057 to ~1.01 and flatten every card in the app.

Label-family colours in `lib/mock/labels.ts` are a separate, **validated** categorical scale:
all 21 pairs checked on all three dark surfaces (min contrast 3.63:1, protan ΔE 8.7, deutan ΔE 7.5).
Re-run that check before hand-picking a replacement.

## Adding a trip

1. Copy one of the light trips in `lib/mock/trips/` (Waterloo Park is the deep one; the rest are
   ~120-line postcards). Author only the human layer plus the object tracks you want present.
2. Add it to `TRIP_SPECS` in `lib/mock/trips/index.ts`. That is the only registration step —
   `listTrips()`, the globe and the cross-trip search all read from there.
3. Let `buildTrip(spec)` run `scoreCandidates` / `promoteToMoment` over generated detections as it
   already does. Don't hand-write `MomentCandidate`s.
4. Run `npm run verify`. It asserts `trip.moments.length === spec.moments.length`, so a moment that
   silently failed to promote is caught immediately.

**A moment is not guaranteed to exist just because you wrote one** — it has to earn promotion
through `scoreCandidates()`. The eight authoring rules that make that reliable (give every moment a
`laughterAt`, two `person` tracks, ≥45s windows, only labels in `LABEL_FAMILIES`, …) are documented
at the top of **`lib/mock/buildTrip.ts`**. Read them before authoring.

Waterloo Park's RNG seeds are **pinned** to their historical literals. `verify` asserts a dozen
specific facts about that trip; changing a seed reshuffles its detections and breaks all of them.

## Starting a trip

The toolbar's record control opens a real session: `POST /api/trip/start` → `/api/trip/active`
(polled) → `POST /api/trip/stop`. `lib/liveTrip.ts` holds it in a `globalThis` singleton, which
survives HMR but **not** a server restart, and is single-process only. Its header spells out the
limits and the one-file path to a database.

**The rover-follow behaviour is not implemented.** The start response says so in the payload
(`followMode: false`) rather than only in a comment.

While no robot is connected the counters are *extrapolated* from elapsed time — using the real
`PIPELINE_CONFIG` tunables and the demo trip's own promotion rates, so the live readout and the
finished albums agree — and the card is badged `simulated counters · no robot connected`. The moment
the robot POSTs to `/api/ingest/detections` with the session's `tripId`, `noteIngest()` attaches it,
`simulated` flips to false and the numbers become measured, **with no other code change**.

Stopping a session with no robot attached produces **no album**, and says so: *"Nothing was
captured."* Fabricating one would be the exact lie `lib/splat/syntheticCloud.ts` refuses.

## The landing scene

`/` opens on a full-viewport aurora scene with the blob companion standing on the lit path; the
album library sits directly beneath it, reached by scrolling or by the cue's `#albums` anchor.

**The art is generated, not hand-placed.** `npm run build:design` reads the 14.9 MB of source PNGs
in `../design/` and writes `public/hero/*` plus `lib/heroAssets.ts`. It is the same contract as
`build:landmask`: outputs are **committed**, so `next build` never runs sharp and never reads
`design/`. (sharp is only present as a transitive dep of transformers.js and is deliberately not in
`package.json`.)

Three things that script gets right and a naive version would not:

- **The blob has no alpha channel.** It is keyed with a linear solve, not a threshold:
  `a = (Y − Y_bg) / (Y_body − Y_bg)`, then un-premultiplied as `F = (C − (1−a)·B) / a`. The
  un-premultiply is what removes the halo — the edge feather is 14–20 px at full resolution, so a
  luminance threshold cuts through the middle of it and leaves a navy rim on every frame. The report
  prints the mean recovered edge luminance; below 180 it fails the build.
- **Interior holes are filled**, or the blob renders with transparent eyes (~2% of body area).
- **Only the largest connected component survives.** The fireflies beside each pose key out as their
  own components, glow included, and one moving with the sprite reads as a bug.

**The aurora and the fireflies are code, not paint.** The shipped plate
(`Night forest _ no aurora_ no fireflies.png`) has an empty sky;
`components/hero/HeroSky.tsx` draws four blurred gradient ribbons and thirteen
drifting fireflies over it. Both are still *measured* from the original artwork:

- The aurora colour is the light the painted curtains **add** — the difference
  between the painted plate and the stripped one. Sampling the painted pixels
  directly gives a blue-dominant `rgb(46,76,103)`, which is not the aurora's
  colour but the aurora composited over a blue night sky.
- The delta is emitted **raw, not normalised**. Scaling it to full saturation
  turns `rgb(27,50,41)` into `rgb(138,255,209)`, which `screen`-blends into a
  solid teal wash that erases the forest. The dimness *is* the measurement.
- The fireflies sit where the artist put them, recovered by differencing the two
  plates and keeping the small warm dots.

Two rendering traps this cost real time to find, both worth knowing:

- **The hero `<img>` uses `decoding="sync"`.** The aurora blends with it via
  `mix-blend-mode`; if the image is still decoding when that blend group first
  rasterises, Chrome composites against an empty backdrop and never re-composites.
  The entire scene renders black until something forces a repaint.
- **`.h-hero` uses `height`, not `min-height`.** `.hero-stage` is a
  `container-type: size` query container, which needs a definite block size —
  with only a min-height, `100cqh` resolved to `0` and the plate box came out
  347×463 instead of 578×770, covering half the phone screen.

The plate is **mirrored** at build time. The lit path is nearly white (p90 luminance 95–146, i.e.
1.1–2.8:1 against our text) and the reference composition puts the headline straight on top of it.
Flipping moves the path and the blob right and hands the copy the dark left third at ~9:1 — which
buys legibility without dimming the illustration. Every fraction in `lib/heroAssets.ts` is in
flopped plate space.

**The blob's position is measured, not guessed.** Difference-keying the two plate renders does not
work — they are separate renders, not one plate with a blob composited on, so the diff covers the
whole frame. Instead the blob is found by its own signature: bright *and* neutral, where the lit
path is equally bright but warm, gated on aspect ratio so the horizon glow doesn't win.

The hero reproduces `object-fit: cover` as an explicitly sized box (`.hero-plate-box`) so that
percentages inside it are **plate** percentages. That is what keeps the blob glued to the painted
path from 362 px to ultrawide; a real `object-fit` crops inside the element and would let it drift.

Run `npm run build:design` and read the **ASCII alpha maps on stderr** — an inverted key, a halo or
a mis-detected frame is instantly visible there, the same way the landmask script prints an ASCII
Earth.

## The globe

`/globe` is hand-built on three + R3F — no map library. Earth is a **point cloud**, rendered with the
same custom shader as the splat stage, because Spark perceives the world as points.

Coastlines come from a 1-bit 512×256 land mask (`lib/globe/landmask.ts`, ~23 KB) baked from Natural
Earth 1:110m by `npm run build:landmask`. The generator prints an **ASCII map to stderr** — a
mirrored or upside-down Earth is invisible in a base64 blob and instantly obvious as text.

`lib/geo.ts` owns the one coordinate convention in the app (`+x` east, `+z` south; lng 0 → +Z).
`verify` asserts the inverse round-trip plus named spot checks (central Africa is land, the
mid-Pacific is not), because a mirrored globe passes every round-trip test ever written.

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
- **If you ever add middleware, the file is `proxy.ts`.** That convention is deprecated and renamed
  in Next 16, and the export is named `proxy`. Read `node_modules/next/dist/docs/` before touching
  routing — this is not the Next.js you remember, and `web/AGENTS.md` says so for a reason.
- The first request to `/` builds all seven trips — the full pipeline over ~35k detections. It is a
  one-time per-process cost absorbed by `buildTrip`'s cache. Measure it on `build && start`.
- **`prefers-reduced-motion` is a trap here, in a way that is not obvious.** The global block in
  `globals.css` forces `animation-duration: 0.01ms !important`. For a normal animation that means
  "finish instantly", which is right. For a **scroll-driven** animation duration scales *progress*,
  so it snaps to the END keyframe and stays there — the hero would freeze in its scrolled-away
  state. Every scroll-driven and stepped animation is therefore nested inside
  `@media (prefers-reduced-motion: no-preference)` and never relies on the global override.
  The album reveal has the mirror-image problem: the global block zeroes durations but does nothing
  to a static `opacity: 0`, so it needs *both* a JS gate and an explicit `[data-reveal]` override.
  Neither defence is redundant; don't delete either.
- **The album reveal is inverted from the usual pattern on purpose.** The stylesheet only reacts to
  a `data-reveal` attribute that JS itself writes, so a 404'd bundle, a hydration error, a missing
  `IntersectionObserver` or JS-off all render the full grid. Never put `opacity: 0` in the
  stylesheet and hope JS arrives.
- The app bar declares its height (`--appbar-h`) because the hero subtracts it, and an emergent
  height cannot be subtracted. Change the bar's contents → re-measure and update the token.
- **`.hero-copy` is `pointer-events: none`** with its children opting back in. It is full-width and
  sits above the blob in z-order, so without that the primary action on the page is silently
  unclickable — the character simply never responds and nothing on screen explains why.
- **`color-mix()` must name a `--color-*` token directly, never `--bg`.** Lightning CSS cannot
  resolve the mix through that indirection and silently drops the alpha; the hero scrim became an
  opaque navy band instead of a fade. For the same reason the app bar fades a pseudo-element's
  `opacity` rather than animating a `color-mix()` whose percentage depends on a custom property —
  that one constant-folds to a fully solid bar.
- Phone preview opens a **second WebGL context** on `/globe`. Two globes at once works fine; if a
  browser runs out of contexts, the flat SVG fallback takes over.
