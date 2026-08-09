/**
 * Temporal tracking — consistency across frames rather than within one.
 *
 * ./boxes.ts makes a single frame stable. This makes a SEQUENCE stable, and it
 * closes a real hole: `toDetections` used to mint a fresh `trackId` per
 * detection, so every box was its own one-frame track. `collapseToSightings`
 * requires three detections on a track before it believes an object exists —
 * which meant live detector output could never produce a single ObjectSighting,
 * no matter how long you pointed the camera at a bottle. The types said the seam
 * worked; nothing had ever run through it.
 *
 * Deliberately a greedy IoU tracker and not a Kalman/Hungarian one. The robot
 * runs this at ~10 fps on frames where things move a few percent of the frame
 * between samples, and at that rate association is nearly unambiguous. A motion
 * model would add state to tune and drift to debug in exchange for accuracy we
 * cannot use.
 *
 * Three jobs, all of which the downstream pipeline already assumes someone did:
 *
 *   · ASSOCIATE   the same physical object keeps one id across frames
 *   · BRIDGE      a detection missing for a frame or two does not end the track,
 *                 so one bad frame stops splitting a bottle into two bottles
 *   · SUPPRESS    a track that was only ever seen once or twice is dropped, which
 *                 is the single most effective false-positive filter there is
 *
 * Pure — no DOM, no model. verify-pipeline exercises it directly.
 */
import { iou, type Box } from "./boxes";
import type { BBox, Detection } from "../types";

export const toBox = (b: BBox): Box => ({ x0: b[0], y0: b[1], x1: b[0] + b[2], y1: b[1] + b[3] });

export const toBBox = (b: Box): BBox => [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];

export interface TrackOptions {
  /** Boxes at or above this IoU are the same object. */
  iouThreshold?: number;
  /**
   * How long a track survives without a detection, in seconds. Too small and one
   * dropped frame splits a track; too large and two different people walking
   * through the same spot become one.
   */
  maxGapSec?: number;
  /** Tracks seen fewer times than this are dropped as flicker. */
  minHits?: number;
  /**
   * Box smoothing, 0..1 — the weight given to the NEW box each frame. 1 disables
   * smoothing. Lower values steady a jittering box at the cost of lagging a fast
   * mover.
   */
  smoothing?: number;
  /** Prefix for generated ids, so two sources never collide. */
  idPrefix?: string;
}

interface LiveTrack {
  id: string;
  label: string;
  box: Box;
  lastT: number;
  hits: number;
}

/**
 * Assign stable `trackId`s across a sequence of detections.
 *
 * Input need not be sorted. Output is the same detections — same ids, same
 * labels — with `trackId` set and `bbox` smoothed, minus any belonging to a track
 * that never reached `minHits`.
 */
export function assignTracks(detections: Detection[], opts: TrackOptions = {}): Detection[] {
  const iouThreshold = opts.iouThreshold ?? 0.3;
  const maxGapSec = opts.maxGapSec ?? 0.75;
  const minHits = opts.minHits ?? 3;
  const smoothing = opts.smoothing ?? 0.6;
  const prefix = opts.idPrefix ?? "trk";

  // Group by frame time so association happens frame against frame. Detections
  // from the SAME frame must never compete for one track.
  const byTime = new Map<number, Detection[]>();
  for (const d of detections) {
    const arr = byTime.get(d.t);
    if (arr) arr.push(d);
    else byTime.set(d.t, [d]);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);

  const live: LiveTrack[] = [];
  const hitsById = new Map<string, number>();
  const out: Detection[] = [];
  let nextId = 0;

  for (const t of times) {
    // Retire anything that has gone quiet. Done before matching so a stale track
    // cannot claim a detection it has no business claiming.
    for (let i = live.length - 1; i >= 0; i--) {
      if (t - live[i].lastT > maxGapSec) live.splice(i, 1);
    }

    const frame = byTime.get(t)!;
    // Confident detections choose their track first.
    const ordered = [...frame].sort((a, b) => b.confidence - a.confidence);
    const claimed = new Set<string>();

    for (const det of ordered) {
      const detBox = toBox(det.bbox);

      let best: LiveTrack | null = null;
      let bestIou = iouThreshold;
      for (const tr of live) {
        if (tr.label !== det.label) continue;
        if (claimed.has(tr.id)) continue;
        const overlap = iou(tr.box, detBox);
        if (overlap >= bestIou) {
          bestIou = overlap;
          best = tr;
        }
      }

      if (!best) {
        best = {
          id: `${prefix}_${(nextId++).toString(36)}`,
          label: det.label,
          box: detBox,
          lastT: t,
          hits: 0,
        };
        live.push(best);
      } else {
        // EMA toward the new box. The track's own box is what the next frame
        // matches against, so smoothing here also steadies association.
        best.box = {
          x0: best.box.x0 + (detBox.x0 - best.box.x0) * smoothing,
          y0: best.box.y0 + (detBox.y0 - best.box.y0) * smoothing,
          x1: best.box.x1 + (detBox.x1 - best.box.x1) * smoothing,
          y1: best.box.y1 + (detBox.y1 - best.box.y1) * smoothing,
        };
      }

      claimed.add(best.id);
      best.lastT = t;
      best.hits++;
      hitsById.set(best.id, best.hits);

      out.push({ ...det, trackId: best.id, bbox: roundBBox(toBBox(best.box)) });
    }
  }

  return out.filter((d) => (hitsById.get(d.trackId!) ?? 0) >= minHits);
}

const roundBBox = (b: BBox): BBox => [
  Number(b[0].toFixed(4)),
  Number(b[1].toFixed(4)),
  Number(b[2].toFixed(4)),
  Number(b[3].toFixed(4)),
];

/** Per-track summary, for readouts that want to show stability directly. */
export interface TrackSummary {
  trackId: string;
  label: string;
  hits: number;
  firstT: number;
  lastT: number;
  peakConfidence: number;
}

export function summarizeTracks(detections: Detection[]): TrackSummary[] {
  const byTrack = new Map<string, Detection[]>();
  for (const d of detections) {
    const key = d.trackId ?? d.id;
    const arr = byTrack.get(key);
    if (arr) arr.push(d);
    else byTrack.set(key, [d]);
  }

  return [...byTrack.entries()]
    .map(([trackId, dets]) => ({
      trackId,
      label: dets[0].label,
      hits: dets.length,
      firstT: Math.min(...dets.map((d) => d.t)),
      lastT: Math.max(...dets.map((d) => d.t)),
      peakConfidence: Math.max(...dets.map((d) => d.confidence)),
    }))
    .sort((a, b) => b.hits - a.hits);
}
