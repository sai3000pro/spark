/**
 * Camera motion, estimated from the detections themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS HAS TO EXIST.
 *
 * `scoreCandidates` has five signals. A video file carries no audio pass and no
 * odometry, which kills `audio_energy`, `laughter` and `speech_keyword` outright
 * and leaves `dwell` unreachable because dwell is computed from a path. What
 * remains is `novel_object` and `face_count` — and novelty only fires in the
 * window where a label FIRST appears. So every label announces itself in the
 * opening seconds, one short candidate forms, it falls under `minCandidateSec`,
 * and the answer is always zero moments. Measured, not guessed: a 90-second
 * clip with six well-tracked objects produced exactly one candidate, discarded.
 *
 * But the footage does carry a dwell signal — it is just written in image space
 * rather than in metres. A camera resting on a subject holds its boxes still; a
 * camera walking swings them across the frame. That is real, measurable, and
 * present in the data we already have.
 *
 * WHAT IS HONEST ABOUT THE ESTIMATE, AND WHAT IS NOT:
 *   · the MOTION is measured — median box displacement between frames, over
 *     tracks that persist across both, so a single flailing detection cannot
 *     move the camera.
 *   · the SCALE is a monocular guess. Displacement is angular; turning it into
 *     metres per second needs a distance, and the only distance available is
 *     the same crude `depthM = 1.4/√area` proxy the bench uses. Treat the
 *     magnitude as an order of magnitude.
 *   · the DIRECTION is not estimated at all. The path runs along one axis. This
 *     is a distance-travelled trace, not a shape — see the header of
 *     lib/uploadedTrips.ts.
 *
 * The consequence that matters: `dwellSpeedMps` in PIPELINE_CONFIG now means
 * something on this path, so a held shot scores as dwell exactly the way a
 * stopped robot does, and the pipeline needs no special case for video.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Detection, TrackPoint } from "../types";

export interface MotionOptions {
  /** Path sample spacing, seconds. Dwell needs ≥4s runs, so 1s is plenty fine. */
  sampleSec?: number;
  /**
   * Horizontal field of view, radians. A phone's main camera is around 65°.
   * Converts "box moved 10% across the frame" into an angle.
   */
  fovRad?: number;
  /** Ceiling on the estimate, m/s. Nothing on foot moves faster than this. */
  maxSpeedMps?: number;
}

const DEFAULTS = {
  sampleSec: 1,
  fovRad: (65 * Math.PI) / 180,
  maxSpeedMps: 3.2,
} as const;

export function estimateCameraPath(
  detections: Detection[],
  durationSec: number,
  options: MotionOptions = {},
): TrackPoint[] {
  const { sampleSec, fovRad, maxSpeedMps } = { ...DEFAULTS, ...options };
  if (durationSec <= 0) return [];

  // Group by frame, in time order. One frame is one observation of the scene.
  const frames = new Map<number, Detection[]>();
  for (const d of detections) {
    const list = frames.get(d.t);
    if (list) list.push(d);
    else frames.set(d.t, [d]);
  }
  const times = [...frames.keys()].sort((a, b) => a - b);

  /** Instantaneous speed estimates, stamped at the later frame of each pair. */
  const speedAt: Array<{ t: number; mps: number }> = [];

  for (let i = 1; i < times.length; i++) {
    const t0 = times[i - 1];
    const t1 = times[i];
    const dt = t1 - t0;
    // A long gap means the tracker dropped everything; comparing across it would
    // read as a huge jump rather than as missing data.
    if (dt <= 0 || dt > 3) continue;

    const before = new Map(
      frames.get(t0)!.filter((d) => d.trackId).map((d) => [d.trackId!, d]),
    );

    const samples: number[] = [];
    for (const d of frames.get(t1)!) {
      const prev = d.trackId ? before.get(d.trackId) : undefined;
      if (!prev) continue;

      // Centroid displacement, as a fraction of frame width.
      const dx = d.bbox[0] + d.bbox[2] / 2 - (prev.bbox[0] + prev.bbox[2] / 2);
      const dy = d.bbox[1] + d.bbox[3] / 2 - (prev.bbox[1] + prev.bbox[3] / 2);
      const frac = Math.hypot(dx, dy);

      // Angle subtended, then arc length at the object's estimated distance.
      const depth = d.depthM ?? prev.depthM ?? 4;
      const metres = frac * fovRad * depth;
      samples.push(metres / dt);
    }

    if (!samples.length) continue;
    // Median: one object crossing the frame while the camera is still must not
    // read as the camera moving.
    samples.sort((a, b) => a - b);
    const mps = samples[samples.length >> 1];
    speedAt.push({ t: t1, mps: Math.min(maxSpeedMps, mps) });
  }

  // No pairs at all (a one-frame video, or nothing tracked) — a still path is
  // the truthful answer, and it reads as pure dwell.
  const count = Math.max(2, Math.round(durationSec / sampleSec) + 1);
  const path: TrackPoint[] = [];
  let travelled = 0;
  let prevT = 0;

  for (let i = 0; i < count; i++) {
    const t = Number(Math.min(durationSec, i * sampleSec).toFixed(2));
    const mps = speedNear(speedAt, t);
    travelled += mps * (t - prevT);
    prevT = t;
    path.push({
      t,
      pos: [Number(travelled.toFixed(3)), 0],
      // Direction is not estimated — see the header. Constant heading is the
      // honest stand-in, not a claim about which way the camera faced.
      heading: 0,
      speed: Number(mps.toFixed(3)),
    });
  }

  return path;
}

/** Nearest estimate in time, so the path is defined between observations. */
function speedNear(samples: Array<{ t: number; mps: number }>, t: number): number {
  if (!samples.length) return 0;
  let best = samples[0];
  let bestGap = Math.abs(best.t - t);
  for (const s of samples) {
    const gap = Math.abs(s.t - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  // Too far from any observation to claim anything — call it still.
  return bestGap > 3 ? 0 : best.mps;
}
