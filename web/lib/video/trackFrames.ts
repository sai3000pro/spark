/**
 * Links per-frame detections into tracks.
 *
 * WHY THIS EXISTS. `toDetections` in lib/detector.ts mints a fresh trackId for
 * every box — correct for the bench, where there is one frame and nothing to
 * link it to. Across video frames it is actively wrong: `collapseToSightings`
 * groups by trackId, so per-frame ids would turn one person standing still for
 * a minute into 180 separate one-frame "sightings", and the moment's object
 * list would be noise. Dwell, novelty and face-count all read as garbage too.
 *
 * So: a small greedy tracker. Same label, best box overlap above a floor, within
 * a short time gap, wins the track. This is genuinely what the robot's onboard
 * tracker does for us in the real pipeline — the seam in `Detection.trackId` was
 * always "the tracker fills this in", and on this path we are the tracker.
 *
 * Greedy-by-overlap rather than Hungarian assignment or a Kalman filter: the
 * frames are seconds apart, not milliseconds, so velocity prediction would be
 * guessing. Overlap is the honest signal at this sample rate.
 */
import type { BBox, Detection } from "../types";
import type { RawDetection } from "../detector";

export interface TrackOptions {
  /** Minimum IoU to continue a track rather than start a new one. */
  minIou?: number;
  /** A track unseen for longer than this is closed, not resumed. */
  maxGapSec?: number;
}

const DEFAULTS = { minIou: 0.25, maxGapSec: 2.5 } as const;

export interface FrameDetections {
  t: number;
  frameId: string;
  raw: RawDetection[];
}

interface OpenTrack {
  trackId: string;
  label: string;
  bbox: BBox;
  lastT: number;
}

/**
 * Per-frame model output → `Detection[]` with tracks that persist across frames.
 *
 * Emits in frame order, which is what `scoreCandidates` walks.
 */
export function trackDetections(
  frames: FrameDetections[],
  opts: { tripId: string } & TrackOptions,
): Detection[] {
  const { minIou, maxGapSec } = { ...DEFAULTS, ...opts };
  const out: Detection[] = [];
  const open: OpenTrack[] = [];
  let nextTrack = 0;

  for (const frame of frames) {
    // Close tracks that have gone quiet. A person who leaves and returns a
    // minute later is a new sighting, which is the truthful reading.
    for (let i = open.length - 1; i >= 0; i--) {
      if (frame.t - open[i].lastT > maxGapSec) open.splice(i, 1);
    }

    const claimed = new Set<string>();

    frame.raw.forEach((d, i) => {
      const label = d.label.toLowerCase();
      const bbox = toBBox(d);

      // Best unclaimed track of the same label, by overlap.
      let best: OpenTrack | null = null;
      let bestIou = minIou;
      for (const track of open) {
        if (track.label !== label || claimed.has(track.trackId)) continue;
        const score = iou(track.bbox, bbox);
        if (score >= bestIou) {
          bestIou = score;
          best = track;
        }
      }

      if (best) {
        claimed.add(best.trackId);
        best.bbox = bbox;
        best.lastT = frame.t;
      } else {
        best = {
          trackId: `vt_${(nextTrack++).toString(36)}`,
          label,
          bbox,
          lastT: frame.t,
        };
        open.push(best);
        claimed.add(best.trackId);
      }

      const [, , w, h] = bbox;
      out.push({
        id: `det_up_${frame.frameId}_${i}`,
        tripId: opts.tripId,
        frameId: frame.frameId,
        t: frame.t,
        label,
        confidence: Number(d.score.toFixed(3)),
        bbox,
        trackId: best.trackId,
        // Same crude monocular proxy the bench uses: bigger box ≈ closer. The
        // robot reads iPhone LiDAR instead.
        depthM: Number((1.4 / Math.max(0.02, Math.sqrt(w * h))).toFixed(2)),
        source: "manual",
      });
    });
  }

  return out;
}

/**
 * A world position per track, so the splat stage has anchors to fly to.
 *
 * Back-projected from the box, NOT measured: horizontal offset from the frame
 * centre, the depth proxy for distance, box height for elevation. Everything
 * downstream that shows these already says the scene is synthetic — see the
 * header of lib/uploadedTrips.ts.
 */
export function estimateWorldPos(d: Detection, center: [number, number]): [number, number, number] {
  const [x, y, w, h] = d.bbox;
  const depth = d.depthM ?? 4;
  // Horizontal FOV of a phone camera is around 65°, so the frame spans roughly
  // 1.27 × depth in metres. Half of that either side of centre.
  const across = (x + w / 2 - 0.5) * depth * 1.27;
  const up = Math.max(0.05, (1 - (y + h)) * depth * 0.7 + h * depth * 0.35);
  return [center[0] + across, Number(up.toFixed(2)), center[1] + depth * 0.5];
}

// ─────────────────────────────────────────────────────────────────────────────

function toBBox(d: RawDetection): BBox {
  const x = clamp01(d.box.xmin);
  const y = clamp01(d.box.ymin);
  const w = Math.max(0, Math.min(1 - x, d.box.xmax - d.box.xmin));
  const h = Math.max(0, Math.min(1 - y, d.box.ymax - d.box.ymin));
  return [round(x), round(y), round(w), round(h)];
}

function iou(a: BBox, b: BBox): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  if (inter <= 0) return 0;

  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union <= 0 ? 0 : inter / union;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number) => Number(v.toFixed(4));
