import "server-only";

/**
 * Where a splat actually IS, and where to stand to see it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COLLECTED SPLAT NEEDS THIS AND AN AUTHORED ONE DOES NOT
 *
 * The authored capture in lib/mock/trips/summerhacks.ts carries a `view` whose
 * comment says it was "measured off the file, not guessed" — somebody opened
 * it, found the bounds, and wrote down a camera that stands back from the long
 * wall. A reconstruction that arrives from KIRI at three in the morning has
 * nobody to do that for it.
 *
 * And the default camera is not close to right. KIRI normalises its output into
 * a ±50 box — a hundred units across, roughly five times the extent of that
 * hand-framed capture — so a viewer that starts a few units from the origin is
 * standing inside a cloud looking at nothing. The splat loads, draws, and
 * appears to be missing. Measured on the first real one collected: bounds ±50
 * on every axis, centroid (-7.84, -0.08, 2.27).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRIMMED, BECAUSE THE CORNERS ARE NOISE
 *
 * Those ±50 extremes are not the room. Photogrammetric reconstructions throw a
 * thin haze of floaters out to the edge of whatever volume they were solved in,
 * and framing to the full extent means framing to the haze — the subject ends
 * up a speck in the middle. So the box is taken from a PERCENTILE of the
 * positions rather than the min and max, which lands on the part a person would
 * call the scene.
 *
 * Sampled rather than fully read: 143 MB of vertices to answer a question that
 * a few tens of thousands settle to well under a percent.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";

import type { SplatView, Vec3 } from "../types";

export interface PlyBounds {
  pointCount: number;
  /** Trimmed extent — the scene, not the floaters. */
  min: Vec3;
  max: Vec3;
  centre: Vec3;
  /** A camera that frames `centre` with the whole trimmed box in shot. */
  view: SplatView;
}

/** Enough for a stable percentile, cheap enough to run inside a request. */
const MAX_SAMPLES = 60_000;

/**
 * Fraction trimmed from each end of each axis.
 *
 * 2% each way. Generous enough to shed the floater haze, small enough that it
 * cannot eat a real wall — a room whose outer 2% of splats matter is not a room.
 */
const TRIM = 0.02;

/** Read a PLY header far enough to learn its layout. */
function readHeader(fd: number): { dataOffset: number; count: number; stride: number } | null {
  const buf = Buffer.alloc(16_384);
  const read = readSync(fd, buf, 0, buf.length, 0);
  const text = buf.subarray(0, read).toString("latin1");

  const marker = text.indexOf("end_header\n");
  if (marker < 0) return null;
  const header = text.slice(0, marker);

  const countMatch = /element vertex (\d+)/.exec(header);
  if (!countMatch) return null;

  // Every property in the INRIA layout is a float32. Anything else is a file
  // this function should not guess about.
  const props = [...header.matchAll(/property\s+(\w+)\s+(\w+)/g)];
  if (props.length === 0 || props.some((p) => p[1] !== "float")) return null;

  return {
    dataOffset: marker + "end_header\n".length,
    count: Number(countMatch[1]),
    stride: props.length * 4,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Bounds and a camera for a splat on disk. Null when the file is not one we
 * can read — the caller then keeps whatever default it had.
 */
export function measurePly(filePath: string): PlyBounds | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }

  try {
    const head = readHeader(fd);
    if (!head || head.count === 0) return null;

    const { dataOffset, count, stride } = head;
    // A truncated download would otherwise be measured as though complete.
    if (statSync(filePath).size < dataOffset + count * stride) return null;

    const step = Math.max(1, Math.floor(count / MAX_SAMPLES));
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const buf = Buffer.alloc(12);

    for (let i = 0; i < count; i += step) {
      readSync(fd, buf, 0, 12, dataOffset + i * stride);
      const x = buf.readFloatLE(0);
      const y = buf.readFloatLE(4);
      const z = buf.readFloatLE(8);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      xs.push(x);
      ys.push(y);
      zs.push(z);
    }
    if (xs.length < 8) return null;

    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    zs.sort((a, b) => a - b);

    const min: Vec3 = [percentile(xs, TRIM), percentile(ys, TRIM), percentile(zs, TRIM)];
    const max: Vec3 = [
      percentile(xs, 1 - TRIM),
      percentile(ys, 1 - TRIM),
      percentile(zs, 1 - TRIM),
    ];
    const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

    const spanX = max[0] - min[0];
    const spanY = max[1] - min[1];
    const spanZ = max[2] - min[2];
    const widest = Math.max(spanX, spanY, spanZ, 0.001);

    /*
      IN THE FILE'S OWN FRAME.

      Both engines turn a splat 180° about X on the way in, so it is tempting to
      pre-flip this — and that is wrong. The one `view` in this repo known to
      frame correctly is the hand-measured one in lib/mock/trips/summerhacks.ts:
      `cameraPosition: [0, 1.1, 10.5]` against file bounds z[-11.1, 6.6]. That
      camera stands back on +Z in RAW file coordinates, so a view is expressed
      in the same space these bounds are measured in and needs no correction.
      Flipping it was tried and moved the camera further from the subject.

      Stand back along +Z by a little over the widest span, and slightly above
      the middle. Not a fitted frustum: the viewer's own controls orbit from
      wherever this puts you, so the job here is to be unmistakably outside the
      scene looking in, which is the one thing the default failed at.

      Verified on a real KIRI capture: 580k gaussians, bounds ±50, framed and
      rendering. It appeared blank under browser automation for a while, which
      was the harness rather than the camera — that context could not decode a
      14 KB control video either, so it was never evidence about this code.
    */
    const distance = widest * 1.25;
    const view: SplatView = {
      cameraUp: [0, 1, 0],
      cameraPosition: [centre[0], centre[1] + widest * 0.15, centre[2] + distance],
      cameraLookAt: centre,
    };

    return { pointCount: count, min, max, centre, view };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
