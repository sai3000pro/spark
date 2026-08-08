/**
 * Turns high-level "this object was visible from t=a to t=b" track specs into the
 * dense per-frame Detection stream the real onboard model would emit.
 *
 * Why bother making this realistic: lib/pipeline.ts has to do actual work on it.
 * If every track were a clean constant-confidence box, the candidate scorer would
 * never be exercised and we would find out on stage that it does not work.
 */
import type { Detection, DetectionSource, BBox, Vec3 } from "../types";
import { makeRng, rngRange, rngJitter, type Rng } from "./rng";

export interface TrackSpec {
  trackId: string;
  label: string;
  tStart: number;
  tEnd: number;
  /** Position in the trip's local frame. Becomes the splat anchor. */
  worldPos?: Vec3;
  /** Confidence at the middle of the track, where the object is best framed. */
  peakConfidence: number;
  /** Detections per second. Small/distant things get detected less reliably. */
  hz?: number;
  /** Roughly how far from the camera, metres. Drives depthM. */
  baseDepthM?: number;
  /** Fraction of frames the detector simply misses. Real trackers drop boxes. */
  dropRate?: number;
  source?: DetectionSource;
}

/** Bigger label → bigger box. Keeps bboxes from looking arbitrary. */
const BASE_SIZE: Record<string, [number, number]> = {
  person: [0.16, 0.52],
  bicycle: [0.22, 0.24],
  bench: [0.3, 0.16],
  "dining table": [0.34, 0.2],
  chair: [0.14, 0.2],
  bottle: [0.05, 0.13],
  cup: [0.05, 0.07],
  backpack: [0.11, 0.15],
  "cell phone": [0.04, 0.07],
  laptop: [0.16, 0.12],
  bird: [0.06, 0.06],
  dog: [0.13, 0.13],
  frisbee: [0.06, 0.04],
  "sports ball": [0.05, 0.05],
  kite: [0.1, 0.08],
  "potted plant": [0.1, 0.16],
  book: [0.08, 0.06],
  umbrella: [0.2, 0.18],
  handbag: [0.09, 0.1],
  banana: [0.07, 0.05],
  cake: [0.11, 0.08],
  sandwich: [0.09, 0.06],
};

const sizeFor = (label: string): [number, number] => BASE_SIZE[label] ?? [0.12, 0.14];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Confidence over the life of a track: low as it enters frame, peaks in the
 * middle, falls off as it leaves. This shape is what makes `peak confidence`
 * (not mean) the right thing for ObjectSighting to keep.
 */
function confidenceAt(progress: number, peak: number, r: Rng): number {
  const envelope = Math.sin(Math.PI * clamp01(progress)) ** 0.55;
  const floor = peak * 0.52;
  return clamp01(floor + (peak - floor) * envelope + rngJitter(r, 0.045));
}

export function generateDetectionsForTracks(
  tripId: string,
  tracks: TrackSpec[],
  seed = 1337,
): Detection[] {
  const out: Detection[] = [];
  let n = 0;

  for (const spec of tracks) {
    const r = makeRng(seed + hashString(spec.trackId));
    const hz = spec.hz ?? 2;
    const dropRate = spec.dropRate ?? 0.12;
    const duration = Math.max(0.5, spec.tEnd - spec.tStart);
    const frames = Math.max(1, Math.round(duration * hz));
    const [bw, bh] = sizeFor(spec.label);
    const baseDepth = spec.baseDepthM ?? rngRange(r, 1.8, 9);

    // Each track wanders across frame on its own smooth random walk rather than
    // teleporting per frame — this is what a tracker's output actually looks like.
    let cx = rngRange(r, 0.2, 0.8);
    let cy = rngRange(r, 0.34, 0.68);
    let vx = rngJitter(r, 0.006);
    let vy = rngJitter(r, 0.003);

    for (let i = 0; i < frames; i++) {
      const progress = frames === 1 ? 0.5 : i / (frames - 1);
      const t = spec.tStart + progress * duration;

      vx = vx * 0.86 + rngJitter(r, 0.0035);
      vy = vy * 0.86 + rngJitter(r, 0.002);
      cx = clamp01(cx + vx);
      cy = clamp01(cy + vy);

      if (r() < dropRate) continue;

      const scale = 1 + rngJitter(r, 0.09);
      const w = clamp01(bw * scale);
      const h = clamp01(bh * scale);
      const bbox: BBox = [
        clamp01(cx - w / 2),
        clamp01(cy - h / 2),
        w,
        h,
      ];

      out.push({
        id: `det_${tripId}_${(n++).toString(36)}`,
        tripId,
        frameId: `f_${Math.round(t * 30)}`,
        t: Number(t.toFixed(2)),
        label: spec.label,
        confidence: Number(confidenceAt(progress, spec.peakConfidence, r).toFixed(3)),
        bbox: bbox.map((v) => Number(v.toFixed(4))) as BBox,
        trackId: spec.trackId,
        depthM: Number((baseDepth * (1 + rngJitter(r, 0.12))).toFixed(2)),
        worldPos: spec.worldPos
          ? (spec.worldPos.map((v, k) =>
              Number((v + rngJitter(r, k === 1 ? 0.05 : 0.14)).toFixed(3)),
            ) as Vec3)
          : undefined,
        source: spec.source ?? "onboard",
      });
    }
  }

  return out.sort((a, b) => a.t - b.t);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Ambient background tracks — the stuff the robot sees while just walking.
 * These exist so the timeline's detection lane is genuinely dense and so the
 * candidate scorer has to reject things, which is the interesting half.
 */
export function generateAmbientTracks(
  tripDurationSec: number,
  busyWindows: Array<{ tStart: number; tEnd: number }>,
  seed = 90210,
): TrackSpec[] {
  const r = makeRng(seed);
  const ambientLabels = [
    "person", "person", "person", "bench", "bicycle", "bird", "dog",
    "potted plant", "car", "backpack", "handbag", "cup", "chair", "kite",
  ];

  const tracks: TrackSpec[] = [];
  let t = 20;
  let i = 0;

  while (t < tripDurationSec - 40) {
    const gap = rngRange(r, 6, 34);
    t += gap;

    // Thin out ambient noise inside authored moments so their own tracks dominate.
    const insideMoment = busyWindows.some((w) => t >= w.tStart - 8 && t <= w.tEnd + 8);
    if (insideMoment && r() < 0.7) continue;

    const label = ambientLabels[Math.floor(r() * ambientLabels.length)];
    const duration = rngRange(r, 2.5, 16);
    if (t + duration > tripDurationSec) break;

    tracks.push({
      trackId: `amb_${(i++).toString(36)}`,
      label,
      tStart: Number(t.toFixed(1)),
      tEnd: Number((t + duration).toFixed(1)),
      peakConfidence: rngRange(r, 0.41, 0.83),
      hz: rngRange(r, 1.2, 2.6),
      baseDepthM: rngRange(r, 3, 22),
      dropRate: rngRange(r, 0.12, 0.34),
    });
  }

  return tracks;
}
