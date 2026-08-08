# Video → Gaussian Splat: Techniques Guide

Plain-English explanation of every technique in this pipeline — what it does, when
to use it, pros and cons. Written so a non-specialist can follow.

> **The goal:** take a long video, automatically find the *memorable moments*,
> understand *what's happening*, and turn the good ones into explorable 3D
> "Gaussian splats" you can fly around — without hand-picking anything.

---

## 0. Quick glossary

| Term | Plain meaning |
|---|---|
| **Gaussian splat** | A 3D scene made of millions of tiny fuzzy colored blobs ("gaussians"). Renders photorealistically and you can orbit it. |
| **COLMAP** | Classic software that figures out *where the camera was* for each photo (and a rough 3D point cloud) by matching features between images. |
| **Parallax** | The apparent shift of objects when the camera moves sideways. It's what lets any method recover real 3D. **No parallax → no 3D.** |
| **Floaters** | Junk semi-transparent blobs floating in empty space — the main quality problem. |
| **VLM** | Vision-Language Model (e.g. Gemini, GPT-4o, Claude) — an AI that can look at images and describe them. |
| **Feedforward** | An AI that guesses 3D directly from images in one shot, instead of triangulating it. Fast but can hallucinate. |

---

## The pipeline at a glance

```
video ─▶ [1] find moments ─▶ [2] label them (AI) ─▶ pick highlights
                                                        │
      [3] prepare frames ◀───────────────────────────┘
        (sharpen / deblur / mask sky)
                │
      [4] reconstruct ─▶ [5] clean up ─▶ [6] view & compare
      (brush/hybrid/ffwd)   (prune)      (browser viewers)
```

---

## 1. Moment segmentation — *chop the long video into "moments"*

Splits a continuous video into short segments so we can treat each one separately.

**How:** samples a frame every ~2s, computes a color "fingerprint" of each, and
starts a new moment whenever the scene drifts enough (you walked somewhere new),
capped so no moment is too long/short. No AI needed.

| Pros | Cons |
|---|---|
| Instant, free, no AI | Color-based — can't tell "new place" from "someone in red walked by" |
| Works on any video | On a continuous walk it cuts roughly every 10–30s (coarse) |
| Foundation for everything else | Would be much better with camera-motion or audio cues (not available for a downloaded video) |

---

## 2. Semantic labeling — *understand what's happening*

Sends a few sharp frames per moment to a **VLM** and gets back a label, description,
tags, a "how memorable" score, and a "can this be a 3D splat?" score.

**Backends (pick one):**

| Backend | Cost | Notes |
|---|---|---|
| **Google Gemini** | ~$0.02 / 30-min video | Cheapest, can read whole video, easiest. **Default.** |
| **OpenAI GPT-5/4o** | ~$0.10 | Frame-based, works fine |
| **Local Qwen2.5-VL** | free | Runs on your Mac, private, more setup |

| Pros | Cons |
|---|---|
| Turns raw video into a searchable timeline | Costs a few cents (unless local) |
| Reads signs/text, identifies places & activities | Sends frames to a cloud API (unless local) |
| The "splat feasibility" score auto-picks what's worth reconstructing | Its feasibility guess doesn't always match reality (see findings) |

---

## 3. Frame preparation — *clean the input before reconstruction*

Garbage in, garbage out. Three optional cleanups, all **general** (they adapt to
each video, no hand-tuning):

### 3a. Sharpness gate — *drop blurry frames*
Scores each frame's sharpness and removes the blurriest X% (relative to *this*
video). Blurry frames confuse the camera solver.

| Pros | Cons |
|---|---|
| Removes motion-blur that corrupts matching | If you drop too many you lose coverage |
| Cheap, no AI | Only helps if some frames are actually blurry |

### 3b. Deblur — *sharpen soft frames*
Applies an unsharp filter before reconstruction. **Consistently helped** in testing.

| Pros | Cons |
|---|---|
| Small but reliable quality win (better matches, tighter scene) | Not a magic fix; can amplify noise if overdone |
| Cheap | True "blur-aware" methods (BAD-Gaussians) need a different trainer we don't have |

### 3c. Sky masking — *ignore the sky* ⭐ (the outdoor fix)
Blacks out the sky in each frame so the camera solver never tries to place 3D
points there. Sky has no real depth → without this it becomes far-flung "splash"
floaters that blow up the whole scene.

| Pros | Cons |
|---|---|
| Bounds the scene when it has enough texture (test: +25% frames registered, scene extent halved) | **Not a free win** — it also removes features, so it can *hurt* a feature-starved / already-unstable solve (test: made a marginal moment worse) |
| Best paired with deblur, which adds features back | Current detector is a heuristic (bright + top-of-frame); a learned segmenter would be more robust |
| Directly attacks the outdoor "splash" | Doesn't yet mask moving people (a separate future step) |

> **Rule of thumb:** use sky-mask **with deblur** on textured outdoor scenes; skip
> it if COLMAP is already barely registering frames.

---

## 4. Reconstruction pipelines — *the three ways to build the splat*

This is the biggest choice. Three fundamentally different methods:

### 4a. Brush (COLMAP → optimize) — the workhorse
COLMAP finds the camera positions, then Brush optimizes gaussians to match all
the photos. **Real multi-view triangulation.**

| Pros | Cons |
|---|---|
| Geometrically faithful — real surfaces | Needs real parallax (you must move the camera) |
| Best all-round quality | COLMAP can fail on textureless/crowded/low-overlap footage |
| Reliable when capture is decent | Scene scale can be unstable outdoors (sky) — fix with sky-mask |

### 4b. Hybrid (COLMAP + dense AI init) — best for shaky scale
Uses COLMAP's cameras but seeds the optimizer with a **dense AI-predicted point
cloud** (HunyuanWorld). The dense seed anchors the geometry.

| Pros | Cons |
|---|---|
| **Best at stabilizing scene scale** (stopped the outdoor blow-up in tests) | Slower (runs an extra AI model) |
| Fills sparse areas COLMAP misses | Raw output is noisier (needs pruning) |

### 4c. Feedforward (generative) — fast but "flat"
An AI guesses 3D directly from the frames, no COLMAP. It predicts a depth per
pixel and shoots points along camera rays.

| Pros | Cons |
|---|---|
| No camera-solving step; works when COLMAP fails | **Not a real 3D scene** — a shallow "2.5D relief" |
| Very dense, compact | Looks great head-on, **bursts into a "splash" when you orbit** |
| Good for bounded/object scenes | Bad for open outdoor scenes (unbounded depth + sky) |

---

## 5. Post-processing — *clean the finished splat*

### 5a. Prune ⭐ (the reliable floater fix)
After training, remove the near-invisible floaters: drop the lowest-opacity
gaussians and any far-flung outliers (relative thresholds).

| Pros | Cons |
|---|---|
| **Reliably kills floaters** (56% → 0% in tests) and shrinks the scene 3–4× | Loses ~half the gaussians (they were junk anyway) |
| Works on *any* splat, any method | Very aggressive settings could trim real thin structures |

### 5b. Opacity regularization — ❌ *tried and rejected*
Attempted to push the model to make fewer floaters *during* training.

| Pros | Cons |
|---|---|
| Sound idea in principle | **Collapsed the splat at every setting** (destroyed it). Don't use — prune instead. |

---

## 6. Viewing — *how you look at the result (this matters!)*

**Two viewers, and they can make the same splat look very different:**

| Viewer | What it does | Use it for |
|---|---|---|
| **`:8765` point-viewer** | Draws every gaussian *center* as a solid dot, ignoring opacity | Quick peek; **but it makes floaters look worse than they are** |
| **bigview ("splat ↗")** | True gaussian render — fades low-opacity blobs by transparency | **Judging real quality** — always prefer this |

> ⚠️ A splat that looks like a "scattered mess" in the point-viewer often looks
> fine in bigview, because ~half the blobs are near-invisible floaters the
> point-viewer wrongly draws solid.

### Reference frame overlay
Bottom-right of each viewer shows the **source frame** the splat came from, and as
you orbit it **swaps to the frame nearest your angle** (using the real camera
poses). Lets you compare render vs reality from every side.

---

## 7. Analytics & self-check — *judge by quality, not size*

Every run logs: time per stage, camera-solve quality, gaussian count, **and
quality metrics** (median opacity, floater %, scene extent).

> **Key lesson: gaussian count is NOT quality.** 500k gaussians with low opacity =
> a floater cloud. Always check opacity/extent, and view in bigview.

Clickable **filters** in the UI let you slice runs by pipeline (brush/hybrid/
feedforward), technique (base/deblur/sharp/sky-mask), post (pruned), and source.

---

## 8. Findings so far & recommended recipe

**What worked (validated by controlled comparison):**
- ✅ **Prune** — the reliable floater fix.
- ✅ **Deblur** — small consistent win.
- ✅ **Hybrid dense-init** — best for scale stability.
- ✅ **Sky masking** — the outdoor fix (bounds the scene).
- ❌ **Opacity regularization** — collapses the splat, abandoned.
- ⚠️ **Feedforward** — compact but flat; wrong tool for open outdoors.

**Recommended recipe for a general scene:**
```
deblur  →  (sky-mask if outdoor)  →  COLMAP → Brush  →  prune
           add hybrid dense-init if the scene scale is unstable
```

**The uncomfortable truth about capture:** splatting wants you to **orbit a
subject**, not walk past it. A forward-walking video (like the Toronto market test
clip) gives weak parallax and only front coverage, so *every* method struggles.
A deliberate iPhone capture that circles the subject will beat any amount of
post-processing on a walkthrough.

---

## 9. What's still worth building
- **Learned sky/person segmentation** (replace the heuristic mask; add dynamic-
  object masking for crowds).
- **Generative hole-filling** (diffusion) to invent unseen sides — the only way to
  make an open outdoor scene look "enclosed" from all angles.
- **Audio + camera-motion cues** for smarter moment segmentation (needs a real
  capture, not a downloaded video).
