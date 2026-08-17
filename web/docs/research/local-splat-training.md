# Local splat training — what this repo actually has, and what it would take

Research note, 2026-08-17. Written for whoever writes the implementation plan, not for
end users. Every repo claim carries a `file:line`. Every external claim carries a URL and
says whether it is a project's own claim or someone's measurement.

Paths are relative to `web/` unless prefixed `../`, which means the repo root
(`spark/` — `git rev-parse --show-toplevel` returns the parent, so `../tools/`,
`../docs/` and `../REALTIME_SPLAT_PLAN.md` are all in this same git repository).

---

## 0. The one-paragraph answer

The blocker is **not** the trainer. Brush — the trainer this repo is already built around —
demonstrably trains 3DGS in a browser on WebGPU, and demonstrably trains fast on a laptop.
The blocker is **poses**. Brush takes posed data only (COLMAP or Nerfstudio format), and
this project's existing answer to "where do poses come from" is *ARKit on an iPhone*, not
SfM. For a handheld video shot on an arbitrary phone and reconstructed on a Windows laptop,
nothing in this repository, and nothing shippable in-browser, produces camera poses today.
An in-browser end-to-end "video in, splat out" is therefore **not viable this month**. An
in-browser *trainer* fed posed data is viable. A native sidecar that does poses + training
is viable and is closest to what the code already assumes.

---

## 1. Repo reality

### 1.1 The four targets and what gates them

`lib/reconstruction/targets.ts:25` declares `ReconTarget = "browser" | "studio-live" | "studio-batch" | "kiri"`.

The header states the rule the whole file exists to enforce
(`lib/reconstruction/targets.ts:16-20`):

> NOTHING IS OFFERED THAT IS NOT REACHABLE. Every option below is probed before
> it is shown, because a choice that silently does nothing is worse than an
> absent one — the whole point of picking a destination is knowing where it went.
> Where an option is unavailable it still appears, greyed, with the reason: "no
> GPU studio running here" is a fact someone can act on.

Gates:

| target | gate | line |
|---|---|---|
| `browser` | `BROWSER_TRAINER_AVAILABLE && !!gpu && gpu.tier !== "none"` | `targets.ts:147` |
| `studio-live` | `studio.reachable && studio.live` | `targets.ts:169` |
| `studio-batch` | `studio.reachable` | `targets.ts:182` |
| `kiri` | `hasKiriKey && !outOfCredits && !kiriRejected` | `targets.ts:189` |

`probeStudio()` (`targets.ts:88-96`) does two HTTP GETs with a 1500 ms timeout
(`targets.ts:79`): `GET ${STUDIO_URL}/api/runs` for reachability, then
`GET ${STUDIO_URL}/api/live_splat?session=__probe__` where anything other than 404 counts
as "live supported".

`fallbackFor` (`targets.ts:211-229`) degrades live→batch, and browser→batch, never to KIRI —
because KIRI spends an unrepeatable credit (`targets.ts:222-227`).

### 1.2 `BROWSER_TRAINER_AVAILABLE = false` — `targets.ts:61`

The constant is at `lib/reconstruction/targets.ts:61`, and the comment above it
(`targets.ts:38-59`) is the most honest thing in the repo. Load-bearing quotes:

> The probe in lib/gpu.ts answers "could this machine train a splat" — it
> requests a real adapter, runs a compute shader and checks the arithmetic, so
> on a decent laptop it returns a genuine yes. What it cannot answer is whether
> this repo contains anything that would DO the training, and it does not: no
> browser-side Gaussian-splat trainer is npm-installable, so Brush's WASM build
> has to be sourced and vendored separately. Until it is, capability and
> availability are two different facts and only one of them is true.
> (`targets.ts:42-50`)

> Flip this to true in the same commit that lands the trainer, not before.
> (`targets.ts:59`)

The user-facing string when the GPU passes but the engine is missing
(`targets.ts:162`):
`"Your GPU can do this, but the in-browser engine isn't shipped yet. Use the studio or KIRI."`

**This is correct and I found nothing dishonest about it.** It is the one target whose
copy matches reality.

### 1.3 `dispatch.ts` — the studio branches push nothing

Confirmed. `lib/reconstruction/dispatch.ts:119-134` is the entire studio path:

```ts
  // The studio paths do not push: the clip is on disk under .uploads and the
  // job is registered, which is exactly what the studio's own pipeline and the
  // manual dev path both consume. `getSplatJob` derives readiness from the
  // finished .ply appearing, so nothing here has to be told when it lands.
  return {
    requested,
    target,
    ok: true,
    degraded,
    external: null,
    terminal: false,
    note:
      target === "studio-live"
        ? "Streaming to the studio on your laptop — the splat builds as it goes."
        : "Queued for the studio on your laptop.",
  };
```

There is **no fetch, no POST, no websocket, no filesystem move** in this branch. The
function body between the `kiri` check (`dispatch.ts:92`) and this return contains only the
`browser` early-return (`dispatch.ts:107-117`). Compare `dispatchToKiri`
(`dispatch.ts:137-286`), which actually reads bytes, remuxes, and POSTs.

So:

- **`studio-live` says "Streaming to the studio on your laptop — the splat builds as it
  goes."** (`dispatch.ts:132`) Nothing streams. The only outbound traffic to the studio
  anywhere in the Next app is *reads*: `app/api/capture/live-splat/route.ts:17-20` proxies
  `GET /api/live_splat`, and `lib/studio.ts:167` does `GET /api/runs`.
- **`studio-batch` says "Queued for the studio on your laptop."** (`dispatch.ts:133`)
  Nothing is queued anywhere the studio can see. The comment's defence — "the studio's own
  pipeline and the manual dev path both consume" `.uploads` — is contradicted by
  `lib/splatJobs.ts:16-27`, which spells out that step 2 is *a human typing a command on
  another machine* and step 3 is *a human copying a file*:

  > 1. POST /api/splat/jobs with the video  → written to .uploads/&lt;jobId&gt;.mp4
  > 2. you run, on the machine with the GPU:
  >      python -m tools.video_intel.splat_batch --specs &lt;spec.json&gt;
  > 3. drop the decoded result at:
  >      web/public/mock/splats/&lt;jobId&gt;.ply
  > 4. GET /api/splat/jobs/&lt;jobId&gt; flips to ready and hands back the url
  >
  > Step 3 is a copy, not an integration, and that is deliberate — the alternative
  > is this app holding credentials for a box it does not own.

  `.uploads` is `path.join(process.cwd(), ".uploads")` (`lib/splatJobs.ts:66`) — i.e. inside
  `web/`, on the Next server's filesystem — and it is gitignored (`.gitignore:24`).

**Verdict for the plan:** `studio-batch`'s note is *arguably* defensible if the studio is on
the same filesystem and someone runs the script; `studio-live`'s note is not defensible under
any configuration, because live training needs frames pushed as they arrive and nothing pushes.
This is the same class of failure the `browser` target's comment describes at
`targets.ts:51-57` ("a success message for work that would never start"), still live.

Note also the availability gate never fires for a phone: `dispatch()` calls `describeTargets`
without a `gpu` field (`dispatch.ts:68-72`), so the browser option is always refused there
(`targets.ts:150-154`), which is why `dispatch.ts:100-106` calls its own browser branch
"unreachable in practice".

### 1.4 `lib/studio.ts` — what "the studio" is, and **the server is not in this repo**

- Base URL `NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:8899"` (`lib/studio.ts:13-14`). Plain
  HTTP.
- A second service, the live viewer, `NEXT_PUBLIC_VIEWER_URL ?? "http://localhost:8765"`
  (`lib/studio.ts:21-22`).
- Routes the client assumes: `/api/runs` (`studio.ts:167`), `/api/live_splat?session=`
  (`app/api/capture/live-splat/route.ts:18`), `/file?path=` (`studio.ts:80`),
  `/bigview?ply=&ref=&run=&live=` (`studio.ts:95`), `/album?run=` (`studio.ts:100`).
- The header says the studio origin sets COOP/COEP for SharedArrayBuffer and this one does
  not, so the viewer **must** open on :8899 (`studio.ts:5-7`).
- `.env.example:85-93` calls it "The local GPU box running Brush/COLMAP", and
  `.env.example:122` documents `python -m tools.live_capture_server.server --port 8765` for
  the :8765 half.

**Does the other end exist in this repository? Partly — and the important half does not.**

What *is* in-repo (`../tools/`, 255 tracked files):

- `../tools/live_capture_server/server.py` — a real `ThreadingHTTPServer`
  (`server.py:23,350,360`) serving the phone websocket / capture side on :8765. This half is
  genuinely here.
- `../tools/video_intel/splat_batch.py` — the batch pipeline. Its docstring
  (`splat_batch.py:3-14`) is the real architecture:
  `ffmpeg → COLMAP feature_extractor → sequential_matcher → mapper → sparse/0 → ComfyUI/pipeline_run.py (brush) → decoded result.ply`.
- `../tools/arkit_capture/export_colmap.py` — ARKit poses → COLMAP-format dataset
  (referenced `../REALTIME_SPLAT_PLAN.md:22-24, 53-54`).

- `../tools/arkit_capture/export_transforms.py` — ARKit → Nerfstudio `transforms.json`, the
  other format Brush eats.

What is **not** in this repository:

- The **:8899 studio HTTP server itself.** `../run_live_studio.sh:21-33` reveals where it
  lives: `cd "$(dirname "$0")/ComfyUI"` … `exec "$PYBIN" studio/server.py`. `ComfyUI/` is
  gitignored (`../.gitignore:54-55`, comment: *"External tool, cloned locally (125GB nested git
  repo) — never vendor it"*) and **does not exist on this machine**. `git log --all
  --diff-filter=A` for `*studio/server.py`, `*pipeline_run*`, `*bigview*` returns nothing — these
  files were never in this repo's history. Grepping the whole tree for `/api/runs`, `bigview`,
  `live_splat` finds only *callers*, shell scripts and docs; no route definition anywhere. There
  is no express/hono/`http.createServer` in the TS tree either.
- The **:8765 splat viewer**. `../REALTIME_SPLAT_PLAN.md:56-57` places it at
  `ComfyUI/custom_nodes/ComfyUI-HunyuanWorld-Mirror/viewer_server.py` — that is where
  `GET /file?path=` is actually implemented. Also absent.
- The **Brush trainer**. `../REALTIME_SPLAT_PLAN.md:16-18` is explicit: *"Brush is a BINARY ONLY
  at `~/Programming/brush-app-aarch64-apple-darwin/brush_app` … (150 MB, no Rust source on this
  machine). We can only drive its CLI."* No Rust, no `Cargo.toml`, no Burn/wgpu source anywhere
  in the tree; `.gitignore` also excludes `brush_bin/` and `target/`.
- A runnable `splat_batch.py`. It hardcodes another developer's machine at
  `../tools/video_intel/splat_batch.py:31-37`:
  `REPO = Path("/Users/notjackl3/Programming/hunyuanworld-mirror")`, with `COMFY`, `PY`,
  `PIPELINE`, `BRUSH_DATA`, `RUNS` all derived from it. On this Windows laptop this script
  cannot run at all without editing. `../BOOT.md:40-42` gives the same absolute path as the
  documented way to start the studio.

`../REALTIME_SPLAT_PLAN.md:38-42` is candid that its "what already exists" section inventories a
*different* repository: *"Desktop (repo root: `/Users/notjackl3/Programming/hunyuanworld-mirror`)"*,
listing the studio's real route table — `POST /api/run`, `GET /api/runs`,
`GET /api/capture/status`, `GET /api/sessions`, `POST /api/sessions/export`, `GET /api/frames`.

So: **the studio is a real system that lives on one specific Apple Silicon Mac inside a 125 GB
ComfyUI checkout, and this repo contains only clients for it plus the capture-side and
dataset-prep tooling.** `probeStudio()` on the user's laptop will fail at
`fetch("http://localhost:8899/api/runs")` and both studio targets will grey out. That is the
menu behaving correctly; it also means `studio-batch` is not a fallback the user actually has.

**One live bug found on the way past, unrelated to training but cheap to fix.** Port 8765 is
double-booked. `lib/studio.ts:21-22` points `VIEWER_URL` at the ComfyUI splat viewer on :8765,
while `.env.example:122-123` points `NEXT_PUBLIC_LIVE_CAPTURE_WS` at
`../tools/live_capture_server/server.py`, whose default port is also 8765
(`live_capture_server/server.py:370`) and whose entire route table is
`/health`, `/status.json`, `/`, `/dashboard*`, `WS /ws/phone`, `WS /ws/odometry`
(`server.py:70-88`) — none of the viewer's routes. Whichever process binds first wins. If a plan
touches the studio wiring, separate these.

(For completeness: `web/old/` holds 32 mascot `.webp` sprites and nothing else.
`../graphify-out/` is generated knowledge-graph output over these same docs, not source.)

### 1.5 `lib/gpu.ts` — what it proves and what it cannot

Detected (`GpuReport`, `gpu.ts:45-62`): WebGPU presence, adapter opened, a compute shader
that ran **and returned arithmetically correct output** (`gpu.ts:377-385`), software-rasteriser
detection by name (`gpu.ts:79`, `295-302`), `float32-blendable` feature, `maxStorageBufferBindingSize`,
and a throughput score in millions of fused ops/sec from a dependent-FMA chain
(`gpu.ts:222-233`, best-of-three after a warm-up, `gpu.ts:344-372`).

Hard gates that return `"none"` (`gpu.ts:113-120`): not verified, software, no
`float32-blendable`, or `maxStorageBufferBindingSize < 128 MiB`. Speed is explicitly **not** a
gate — `gpu.ts:126-131` records that gating on it was wrong because the same Iris Xe measured
58,356 then 15,884 on consecutive runs.

Tiers (`gpu.ts:132-134`) anchored on **one** measurement — Intel Iris Xe ≈ 95,000
(`gpu.ts:141`): `weak < 175_000`, `modest < 580_000`, `strong ≥ 580_000`. The comment at
`gpu.ts:96-100` admits the M3 Pro / 3060 / 4080 placements are *cross-checked, not measured* —
"One data point cannot calibrate a curve."

Budgets (`gpu.ts:161-196`) — note these are **claims about a trainer that does not exist**:

| tier | steps | max splats | res | frames | estimate |
|---|---|---|---|---|---|
| strong | 15,000 | 1.5 M | 1600 | 300 | "a few minutes" |
| modest | 6,000 | 500 k | 1080 | 150 | "5–15 minutes" |
| weak | 2,500 | 150 k | 720 | 80 | "15–40 minutes, and warm" |

**What `gpu.ts` cannot tell us.** It answers "can this device run a compute shader fast and
blend in f32". It says nothing about:

- whether a trainer exists (that is exactly why `BROWSER_TRAINER_AVAILABLE` is a separate
  constant — `targets.ts:42-50`);
- **VRAM / total memory.** WebGPU exposes no memory-size query; `maxStorageBufferBindingSize`
  is a *binding* limit, not available memory. A 150 k-splat scene plus gradients plus Adam
  moments plus the image batch is the real constraint and is unmeasured here;
- whether the WASM heap can hold the dataset (wasm32 caps at 4 GB, and `sampleFrames` already
  materialises frames as base64 data URLs, §1.7);
- **whether poses exist.** This is the actual determinant of success and the probe is blind to it;
- `f16` / `shader-f16` support, which most fast splat kernels want — the probe never checks it;
- timeslicing/watchdog behaviour: a long compute pass on integrated graphics can be killed by
  the OS GPU watchdog, and nothing here probes that.

Also worth flagging for honesty: `gpu.ts:9-13` asserts the CUDA assumption "is NOT true of the
one this repo actually uses: Brush is Rust + Burn + WGPU". Correct about Brush, but
`../tools/video_intel/splat_batch.py:3-8` shows the actual working pipeline is **COLMAP →
Brush**, and COLMAP is native C++ on the same box. The GPU probe's optimism is about the
second half of a two-half problem.

### 1.6 What a trainer must emit to be consumed with zero other changes

`lib/splat/renderer.ts:59-65`:

```
SPARK_FORMATS = ["ply", "spz", "splat", "ksplat", "sog"]
GS3D_FORMATS  = ["ply", "splat", "ksplat"]
```

Default engine is Spark (`renderer.ts:49-53`, `@sparkjsdev/spark 2.1`). The fallback engine is
`@mkkellogg/gaussian-splats-3d@0.4.7` loaded from `esm.sh` at runtime with its own pinned
`three@0.160.1` (`lib/splat/gs3d.ts:37-41`) — note it needs the network, and
`gs3d.ts:74-78` warns `sharedMemoryForWorkers` must stay `false` because this origin sets no
COOP/COEP.

`lib/video/plyBounds.ts` is the strictest constraint, because it parses bytes rather than
handing them to a library. `measurePly` (`plyBounds.ts:95`):

- requires an ASCII header terminated by `end_header\n` (`plyBounds.ts:66`);
- requires `element vertex N` (`plyBounds.ts:70-72`);
- **requires every property to be `float`** — `props.some((p) => p[1] !== "float")` returns
  `null` (`plyBounds.ts:75-77`), i.e. the INRIA/3DGS binary-little-endian float32 layout;
- reads the **first three float32s of each vertex as x,y,z** at stride
  `props.length * 4` (`plyBounds.ts:117-121`);
- checks `fileSize >= dataOffset + count*stride` (`plyBounds.ts:109`);
- returns trimmed 2%/98% percentile bounds and a camera at `centre + widest*1.25` on +Z
  (`plyBounds.ts:133-172`).

**So the target output is: a binary-little-endian PLY, all-float32 properties, x/y/z first,
INRIA 3DGS layout.** That is exactly what Brush's `decode_brush_ply()` already produces —
`../docs/brush_capability_report.md:27-28` records the decoded fields as
`x,y,z,red,green,blue,scale_*,rot_*`, 189,584 gaussians, loading in the :8765 viewer. Anything
else (SPZ, SOG, half-precision PLY) renders fine in Spark but returns `null` from `measurePly`,
so the auto-framed camera silently falls back to whatever default the caller had
(`plyBounds.ts:93-94`).

### 1.7 How much vision already runs in the browser — this is the interesting part

`lib/video/sampleFrames.ts` decodes video **entirely client-side** via an object URL and a
detached `<video>`, seeking rather than playing (`sampleFrames.ts:15-18`), drawing to a canvas.
Defaults `{ fps: 3, maxFrames: 240, maxEdge: 640 }` (`sampleFrames.ts:49`), output as JPEG
q0.82 data URLs (`sampleFrames.ts:147`). Both waits are on clocks — 20 s metadata, 15 s seek
(`sampleFrames.ts:72-73`) — and it refuses `video/quicktime` up front on Chrome
(`sampleFrames.ts:86-96`). This is a working, hardened frame extractor.

`lib/tracking.ts` is a real sparse tracker, hand-written, no dependencies:

- 3-level pyramid, coarse-to-fine **block matching** (SAD), deliberately not Lucas–Kanade
  because LK "diverges quietly on low texture, and its failures look like plausible motion
  rather than like errors" (`tracking.ts:20-28`);
- `PointTracker` (`tracking.ts:254`) keeps one point per cell of a 6×8 grid
  (`tracking.ts:271-272`), reseeded as points die (`tracking.ts:321-365`);
- **forward–backward consistency check with a 1.5 px threshold** (`tracking.ts:296-306`) —
  this is the standard robustness step and it is already here;
- texture gate `blockStdDev > 7` (`tracking.ts:269`), cost gate `maxCost 18` (`tracking.ts:270`);
- emits `medianFlow`, whose own comment names the downstream consumer: *"High means consecutive
  frames barely overlap, which is what actually starves a reconstructor — COLMAP needs shared
  features between neighbouring views."* (`tracking.ts:225-230`);
- stated budget: "~192 px frame at ~12 Hz, roughly a megaflop a frame" (`tracking.ts:28-29`),
  designed to share a phone with MediaRecorder and a WebRTC encoder.

`lib/coverage.ts` turns device orientation + tracked pixels into angular coverage:
`rotationMatrix` (`coverage.ts:241`), `cameraDirection` (`coverage.ts:292`), `focalFor`
(`coverage.ts:334`), `projectToScreen` (`coverage.ts:356`), and crucially `bearingOfPixel`
(`coverage.ts:386-410`) — the world-space **ray** through a pixel. 12 azimuth buckets, 5 needed
for green (`coverage.ts:64-67`).

**How much of the pose problem is this?** Less than it looks, and the file says so itself.
`coverage.ts:52-56`:

> No metric scale — angles only. So `acceptPoseNovelty`'s 0.15 m translation test has no
> equivalent here and keyframe tagging is NOT ported; coverage drives the HUD, not the pipeline.

Honest accounting of what exists vs what a pose solver needs:

| SfM ingredient | status here |
|---|---|
| frame extraction | **done** (`sampleFrames.ts`) |
| 2-frame sparse correspondences | **done** (`tracking.ts` — with FB check) |
| long multi-frame tracks | **partial** — tracks have ids and `age` (`tracking.ts:211-217`) but nothing persists a track's full 2D history; `TrackerUpdate` only carries current/lost/born |
| camera intrinsics | **guessed**, not calibrated — `ASSUMED_HFOV_DEG = 65` with the comment "There is no web API for it" (`coverage.ts:74-80`) |
| rotation | **approximated** from `DeviceOrientationEvent`, admitted to drift and to be non-absolute on Android (`coverage.ts:234-240`) |
| translation / baseline | **absent** |
| metric scale | **absent** (`coverage.ts:52-56`) |
| two-view geometry (E/F matrix, RANSAC, triangulation) | **absent** |
| bundle adjustment | **absent** |
| sparse point cloud for init | **absent** |

So: the front end of an SfM pipeline exists and is good. The geometry back end — the part that
is actually hard — does not exist at all. Calling this "half-solved" would be generous;
"the cheap third is solved" is closer.

### 1.8 `@sparkjsdev/spark` — renderer only

`package.json:25` — `"@sparkjsdev/spark": "^2.1.0"`. Per `lib/splat/renderer.ts:117-132` it is
described as the engine that "Opens every format here… Draws in the same scene as the object
markers." Everything the repo does with it is loading and drawing. **It does not train.** No
other dependency trains either — `package.json:19-45` has no Rust/WASM splat package, no
`onnxruntime-web`, no COLMAP binding. `@huggingface/transformers` (`package.json:22`) is
present, which is the only in-repo route to running a learned model in the browser today, and
it is used for object detection, not geometry.

---

## 2. Three candidate architectures

### (a) Pure in-browser WebGPU trainer

**What the user installs:** nothing. Chrome or Edge.

**What runs where:** everything in the tab. Frames from `sampleFrames.ts`, poses from ???,
training in a vendored Brush WASM build, output PLY straight into the Spark viewer.

**Reality check on the trainer half.** Brush's README states it "can be compiled to WASM" and
that training is "fully supported natively, on mobile, and in a browser", but qualifies:
*"Only works on Chrome and Edge. Firefox and Safari are hopefully supported soon"* and
*"only Chrome 134+ on Windows and macOS is currently supported"*
([github.com/ArthurBrussee/brush](https://github.com/ArthurBrussee/brush)). Radiance Fields'
write-up confirms you "begin training directly in the browser" and calls it "still a proof of
concept" / "experimental demo"
([radiancefields.com](https://radiancefields.com/gaussian-splatting-in-browser-brush)).
Licence: **Apache-2.0** (repo footer). Output: PLY
([Brush 0.2 coverage](https://radiancefields.com/brush-0-2-released)).

**Reality check on the pose half.** Brush's README: *"Brush takes in COLMAP data or datasets in
the Nerfstudio format"* — it does **not** do SfM and does **not** ingest video. Confirmed
independently by this repo's own plan: `../REALTIME_SPLAT_PLAN.md:21-24` says Brush trains from
posed data and that the project's answer was ARKit poses, *"the single biggest enabler — COLMAP
is normally the slow batch step."*

**Honest failure modes:**

1. **No poses.** Fatal, and unsolved. Everything else is secondary.
2. Chrome/Edge only, per the project's own README. On Firefox and Safari the target must grey
   out — which `targets.ts` is already structured to do.
3. WASM memory. wasm32 is capped at 4 GB and the current frame path holds base64 JPEG data URLs
   (`sampleFrames.ts:147`); 240 of them at 640 px is fine, but a training set at 720–1280 px is
   a different budget. **I have no measured browser-WASM memory figure for Brush** — see §5.
4. Integrated graphics. The repo's reference machine is an Intel Iris Xe with no dedicated VRAM
   (`gpu.ts:15-17`). Brush's README lists Intel cards as supported; nobody I found has published
   a training-time number for Brush-in-browser on integrated graphics.
5. Vendoring. Brush ships no npm package; the WASM has to be built (`wasm-pack`) and hosted.
   That is a Rust toolchain in the build, or a checked-in binary artefact.

**First splat on screen:** vendor Brush WASM → build a COLMAP-format dataset in JS (an
`images/` folder plus `cameras.txt`/`images.txt`/`points3D.txt`, which is text — easy) → feed it
**poses you obtained some other way** → flip `BROWSER_TRAINER_AVAILABLE` (`targets.ts:61`) in the
same commit, as the comment demands. With a *known-posed* test dataset this is days of work.
With handheld video it is blocked on §3.

### (b) A native local sidecar — the thing the code already half-assumes

**What the user installs:** a small local HTTP server that speaks the routes `lib/studio.ts`
already calls (`/api/runs`, `/api/live_splat`, `/file?path=`, `/bigview`), plus a pose solver
and Brush. Concretely, today's version of this is `ComfyUI/studio/server.py` +
`brush_app` + COLMAP, and the app was written against it.

**What runs where:** browser does UI, capture and the coverage HUD; sidecar does poses and
training; the browser fetches the resulting PLY. The seam already exists —
`app/api/capture/live-splat/route.ts` is a same-origin proxy so "the client stays ignorant of
the studio URL" (`live-splat/route.ts:5-6`).

**Honest failure modes:**

1. **The server is not in this repo** (§1.4) and the one script that drives training hardcodes
   a foreign absolute path (`../tools/video_intel/splat_batch.py:31`). Shipping this means
   *writing* the sidecar, not packaging it.
2. Install burden. COLMAP + a Brush binary + a Python env. The Brush binary alone is 150 MB
   (`../docs/brush_capability_report.md:3-4`).
3. Cross-platform. The existing binary is `aarch64-apple-darwin`
   (`../REALTIME_SPLAT_PLAN.md:16`) — Apple Silicon only. Windows/Linux needs a different build
   (Brush's README claims macOS/Windows/Linux and AMD/Nvidia/Intel, so this is a build problem,
   not a portability problem).
4. Trust/UX: a localhost server, a firewall prompt, a COOP/COEP origin split
   (`studio.ts:5-7`).
5. Live mode still needs the push that `dispatch.ts:119-134` does not do.

**First splat on screen:** it already worked once, on one Mac. Reproducing it on the user's
laptop = build/obtain a Windows Brush binary, install COLMAP, write a minimal server exposing
`/api/runs` + `/file?path=`, and either fix `splat_batch.py`'s paths or write a smaller runner.
This is the shortest path to *a real splat from handheld video*, and it is also the option that
requires the user to install several GB.

**Does it require CUDA?** Depends entirely which trainer:

- **Brush**: no. Rust + Burn + wgpu, README lists AMD/Nvidia/Intel, macOS/Windows/Linux, Android,
  browser. This is the whole reason `gpu.ts:9-13` exists.
- **gsplat / nerfstudio**: yes for GPU training. gsplat is a CUDA-accelerated rasteriser; AMD
  and Apple Silicon GPUs are not supported for accelerated training and there are long-standing
  open issues asking for AMD support with no implementation
  ([gsplat #771](https://github.com/nerfstudio-project/gsplat/issues/771),
  [#635](https://github.com/nerfstudio-project/gsplat/issues/635),
  [#434](https://github.com/nerfstudio-project/gsplat/issues/434)). A CPU fallback exists and is
  not a plan.
- **Postshot (Jawset)**: Windows 10+ and an NVIDIA GPU of compute capability ≥ 7.5 (RTX 2060 /
  Quadro T400 or better), 8 GB VRAM minimum; no macOS or Linux build
  ([jawset.com builds page](https://www.jawset.com/builds/postshot/windows/),
  [radiancefields platform page](https://radiancefields.com/platforms/postshot)). Excludes
  Apple Silicon, AMD, and all integrated graphics.

**I could not determine install sizes in GB** for nerfstudio/gsplat/COLMAP as actually installed —
see §5.

### (c) Hybrid — browser does frames/tracking/gating, something else solves

**What the user installs:** either a sidecar (as (b)) or nothing, if the heavy solve goes to a
service.

**What runs where:** `sampleFrames.ts` extracts, `tracking.ts` tracks, `coverage.ts` gates —
this is the part that already works and already has honest failure messages. The browser refuses
to ship a capture whose `medianFlow` is too high or whose bucket coverage is too thin, *before*
anything expensive happens. Then the solve goes elsewhere.

**Why this is the strongest option on paper:** it uses the repo's genuine asset. The most
expensive failure in this system is spending an unrepeatable KIRI credit (`dispatch.ts:147-167`)
or 40 minutes of laptop GPU on footage that was never going to reconstruct. `tracking.ts`'s
`medianFlow` and `coverage.ts`'s 5-of-12 bucket test are exactly the two predictors of SfM
failure — `../tools/video_intel/splat_batch.py:12-14` records that "COLMAP legitimately fails on
crowd/low-parallax footage".

**Honest failure modes:** it does not by itself produce a splat. It is a quality gate and a
router, and it makes every other option better without being one.

**First splat on screen:** none. This ships value in a week and makes (a) or (b) worth building.

---

## 3. The pose problem, on its own

Splat training needs per-image extrinsics + intrinsics, and (for good results) a sparse point
cloud for initialisation. This is the crux.

**How good do poses have to be?** I could not find a clean threshold, and I will not invent one.
What is documented: 3DGS "heavily depends on accurate camera poses from Structure-from-Motion",
and methods are "highly sensitive to pose inaccuracies, with even minor Gaussian noise (σ=0.01)
causing significant degradation, especially in sparse-view settings"
([Pose-Free 3DGS via Shape-Ray Estimation](https://arxiv.org/html/2505.22978)). Dense
video (200+ frames of a walk-around) is the *forgiving* end of this — the sparse-view case is
where noise kills it. See §5.

Ranked by "could this ship on a laptop this month":

**1. Sidestep it entirely — use the device's own VIO.** This is what this project already did and
it is the only one with measured evidence in-tree. ARKit poses + LiDAR points →
`../tools/arkit_capture/export_colmap.py` → Brush, **no SfM at all**
(`../REALTIME_SPLAT_PLAN.md:21-24, 108-109`). Measured on Apple Silicon
(`../docs/brush_capability_report.md:18-31`): 216-frame capture → 168 sharp images + 164,340
LiDAR init points **in ~12 s**, then Brush 500 steps → 189,584 gaussians that load in the
viewer. *Ships today, on an iPhone with LiDAR only.* The web equivalent — WebXR pose, or
`DeviceOrientation` + accelerometer double-integration — gives rotation but **no translation and
no scale** (`coverage.ts:52-56`), which is not enough.

**2. Native COLMAP or GLOMAP in a sidecar.** Known-good, already the batch path
(`../tools/video_intel/splat_batch.py:5-7`: feature_extractor → sequential_matcher → mapper).
Slow, C++, but it is the option with the fewest unknowns. GLOMAP is the faster global-mapper
successor. *Ships this month if you accept a native install.* I did not benchmark either — §5.

**3. Learned feed-forward pose: VGGT.** VGGT-1B (1 B params) infers extrinsics, intrinsics,
depth and point maps from one to hundreds of views, and — this is the operationally important
bit — **"We also support exporting VGGT's predictions directly to COLMAP format"**, and those
files "can be directly used with gsplat for Gaussian Splatting training"
([facebookresearch/vggt](https://github.com/facebookresearch/vggt)). That output is *exactly*
what Brush ingests. Licensing: the original VGGT-1B checkpoint is **non-commercial**; a separate
`VGGT-1B-Commercial` checkpoint was released 2025-07-29 licensed for commercial use excluding
military. Runs on CUDA with bf16/fp16, with a CPU fallback in the sample code; **no MPS/Apple
Silicon path is mentioned**. A memory-efficient community variant claims 83% VRAM reduction via
redundant-feature elimination, bf16 and batched frame-wise ops, enabling 1000+ images. *Verdict:
plausible in a sidecar on an NVIDIA laptop; not plausible in a browser; unverified on Apple
Silicon or on integrated graphics.* DUSt3R/MASt3R are the predecessors in the same family and
have the same shape of constraint (PyTorch, GPU, large checkpoint) — I did not verify their
current numbers within budget.

**4. Pose-free / pose-optimising splat trainers that jointly solve poses during training.** An
active and crowded research area: CF-3DGS processes frames sequentially and grows the Gaussian
set one frame at a time with no pre-computed poses
([oasisyang.github.io/colmap-free-3dgs](https://oasisyang.github.io/colmap-free-3dgs/),
[CVPR 2024 paper](https://openaccess.thecvf.com/content/CVPR2024/papers/Fu_COLMAP-Free_3D_Gaussian_Splatting_CVPR_2024_paper.pdf));
PCR-GS adds pose co-regularisation for drastic camera movement
([arXiv 2507.13891](https://arxiv.org/html/2507.13891v1)); 3R-GS is a "best practice" for
optimising poses alongside 3DGS ([zsh523.github.io/3R-GS](https://zsh523.github.io/3R-GS/));
VicaSplat does joint Gaussians + camera estimation from unposed video frames
([arXiv 2503.10286](https://arxiv.org/html/2503.10286v1)). The recurring documented caveat is
the one that matters for a handheld walk-around: these methods "work well for simple scenes with
smooth camera trajectories" but "struggle with more challenging cases — such as wide-baseline
views, rapid camera movements, or unordered image collections". **Every one of these is a
research PyTorch/CUDA repo, not a shippable artefact, and none of them has a WASM build.**
*Verdict: not a this-month option. Watch, don't build on.*

**5. Implement SfM in the browser.** Two-view geometry + RANSAC + triangulation + bundle
adjustment in WASM, seeded by `tracking.ts`. This is a real project — months — and the intrinsics
are guessed (`coverage.ts:74-80`). Not this month.

**One thing worth noticing.** Brush's own dataset format is COLMAP text
(`cameras.txt`/`images.txt`/`points3D.txt`). That means the pose solver is a *swappable
component behind a text-file interface*. Whatever produces poses — ARKit, COLMAP, VGGT, a future
in-browser solver — hands over the same three files. Design the seam there.

---

## 4. Comparison table

| | (a) In-browser WebGPU trainer | (b) Native sidecar | (c) Hybrid gate + remote/sidecar solve | (existing) KIRI |
|---|---|---|---|---|
| **User installs** | nothing (Chrome/Edge) | COLMAP + Brush binary + server; Brush alone is 150 MB (`../docs/brush_capability_report.md:4`); total GB **undetermined** | nothing extra for the browser half | nothing; an API key |
| **Apple Silicon?** | yes if Safari 26+ ever works; **today Chrome/Edge only** per Brush README | yes — this is the only config with measured evidence (`../docs/brush_capability_report.md:3`) | yes | yes |
| **AMD?** | yes in principle (wgpu) — unmeasured | yes with Brush; **no** with gsplat/nerfstudio/Postshot | yes | yes |
| **Integrated graphics?** | probe says capable (`gpu.ts:15-19`); **no measured Brush-in-browser number exists** | Brush claims Intel support; unmeasured | yes | yes |
| **Poses from handheld video** | **no solution** | COLMAP (works, slow) or VGGT (NVIDIA) | same as (b) | KIRI does it, cloud-side |
| **Time to first splat (eng)** | days *with posed test data*; **blocked** without | ~1–2 weeks (write server, source Windows Brush, wire COLMAP) | ~1 week for the gate; splat still needs (a) or (b) | already works |
| **Time to first splat (user, runtime)** | claimed 15–40 min on weak tier (`gpu.ts:184`) — **that estimate is not backed by a measurement** | measured on Apple Silicon *under GPU contention*: 500 steps/720 px/40 frames = **27 s**; 1500 = **71 s**; 4000 = **208 s**; 4000 @1280/80 = **473 s** (`../docs/brush_capability_report.md:38-47`) | + COLMAP time (unmeasured) | "a few minutes" (`dispatch.ts:284`), one credit |
| **Quality** | same trainer as (b) — bounded by budget and poses | proven: 189,584 gaussians from 168 frames (`../docs/brush_capability_report.md:27`) | same | known-good |
| **How much this repo already has** | frame extraction, GPU probe, budgets, PLY consumption, viewer, menu plumbing — **everything except the trainer and the poses** | every client (`lib/studio.ts`), the proxy route, the album, `tools/` prep scripts — **everything except the server and the binaries** | `sampleFrames.ts` + `tracking.ts` + `coverage.ts` are done and good | complete (`lib/reconstruction/kiri.ts`, `collect.ts`, preflight) |

Reference points for the runtime column: Brush 0.2 measured at **"about 17 steps a second" on an
M2** ([radiancefields.com](https://radiancefields.com/brush-0-2-released), the author's own
machine). At 17 steps/s, `gpu.ts`'s `modest` budget of 6,000 steps is ~6 minutes — consistent
with its "5–15 minutes". The `weak` (integrated) row has no anchor at all.

---

## 5. What I could not determine

Explicitly unknown. Do not let anyone fill these with a guess.

1. **How accurate poses must be before a splat looks acceptable.** No usable threshold found. The
   literature says "highly sensitive" and cites σ=0.01 noise causing significant degradation in
   *sparse-view* settings; I found nothing that maps ATE/RPE to perceived quality for a dense
   video walk-around, which is our case and the forgiving one.
2. **Any measured Brush-in-browser (WASM) training time, on any hardware.** The README claims
   in-browser training; Radiance Fields confirms it exists and calls it a proof of concept.
   Nobody I found published a number. The only Brush numbers that exist are **native**.
3. **Brush's WASM memory ceiling** and how many frames/splats fit under wasm32's 4 GB.
4. **Whether Brush's WASM build works on integrated graphics at all**, and whether Windows'
   GPU watchdog (TDR) kills long compute passes.
5. **Install size in GB** for COLMAP, nerfstudio, gsplat, or a Postshot install. Only the Brush
   binary (150 MB) is known.
6. **Whether a Windows/x86-64 `brush_app` prebuilt binary is published**, or whether it must be
   `cargo build --release` from source (`../REALTIME_SPLAT_PLAN.md:214` implies building from
   source is the expected route for anything beyond the shipped binary).
7. **VGGT's actual VRAM and wall-clock** for a 150–300 frame handheld clip on a laptop GPU. The
   README says "less than 1 second" to reconstruct a scene and gives no hardware, no frame count,
   and no memory table. The 83% VRAM-reduction variant is a community claim I did not verify.
8. **Whether VGGT (or DUSt3R/MASt3R) runs on Apple Silicon MPS or on CPU in tolerable time.** No
   MPS support is mentioned; a CPU fallback exists in the code but no timing.
9. **Current DUSt3R/MASt3R model sizes, licences and laptop feasibility** — deprioritised against
   VGGT within the research budget.
10. **Whether Brush has since gained pose optimisation or unposed input.** The README as fetched
    says COLMAP/Nerfstudio in, and neither the 0.2 write-up nor the README mentions pose
    refinement. I did not read the source or the issue tracker.
11. **What `ComfyUI/studio/server.py` and `viewer_server.py` actually implement.** Gitignored,
    never in git history, and absent from this machine, so every statement about the studio's
    behaviour is inferred from its clients and from `../BOOT.md` / `../REALTIME_SPLAT_PLAN.md`.
    In particular I cannot say how much of it is generic vs. bound to ComfyUI, i.e. how much
    would have to be rewritten to ship a standalone sidecar.
12. **Whether GLOMAP is meaningfully faster than COLMAP on this footage.** Not benchmarked.
13. **What the user's actual laptop is.** `gpu.ts:15-17` describes the machine the probe was
    written on (Intel Iris Xe). If that is the target machine, options (b)-with-gsplat and
    Postshot are both excluded outright, and (b)-with-Brush is the only native path.

---

## 6. If you want one recommendation

Build (c) now — it is a week, it uses what already works, and it is the only piece that reduces
wasted KIRI credits regardless of which trainer eventually wins. In parallel, do the *one* spike
that unblocks everything: **take a known-posed COLMAP dataset, run Brush's WASM build in Chrome
on the target laptop, and time it.** That single number decides between (a) and (b), and it is
the number nobody in the world has published.

Do not flip `BROWSER_TRAINER_AVAILABLE` (`lib/reconstruction/targets.ts:61`) until that spike
passes — the comment above it already says so, and it is right.

Separately, and cheaply: `dispatch.ts:131-133`'s two studio notes should stop claiming streaming
and queueing that no code performs. "Saved. Reconstruct it from the studio when it's running" is
true; "Streaming to the studio on your laptop" is not.

---

### Sources

- [github.com/ArthurBrussee/brush](https://github.com/ArthurBrussee/brush) — Brush README (Apache-2.0; COLMAP/Nerfstudio input; Chrome 134+ only)
- [radiancefields.com/gaussian-splatting-in-browser-brush](https://radiancefields.com/gaussian-splatting-in-browser-brush) — in-browser training confirmed, "proof of concept"
- [radiancefields.com/brush-0-2-released](https://radiancefields.com/brush-0-2-released) — "about 17 steps a second" on the author's M2
- [github.com/facebookresearch/vggt](https://github.com/facebookresearch/vggt) — VGGT-1B, COLMAP export, licence split, CUDA
- [arxiv.org/html/2505.22978](https://arxiv.org/html/2505.22978) — pose-noise sensitivity of 3DGS
- [oasisyang.github.io/colmap-free-3dgs](https://oasisyang.github.io/colmap-free-3dgs/) · [CVPR 2024 PDF](https://openaccess.thecvf.com/content/CVPR2024/papers/Fu_COLMAP-Free_3D_Gaussian_Splatting_CVPR_2024_paper.pdf) — CF-3DGS
- [arxiv.org/html/2507.13891v1](https://arxiv.org/html/2507.13891v1) — PCR-GS
- [zsh523.github.io/3R-GS](https://zsh523.github.io/3R-GS/) — joint pose + 3DGS optimisation
- [arxiv.org/html/2503.10286v1](https://arxiv.org/html/2503.10286v1) — VicaSplat, unposed video
- [gsplat issues #771](https://github.com/nerfstudio-project/gsplat/issues/771) · [#635](https://github.com/nerfstudio-project/gsplat/issues/635) · [#434](https://github.com/nerfstudio-project/gsplat/issues/434) — no AMD/Apple-Silicon GPU training
- [jawset.com/builds/postshot/windows](https://www.jawset.com/builds/postshot/windows/) · [radiancefields.com/platforms/postshot](https://radiancefields.com/platforms/postshot) — Windows + NVIDIA CC 7.5+ only
- [github.com/gpuweb/gpuweb/wiki/Implementation-Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) — WebGPU implementation status
- [webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/) — Safari 26 (macOS Tahoe 26 / iOS 26), Firefox 141 Windows / 145 macOS Apple Silicon
