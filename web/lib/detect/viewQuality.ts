/**
 * "Best angle" — which look at a thing is the one worth keeping.
 *
 * The pipeline used to answer this with peak confidence, which is the model's
 * certainty about the LABEL and says nothing about the VIEW. A detector is
 * frequently most certain about a person the instant they fill two thirds of the
 * frame with their back to the camera, and least certain about the clean
 * three-quarter view from four metres away that any human would pick. Confidence
 * is an input here, not the answer.
 *
 * Six terms, each 0..1, each measuring something a photographer would actually
 * name:
 *
 *   framing     apparent size against an ideal — too small has no detail, too
 *               large is standing on top of it
 *   centering   how far off-axis it sits; edges of a wide lens are distorted
 *   wholeness   is any of it cut off by the frame edge
 *   aspect      does its silhouette match what the class usually looks like, or
 *               is this a grazing, foreshortened angle
 *   steadiness  was the robot moving — motion blur, from odometry, not pixels
 *   certainty   the model's own score, kept honest at a modest weight
 *
 * `worldPos` is deliberately NOT a term. Where a thing sits in the trip frame
 * says nothing about how good the look at it was, and folding it in here would
 * quietly make "best angle" mean "closest to the path".
 *
 * Pure — no DOM, no model. verify-pipeline exercises it directly.
 */
import type { BBox, Detection, TrackPoint, Vec2 } from "../types";

export interface ViewTerms {
  framing: number;
  centering: number;
  wholeness: number;
  aspect: number;
  steadiness: number;
  certainty: number;
}

export interface ViewScore {
  score: number;
  terms: ViewTerms;
  /** The weakest term, named — what to fix to get a better angle. */
  weakest: keyof ViewTerms;
  /** Human-readable version of `weakest`, for the UI and for nav rationale. */
  critique: string;
}

/**
 * Weights sum to 1. `wholeness` is second only to framing because a clipped
 * object is the one failure that cannot be recovered later — you can crop in on
 * a wide shot, you cannot un-cut an edge.
 */
export const VIEW_WEIGHTS: Record<keyof ViewTerms, number> = {
  framing: 0.26,
  wholeness: 0.2,
  certainty: 0.16,
  centering: 0.14,
  aspect: 0.12,
  steadiness: 0.12,
};

/**
 * The share of the frame a well-composed subject occupies. 18% is a portrait-ish
 * subject with room around it — big enough to carry detail into a splat, small
 * enough that the object is not pressed against the edges.
 */
const IDEAL_AREA = 0.18;

/**
 * Typical width/height of each COCO class seen from a normal standing angle.
 *
 * Used only as a soft prior: a bottle is tall and narrow, so a bottle box three
 * times wider than it is high is either a bad box or a view along something that
 * is not really a bottle. Unknown labels skip the term entirely rather than
 * being scored against a made-up default.
 */
const CANONICAL_ASPECT: Record<string, number> = {
  person: 0.4,
  bird: 1.1,
  dog: 1.25,
  cat: 1.2,
  horse: 1.4,
  bicycle: 1.5,
  car: 2.0,
  motorcycle: 1.5,
  bus: 2.2,
  truck: 2.0,
  boat: 1.8,
  bench: 2.0,
  chair: 0.85,
  "dining table": 1.8,
  "potted plant": 0.7,
  couch: 1.9,
  backpack: 0.75,
  handbag: 1.1,
  umbrella: 1.2,
  "cell phone": 0.5,
  laptop: 1.3,
  book: 0.8,
  bottle: 0.35,
  cup: 0.9,
  frisbee: 1.0,
  "sports ball": 1.0,
  kite: 1.2,
  skateboard: 2.4,
  "tennis racket": 0.45,
  banana: 1.6,
  apple: 1.0,
  sandwich: 1.3,
  cake: 1.2,
  donut: 1.0,
};

/** Speed at which motion blur has fully spoiled a still, m/s. */
const BLUR_SPEED_MPS = 1.6;

export interface ViewContext {
  /** Robot odometry, for the steadiness term. Omit and steadiness is neutral. */
  path?: TrackPoint[];
}

/**
 * Falloff that is forgiving near the ideal and punishing far from it, symmetric
 * in LOG space so half the ideal size and twice the ideal size score the same.
 * A linear falloff would treat "slightly too big" as far worse than "slightly too
 * small", which is backwards for anything we want to reconstruct.
 */
const logBell = (value: number, ideal: number, sigma: number): number => {
  if (value <= 0 || ideal <= 0) return 0;
  const dev = Math.log(value / ideal) / sigma;
  return Math.exp(-0.5 * dev * dev);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function scoreView(
  bbox: BBox,
  label: string,
  confidence: number,
  t: number,
  ctx: ViewContext = {},
): ViewScore {
  const [x, y, w, h] = bbox;

  // ── framing ──────────────────────────────────────────────────────────────
  const area = Math.max(0, w) * Math.max(0, h);
  const framing = logBell(area, IDEAL_AREA, 0.95);

  // ── centering ────────────────────────────────────────────────────────────
  // Normalized by the half-diagonal so a corner scores 0 and dead centre 1.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const offAxis = Math.hypot(cx - 0.5, cy - 0.5) / Math.SQRT1_2;
  const centering = clamp01(1 - offAxis);

  // ── wholeness ────────────────────────────────────────────────────────────
  // Each edge the box touches costs a third, so three cut edges zero the term.
  //
  // The cost is deliberately steeper than a proportional 1/4 per edge. Clipping
  // is the one defect no later stage can undo — you can crop into a wide shot,
  // you cannot un-cut an edge — so a badly truncated look has to lose to a
  // merely mediocre whole one. At 1/4 per edge it did not: an object cut on
  // three sides still scored better on wholeness than it lost on framing, and
  // the critique came back "too close" for a box with half the subject missing.
  const EDGE = 0.005;
  const touched =
    (x <= EDGE ? 1 : 0) +
    (y <= EDGE ? 1 : 0) +
    (x + w >= 1 - EDGE ? 1 : 0) +
    (y + h >= 1 - EDGE ? 1 : 0);
  const wholeness = clamp01(1 - touched * 0.34);

  // ── aspect ───────────────────────────────────────────────────────────────
  const canonical = CANONICAL_ASPECT[label];
  const aspect =
    canonical && h > 0 ? logBell(w / h, canonical, 0.62) : 0.7; // unknown class: neutral-ish, never rewarded

  // ── steadiness ───────────────────────────────────────────────────────────
  let steadiness = 0.7;
  if (ctx.path?.length) {
    const speed = speedAt(ctx.path, t);
    steadiness = clamp01(1 - speed / BLUR_SPEED_MPS);
  }

  // ── certainty ────────────────────────────────────────────────────────────
  const certainty = clamp01(confidence);

  const terms: ViewTerms = { framing, centering, wholeness, aspect, steadiness, certainty };

  let score = 0;
  for (const key of Object.keys(VIEW_WEIGHTS) as (keyof ViewTerms)[]) {
    score += VIEW_WEIGHTS[key] * terms[key];
  }

  // Weighted by importance, so a mediocre high-weight term outranks a terrible
  // low-weight one as the thing actually worth fixing.
  let weakest: keyof ViewTerms = "framing";
  let worst = Infinity;
  for (const key of Object.keys(VIEW_WEIGHTS) as (keyof ViewTerms)[]) {
    const deficit = (1 - terms[key]) * VIEW_WEIGHTS[key];
    if (deficit > 0 && -deficit < worst) {
      worst = -deficit;
      weakest = key;
    }
  }

  return {
    score: clamp01(score),
    terms,
    weakest,
    critique: critiqueFor(weakest, terms, bbox, area),
  };
}

/** Speed at time `t`, from the nearest odometry sample. */
function speedAt(path: TrackPoint[], t: number): number {
  let best = path[0];
  let bestD = Infinity;
  for (const p of path) {
    const d = Math.abs(p.t - t);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best?.speed ?? 0;
}

/** Names the fix, not the symptom — this text ends up in the nav rationale. */
function critiqueFor(
  weakest: keyof ViewTerms,
  terms: ViewTerms,
  bbox: BBox,
  area: number,
): string {
  const [x, y, w, h] = bbox;
  switch (weakest) {
    case "framing":
      return area < IDEAL_AREA
        ? `too far away — fills ${(area * 100).toFixed(1)}% of the frame, wants ~${IDEAL_AREA * 100}%`
        : `too close — fills ${(area * 100).toFixed(0)}% of the frame`;
    case "wholeness": {
      const edges: string[] = [];
      if (x <= 0.005) edges.push("left");
      if (y <= 0.005) edges.push("top");
      if (x + w >= 0.995) edges.push("right");
      if (y + h >= 0.995) edges.push("bottom");
      return `cut off at the ${edges.join(" and ")} edge — back up or turn toward it`;
    }
    case "centering":
      return `off to the ${x + w / 2 < 0.5 ? "left" : "right"} of frame — turn to put it on axis`;
    case "aspect":
      return `seen at an oblique angle — the silhouette is ${(w / Math.max(h, 1e-6)).toFixed(2)}:1, unusual for this class`;
    case "steadiness":
      return `robot was moving — likely motion blur, stop before capturing`;
    case "certainty":
      return `the model is only ${(terms.certainty * 100).toFixed(0)}% sure of the label here`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Picking a view, and the pose that produced it
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoredDetection {
  detection: Detection;
  view: ViewScore;
}

/** Score every detection of one object and return them best-view first. */
export function rankViews(detections: Detection[], ctx: ViewContext = {}): ScoredDetection[] {
  return detections
    .map((d) => ({
      detection: d,
      view: scoreView(d.bbox, d.label, d.confidence, d.t, ctx),
    }))
    .sort((a, b) => b.view.score - a.view.score);
}

export function pickBestView(
  detections: Detection[],
  ctx: ViewContext = {},
): ScoredDetection | null {
  if (!detections.length) return null;
  return rankViews(detections, ctx)[0];
}

/**
 * The pose to drive to in order to see the thing THAT way again.
 *
 * The old nav target was the object's own coordinates plus a bearing from
 * whatever path point happened to be nearest. Two things wrong with it: the
 * nearest point on the walk is not where the good look happened, and driving to
 * an object's coordinates means driving INTO it.
 *
 * So: take the robot's position at the moment of the best view, keep that
 * viewing direction — it is the one that produced the best angle — and stand off
 * along it at a distance chosen to put the object at `IDEAL_AREA` of the frame.
 *
 * Everything is in the trip's local metric ground frame, [east, south]. `heading`
 * is a compass bearing in DEGREES, 0–360 clockwise from +z, matching
 * ObjectIndexEntry — see the note there before changing it.
 */
export interface Viewpoint {
  /** Where to stand. NOT the object's position. */
  pos: Vec2;
  /** Which way to face from `pos`, degrees clockwise from +z. */
  heading: number;
  /** Standoff distance, metres. */
  distanceM: number;
  /** Odometry time of the look this pose reproduces. */
  approachFromT: number;
  /** View score of that look, 0..1. */
  viewScore: number;
  /** Why this pose and not another. */
  why: string;
}

/** Standoff is clamped to what a small ground robot can actually use. */
const MIN_STANDOFF_M = 1.2;
const MAX_STANDOFF_M = 8;

export function bestViewpoint(opts: {
  /** Object position in the ground plane, [east, south] metres. */
  objectPos: Vec2;
  /** Where the robot was when it got its best look. */
  observerPos: Vec2;
  /** Odometry time of that look. */
  t: number;
  view: ViewScore;
  /** The box of that best look — drives how far in or out to stand. */
  bbox: BBox;
  /** Measured range at the best view, if the sighting carried one. */
  depthM?: number;
}): Viewpoint {
  const { objectPos, observerPos, t, view, bbox, depthM } = opts;

  // Direction from the object back toward where the good look came from.
  let dx = observerPos[0] - objectPos[0];
  let dz = observerPos[1] - objectPos[1];
  const range = Math.hypot(dx, dz);
  if (range < 1e-6) {
    // Degenerate: the robot was recorded standing on the object. Any bearing is
    // as good as any other, so pick +z and let the distance clamp do the work.
    dx = 0;
    dz = 1;
  } else {
    dx /= range;
    dz /= range;
  }

  // Move in or out so the object would land at IDEAL_AREA next time.
  //
  // Apparent area falls off as 1/distance², so the distance that turns the area
  // we actually got into the area we want is scaled by sqrt(observed / ideal).
  // Derived from the box rather than from the framing term, because the term is
  // a bell — too close and too far score identically and it cannot tell us which
  // way to move.
  const observed = depthM ?? (range > 1e-6 ? range : MIN_STANDOFF_M);
  const apparentArea = Math.max(1e-4, bbox[2] * bbox[3]);
  const ratio = Math.min(2, Math.max(0.5, Math.sqrt(apparentArea / IDEAL_AREA)));
  const distanceM = Math.min(MAX_STANDOFF_M, Math.max(MIN_STANDOFF_M, observed * ratio));

  const pos: Vec2 = [
    Number((objectPos[0] + dx * distanceM).toFixed(2)),
    Number((objectPos[1] + dz * distanceM).toFixed(2)),
  ];

  // Face back toward the object from the new position: negate the standoff
  // direction. atan2(Δx, Δz) is degrees clockwise from +z.
  const deg = (Math.atan2(-dx, -dz) * 180) / Math.PI;

  return {
    pos,
    heading: Math.round(((deg % 360) + 360) % 360),
    distanceM: Number(distanceM.toFixed(2)),
    approachFromT: t,
    viewScore: Number(view.score.toFixed(3)),
    why:
      view.score >= 0.7
        ? `best look of the trip — ${(view.score * 100).toFixed(0)}% view quality`
        : `best available look, but ${view.critique}`,
  };
}
