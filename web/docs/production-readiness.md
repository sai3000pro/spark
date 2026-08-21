# Production readiness — measured, 2026-08-21

Written after a night of work on the local reconstruction pipeline and the
persistence layer. Everything marked ✅ was **run on this machine**, not
reasoned about. Everything marked ❌ or ⚠️ is stated with what it would take.

---

## The short version

**The app builds, and it can now make a Gaussian splat on this laptop end to
end.** Neither of those was true yesterday.

**It is not yet deployable to a multi-instance host**, and the reason is one
thing: nine of ten stores kept their data in process memory. Four of the worst
are fixed. The rest of the gap is Supabase, which is designed, migrated, and
unwired — and could not be wired here because this deployment has no project
configured.

---

## Verified working

| | Evidence |
|---|---|
| ✅ Production build | `npm run build` exit 0, 40+ routes, middleware registered |
| ✅ Typecheck / lint | `tsc --noEmit` 0, `eslint` 0 |
| ✅ Existing suites | verify-pipeline, verify-journey — "All invariants hold" |
| ✅ New persistence suite | `verify-persistence`, **56 checks, 0 failures** |
| ✅ Local splat, synthetic | 24/24 frames placed, 45,533 gaussians, 10.2 MB |
| ✅ Local splat, **your footage** | **119/119 frames placed, 16,671 tie points, 0.73 px** |
| ✅ PLY compatible with the app | `measurePly` accepts it; 59 float32 props, stride 236, `dataOffset + count*stride` == file size **exactly** |
| ✅ Studio HTTP surface | every endpoint `lib/studio.ts` expects; `/file?path=` traversal → 403 |
| ✅ Capture-flow suite | run against a **live dev server** — "The capture flow holds." |
| ✅ App ↔ studio integration | with the studio up, `/api/reconstruction/targets` reports `studio-batch` available |

### Measured cost, Intel laptop, no CUDA

| Stage | |
|---|---|
| Feature extraction, 119 frames @1080×1920 | ~2.5 min (~6.5k features/frame) |
| Full COLMAP solve, 60 synthetic frames | 135 s @ 0.41 px |
| Training | ~9 min per 2,000 steps at 1600px |
| **Realistic total for one clip** | **45–60 min at the `fast` preset** |

This is the number the research doc flagged as most-needed and never measured.
It is *far* better than the 30 min–2 h extrapolation for the pose half.

---

## What still blocks production

### 1. Durable storage beyond one machine — **the real blocker**

`lib/persist.ts` now writes sidecars to `.data/`, and four stores use it:

| store | before | now |
|---|---|---|
| `splatJobs` | durable already | unchanged |
| `journey/store` | **`/journey/<id>` 404'd after restart** | ✅ durable |
| `uploadedTrips` | walks lost | ✅ durable, incl. late `attachSplat`/`setWalkPlace` |
| `albums` | user-named albums lost | ✅ durable, delete means delete |
| `postedWalks` | privacy choices reverted | ✅ durable |
| `reconstruction/keys` | in memory | ⚠️ **deliberately left** — see below |
| `push/registry` | in memory | ⚠️ durable, but **not covered by the suite** — the module imports `server-only` (correctly: it holds the service-role key), so it cannot run under `tsx`. Verified by `npm run build` and by following the tested `postedWalks` shape. A weaker guarantee than the rest; said plainly here. |
| `storage/ledger` | in memory | ❌ risks orphaning paid objects |
| `handoff` | in memory | ❌ breaks a phone mid-handoff |
| `liveTrip` | in memory | correct as-is — genuinely ephemeral |

**`keys.ts` is excluded on purpose and should stay excluded.** It holds a live
KIRI API credential someone typed in. Writing it to a plaintext sidecar would
create a secret that survives the process, lands in backups, and sits one
`.gitignore` mistake from a commit — to save one paste after a restart, when the
key normally lives in `.env`, which is already durable and already handled the
way secrets need handling. If it must persist: OS keychain, or Supabase with the
value encrypted at rest.

**On Vercel, sidecars buy nothing.** Each invocation gets its own filesystem.
Single-machine deployment is correct today; multi-instance needs Postgres.

### 2. Supabase is designed and unwired

`supabase/migrations/` has nine files including `007_rls.sql`. Nothing at runtime
reads them. `lib/db/config.ts` returns `null` with no project configured, and
every auth surface degrades to a no-op by design.

**I did not write a Supabase layer, and that was deliberate.** With no
credentials I could not run a single query against it. Shipping an untested
database layer into a codebase whose entire discipline is "never claim what you
have not verified" would be the wrong trade — and an untested persistence layer
fails silently in exactly the way that loses data. `hydrate`/`persist`/`forget`
is a three-function seam; that is the swap, when there is a project to test it
against.

**What you need to do:** create a Supabase project, put the URL and anon key in
`.env.local`, apply the migrations. Then the swap is mechanical and testable.

### 3. The landing page is mock data

`app/page.tsx` and `/trip/[tripId]` render nine authored walks from
`lib/mock/trips/`. Fine for a demo, and it is the first thing a real user sees.

### 4. Live capture is wired — and only offered when it can work

This was the unfinished half, and it is now connected. The browser streams to
`tools/live_capture_server`, which writes `phone/frames/000001.jpg`;
`spark_studio` read `images/frame_00001.jpg`. Same JPEGs, two conventions,
nothing joining them. The bridge turned out to be a directory lookup.

More importantly, **live is offered only when frames can actually arrive.**
`probeStudio()` reads the status of `/api/live_splat` as a capability answer, so
that status is now derived from a measured fact — whether the capture server is
reachable. `spark_studio` can solve and train a growing session but cannot
receive a single frame.

Verified in both directions against the running app:

| | |
|---|---|
| capture server up | `studio-live` **available** |
| capture server killed | `studio-live` **blocked**, with a reason naming what is missing |

**To use it:** run the capture server and point the studio at the same root.

```bash
python tools/live_capture_server/server.py --port 8765 --root live_sessions
python -m spark_studio serve --sessions live_sessions
```

`serve` prints which state it is in at startup rather than leaving it to be
discovered when a capture produces nothing.

**Still untested with a real phone.** The layout bridge was verified against a
synthetic capture-server directory, not against frames arriving over the
WebSocket from an actual device. That is the next thing to try.

### 5. Four screens still need a studio running

`/album`, `/capture`, `/library`, `/walk` read from `STUDIO_URL`. That is now
satisfiable — `python -m spark_studio serve` — where before it required a
125 GB ComfyUI checkout that is not in this repo. The blocked-reason text in
`targets.ts` now names the command.

---

## What I did overnight

Six commits on `feat/capture-flow-and-gpu-targets`, all pushed.

1. **`tools/spark_studio/`** — video → `.ply` on this machine. Three stages kept
   deliberately apart (`ffmpeg` → `pycolmap` → `brush`), a `PoseSolver` seam
   where ARKit slots in, a watcher that runs each job as a subprocess so native
   crashes cannot take the server down, and a `selftest` that generates a scene
   which *must* solve — so a failure means the install, not your footage.
2. **`dispatch.ts` honesty fix** — it claimed *"Streaming to the studio on your
   laptop"* from a branch with no fetch, no socket, no queue call. Half of that
   is now true (the watcher really does poll `.uploads`); the streaming half
   could not be made true and now says what actually happens.
3. **`lib/persist.ts` + four stores** — atomic temp-then-rename writes, validated
   reads that drop rather than repair.
4. **`verify-persistence.ts`** — 56 checks, restart-simulated rather than faked.
5. **Build fix** — durable albums leaked `node:fs` into the browser bundle
   through a *pure* function that happened to share a module with the store.

### Two things that cost real time and are worth knowing

**`tsc --noEmit` does not catch a `node:fs` leak into the client bundle.** It
typechecks clean and Turbopack panics, naming an unrelated route. **The check is
`npm run build`.** A function the browser needs must not live in a module the
server needs disk for, however pure that function is.

**White noise is the worst possible input to SIFT.** My first synthetic test
scene used per-pixel random colour on the theory that noise is maximally
featureful. It is identical at every scale, so the matcher pairs descriptors at
random, and COLMAP's verdict on geometrically perfect input was *"no good initial
image pair found."* Real blank walls fail the same way — which is why
"footage with no parallax cannot be solved" is a first-class error message.

---

## What I deliberately did not do

- **No deployment**, no production infrastructure, no DNS, no hosting config.
- **No Supabase account**, no credentials created.
- **No force-push, no merge to `main`.** Everything is on the feature branch.
- **No untested database layer.**

---

## Recommended order

1. **Create the Supabase project** and put credentials in `.env.local`. Nothing
   else about multi-instance production can be tested until this exists.
2. **Swap the four persisted stores onto it** behind the existing seam, keeping
   the sidecar path as the unconfigured fallback — the shape `lib/db/config.ts`
   already establishes.
3. **Persist `handoff`, `push/registry`, `storage/ledger`** — or move them in the
   same swap.
4. **Decide what the landing page shows** to a real user with no walks yet.
5. **Package `spark_studio`** as a one-file installer, once you have used it
   enough to trust it.

---

## Try it yourself

```bash
cd tools
../.venv-splat/Scripts/python -m spark_studio doctor      # all three green
../.venv-splat/Scripts/python -m spark_studio selftest    # ~10 min, proves the install
../.venv-splat/Scripts/python -m spark_studio serve       # the app finds it on :8899
```

`.venv-splat/` and `.studio/` are gitignored; both are rebuildable from
`tools/spark_studio/README.md`.
