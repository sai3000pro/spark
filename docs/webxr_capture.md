# WebXR posed capture — skipping the camera solve

## What this is

Three stages turn a video into a splat:

    video --ffmpeg--> frames --COLMAP--> camera poses --Brush--> splat.ply

Stage 2 is the expensive, fragile one: roughly 2.5 minutes for 119 frames, and
an outright failure on footage with no parallax. It exists to answer one
question — *where was the camera* — and an Android phone running ARCore already
knows the answer to 6 degrees of freedom, every frame, for free.

This path records the poses the phone already has, writes them as a COLMAP text
model, and hands the studio a dataset with **stage 2 already done**.

It is the browser twin of `tools/arkit_capture/export_colmap.py`, which does the
same thing from a native iOS capture. Both feed
`tools/spark_studio/poses.py::PrecomputedSolver`, which consumes an existing
model and returns without solving anything.

**This is not in-browser training.** No Gaussian-splat trainer runs in a tab.
Brush v0.3.0 publishes three native desktop binaries and no wasm artifact, so
there is nothing to vendor and `BROWSER_TRAINER_AVAILABLE` in
`web/lib/reconstruction/targets.ts` stays `false`. Training still happens on the
laptop; it just starts immediately instead of after a COLMAP solve.

## Where the pieces are

| File | What it does |
|---|---|
| `web/lib/webxr/math.ts` | WebXR camera-to-world → COLMAP world-to-camera. The inversion and the basis flip. |
| `web/lib/webxr/intrinsics.ts` | `XRView.projectionMatrix` → PINHOLE `fx fy cx cy`. |
| `web/lib/webxr/colmap.ts` | The three `sparse/0/*.txt` files, and the projection used to test them. |
| `web/lib/webxr/record.ts` | The wire record. Shared by phone and server — deliberately NOT in `capture.ts`. |
| `web/lib/webxr/capture.ts` | The session: opens `immersive-ar`, reads camera images and poses. **Unproven.** |
| `web/lib/webxr/support.ts` | What this phone can do, and the sentence to show when it cannot. |
| `web/app/m/[handoffId]/WebXRCapture.tsx` | The option on the phone. |
| `web/app/api/capture/posed/[handoffId]/route.ts` | Receives the capture, writes the dataset. |
| `tools/spark_studio/verify_webxr.py` | Second opinion from pycolmap. |
| `web/scripts/verify-webxr.ts` | Everything provable without a phone. |

## What is proven, and what is not

**Proven on this machine, by running it:**

- The coordinate conversion agrees with pycolmap's own reader to 6e-7 px across
  48 projections, and camera centres to 5e-9 m.
- Intrinsics round-trip exactly through an **off-axis** frustum (a symmetric one
  proves nothing — both sign conventions give the image centre).
- `PrecomputedSolver` accepts the emitted model and counts every image.
- The HTTP route accepts a capture, writes the dataset, and refuses a non-rigid
  pose (422) or a frame missing its image (400) without leaving anything behind.
- **Brush trains from it.** `python -m spark_studio <dataset> --preset fast
  --steps 500` on a 12-camera synthetic dataset with an EMPTY `points3D.txt`
  produced `export_500.ply`, 13,295 gaussians, in 12 seconds — stages 1 and 2
  both skipped. So an empty point cloud is tolerated; Brush initialises without
  one.

**Not proven, and must not be claimed:**

- **Anything inside a real WebXR session.** No Android device exists on this
  machine. The permission prompt, the camera texture, the frame pacing, the
  y-flip, the JPEG encode — all written against the specs, none executed.
- **Reconstruction QUALITY from a point-free model.** The Brush run above used
  1×1 synthetic images; it proves the format is accepted, not that a real
  capture looks good. The iOS path seeds `points3D.txt` with ~164k LiDAR points
  (`docs/brush_capability_report.md`, S0.1) and a browser has no depth sensor.
  Whether that costs visible quality on real footage is open.
- **That any phone grants `camera-access`.** It cannot be probed without a user
  gesture; the UI says so rather than promising.

## The manual test, for someone with an Android phone

You need: an Android phone with **Google Play Services for AR** installed,
Chrome 90+, and the laptop and phone on the same Wi-Fi.

1. **Serve over HTTPS.** WebXR is secure-context only, with no exception for a
   LAN IP. A tunnel is the usual way (`lib/net.ts` describes the arrangement);
   `http://localhost` on the laptop does not help the phone.

2. **Open a handoff on the laptop** and scan the QR with the phone. The phone
   lands on `/m/<handoffId>`.

3. **Check the capability report first, before tapping anything.** On the
   capture screen, "Scan with position tracking" should be *enabled*, with the
   note that camera access will be confirmed when you start.
   - If it is greyed out, read the reason. It should name a fact, not a code.
   - Repeat step 3 on an **iPhone**. The option must be greyed with a sentence
     naming Safari, and must not suggest trying another browser.

4. **Tap it.** Chrome should show the AR permission prompt, then a camera view.
   If `requestSession` fails, the page must return to the offer with the
   browser's own message attached — that is the `camera-access` refusal path,
   and confirming it is as valuable as the happy path.

5. **Walk a full circle around a subject**, 2–3 m away, slowly, keeping it in
   frame. The counter should climb only while you MOVE — stand still and it
   should stop. That is the movement-spacing rule in `capture.ts` working.
   Aim for 60–150 frames.

6. **Tap "Done".** It uploads and the page reports the frame count.

7. **On the laptop**, find the dataset (the route's response names it; default
   `web/.captures/wx_<timestamp>_<rand>/`) and check:
   ```
   ls <dataset>/images | head          # frame_00001.jpg ...
   head -3 <dataset>/sparse/0/images.txt
   .venv-splat/Scripts/python.exe tools/spark_studio/verify_webxr.py <dataset>
   ```
   The verifier will skip the projection comparison (there is no
   `expected_projections.json` for a real capture) but will still confirm
   pycolmap parses it and `PrecomputedSolver` accepts it.

8. **Reconstruct:**
   ```
   cd tools
   ../.venv-splat/Scripts/python.exe -m spark_studio <dataset> --preset fast
   ```
   It must print `reusing N frames already extracted` and `reusing camera poses
   for N frames` — those two lines are the whole point, and they mean COLMAP
   never ran.

9. **Look at the splat.** This is the step that cannot be faked. If the geometry
   is mirrored, or the scene is upside down, or it will not converge, the
   conversion is wrong in a way none of the synthetic tests caught — write down
   which, and add a case to `web/scripts/verify-webxr.ts` before fixing it.

### If it comes out wrong, the raw data is kept

`<dataset>/webxr.json` holds every `cameraToWorld` and `projection` matrix
exactly as the platform produced it, plus the user agent. A corrected conversion
can be re-run against that file without anyone re-filming.

## Running the verifiers here

```
cd web
npx tsx scripts/verify-webxr.ts
cd ..
.venv-splat/Scripts/python.exe tools/spark_studio/verify_webxr.py
```

The first writes a synthetic 12-camera dataset to the system temp directory; the
second reads it back with pycolmap and compares. Run them in that order.
