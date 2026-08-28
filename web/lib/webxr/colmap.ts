/**
 * A posed WebXR capture, written as the three COLMAP text files.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE SEAM, AND IT IS A FILE FORMAT ON PURPOSE
 *
 * `tools/spark_studio/poses.py` draws the boundary of stage 2 at "a directory
 * containing sparse/0/{cameras,images,points3D}.txt", not at "run COLMAP",
 * precisely so that anything able to produce that triple can stand in for the
 * solve. `tools/arkit_capture/export_colmap.py` is the existing proof of that
 * on iOS. This module is the same trick from a browser, and it emits BYTE-FOR-
 * BYTE the same shape of file, because the format that is known to feed Brush
 * successfully (docs/brush_capability_report.md, S0.1) is the one to copy
 * rather than the one to improve on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FILENAMES ARE LOAD-BEARING, ANNOYINGLY
 *
 * Frames are named `frame_%05d.jpg`. Not a style choice — three separate
 * consumers disagree about what a frame is called and this is the only name all
 * three accept:
 *
 *   · `pipeline.py::_has_frames` globs `frame_*.jpg`, and it is what makes the
 *     pipeline SKIP extraction on a dataset that arrived already framed. Name
 *     them `000001.jpg` and stage 1 decides there are no frames, then tries to
 *     run ffmpeg on a video that does not exist.
 *   · `poses.py::list_images` globs `*.jpg` — happy either way.
 *   · COLMAP's `images.txt` NAME field must match the file on disk exactly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE CAMERA RECORD PER IMAGE
 *
 * Same as export_colmap.py. It looks wasteful next to a single shared PINHOLE
 * entry, and it is the correct default anyway: WebXR is free to change the
 * projection matrix mid-session (the compositor can re-crop the passthrough
 * image on an orientation change), and a shared camera would silently apply the
 * first frame's focal length to every frame after it. Deduplication would be an
 * optimisation whose failure mode is a wrong reconstruction, so it is not done.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * points3D.txt IS WRITTEN EMPTY, AND THAT IS A REAL DIFFERENCE FROM ARKit
 *
 * The iOS path fills it with LiDAR points — S0.1's dataset carried 164 340 of
 * them as the initial splat cloud. A browser has no depth sensor of any kind, so
 * there is nothing honest to put here and the file carries its header and
 * nothing else. It is still WRITTEN, because `PrecomputedSolver` requires all
 * three files to exist and treats a missing one as a failed solve.
 *
 * Brush ACCEPTS one: measured on this machine, a 12-camera model written by this
 * file with an empty points3D.txt trained to 13,295 gaussians in 12 s. What is
 * NOT established is what it COSTS — S0.1's splat was seeded from that LiDAR
 * cloud, and whether starting from nothing costs visible quality on real footage
 * needs a real capture. See docs/webxr_capture.md.
 */

import {
  colmapPoseFromXrCameraToWorld,
  rotationFromQuat,
  type ColmapPose,
  type Mat4,
  type Vec3,
} from "./math";
import type { PinholeIntrinsics } from "./intrinsics";

/**
 * One frame, ready to be written.
 *
 * Distinct from `./record.ts`'s `CapturedFrameRecord`, which is the WIRE shape:
 * that one carries the raw projection matrix and both image sizes, this one
 * carries the intrinsics already derived from them. Collapsing the two would
 * mean this module either re-deriving intrinsics it was handed, or trusting a
 * pair it did not compute.
 */
export interface PosedFrame {
  /** 1-based, dense, in capture order. Becomes the image id and the filename. */
  index: number;
  /** `XRView.transform.matrix` verbatim: camera-to-world, column-major. */
  cameraToWorld: Mat4;
  /** Derived from that view's projection matrix and the camera image size. */
  intrinsics: PinholeIntrinsics;
  /** `XRFrame`'s `predictedDisplayTime`, kept only for provenance. */
  timestampMs?: number;
}

/** `frame_00001.jpg`. See the filename note above before changing this. */
export function frameFileName(index: number): string {
  return `frame_${String(index).padStart(5, "0")}.jpg`;
}

/**
 * Fixed-point, never exponential.
 *
 * `String(1e-7)` is `"1e-7"`, and COLMAP's text reader does not parse that — it
 * reads the field with a plain float scan and stops at the `e`, silently taking
 * the value as 1. A camera one ten-millionth of a metre from the origin is a
 * perfectly ordinary thing for the first frame of a session to be, so this is
 * not a hypothetical.
 */
function fixed(n: number, places: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Refusing to write a non-finite value (${n}) into a COLMAP model.`);
  }
  return n.toFixed(places);
}

/** `# Camera list` plus one PINHOLE record per frame. */
export function camerasTxt(frames: readonly PosedFrame[]): string {
  const lines = frames.map((f) => {
    const k = f.intrinsics;
    return (
      `${f.index} PINHOLE ${Math.round(k.width)} ${Math.round(k.height)} ` +
      `${fixed(k.fx, 6)} ${fixed(k.fy, 6)} ${fixed(k.cx, 6)} ${fixed(k.cy, 6)}`
    );
  });
  return `# Camera list\n${lines.join("\n")}\n`;
}

/**
 * `# Image list` plus, per image, a pose line and an EMPTY points2D line.
 *
 * The blank second line is not padding: COLMAP's text format defines each image
 * as exactly two lines, and a reader that has consumed a pose line will consume
 * the next line as its 2D points whatever it contains. Omit it and every
 * subsequent image is read as the previous one's feature list.
 */
export function imagesTxt(frames: readonly PosedFrame[]): string {
  let out = "# Image list (two lines each: pose, then empty 2D points)\n";
  for (const f of frames) {
    const { q, t } = colmapPoseFromXrCameraToWorld(f.cameraToWorld);
    out +=
      `${f.index} ${fixed(q[0], 9)} ${fixed(q[1], 9)} ${fixed(q[2], 9)} ${fixed(q[3], 9)} ` +
      `${fixed(t[0], 9)} ${fixed(t[1], 9)} ${fixed(t[2], 9)} ` +
      `${f.index} ${frameFileName(f.index)}\n\n`;
  }
  return out;
}

/**
 * `# 3D point list` and, from a browser, nothing else.
 *
 * `points` is accepted so a future depth source (WebXR's `depth-sensing`
 * feature exists and some ARCore devices expose it) has somewhere to go without
 * this signature changing. Nothing passes it today.
 */
export function points3DTxt(
  points: readonly { xyz: Vec3; rgb: readonly [number, number, number] }[] = [],
): string {
  let out = "# 3D point list\n";
  points.forEach((p, i) => {
    out +=
      `${i + 1} ${fixed(p.xyz[0], 6)} ${fixed(p.xyz[1], 6)} ${fixed(p.xyz[2], 6)} ` +
      `${Math.round(p.rgb[0])} ${Math.round(p.rgb[1])} ${Math.round(p.rgb[2])} 0\n`;
  });
  return out;
}

/** The whole sparse model, as three named blobs of text. */
export interface SparseModel {
  "cameras.txt": string;
  "images.txt": string;
  "points3D.txt": string;
}

export function sparseModel(frames: readonly PosedFrame[]): SparseModel {
  if (frames.length === 0) {
    throw new Error("A COLMAP model with no images is not a model.");
  }
  return {
    "cameras.txt": camerasTxt(frames),
    "images.txt": imagesTxt(frames),
    "points3D.txt": points3DTxt(),
  };
}

/**
 * Project a world point through a COLMAP pose and PINHOLE intrinsics.
 *
 * The measuring instrument for the whole file. Not used by the capture path —
 * it exists so that "did the conversion produce the right camera" can be
 * answered by putting a known point in front of a known camera and checking the
 * pixel it lands on, which is a claim about the world rather than a claim about
 * sixteen numbers matching sixteen other numbers.
 *
 * Returns null when the point is BEHIND the camera. Null and (u, v) are
 * genuinely different answers: a sign error in the basis flip shows up first as
 * points that project to sensible-looking pixels while sitting behind the lens.
 */
export function projectThroughColmapPose(
  pose: ColmapPose,
  k: PinholeIntrinsics,
  world: Vec3,
): { u: number; v: number; depth: number } | null {
  const r = rotationFromQuat(pose.q);
  const cam = [0, 1, 2].map(
    (i) => r[i][0] * world[0] + r[i][1] * world[1] + r[i][2] * world[2] + pose.t[i],
  );
  const depth = cam[2];
  if (depth <= 0) return null;
  return {
    u: (k.fx * cam[0]) / depth + k.cx,
    v: (k.fy * cam[1]) / depth + k.cy,
    depth,
  };
}
