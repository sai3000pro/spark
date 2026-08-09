/**
 * Box geometry and multi-pass fusion.
 *
 * THE REASON THIS FILE EXISTS. A single forward pass of a detector is a noisy
 * sample, not an answer. Run the same model on the same scene twice with a
 * slightly different crop and you get a slightly different box, a slightly
 * different score, and sometimes a different set of objects entirely. That
 * flicker is what "the detector is inconsistent" actually means — the model is
 * fine, we were only ever asking it once.
 *
 * So we ask several times (see ./tta.ts) and fuse. Fusion is Weighted Box Fusion
 * rather than NMS, and the difference matters:
 *
 *   · NMS PICKS a winner and discards the rest, so the output box is only ever as
 *     good as the single luckiest pass, and the information that four passes
 *     agreed is thrown away.
 *   · WBF AVERAGES the cluster, weighted by score. Agreeing passes pull the box
 *     toward consensus, which is measurably tighter than any one of them, and the
 *     cluster's size survives as `support` — the thing we actually want.
 *
 * `support` is the payoff. A box every pass found is a real object; a box one
 * pass found is a hallucination or a hard case. Same number, two uses: it
 * calibrates confidence (see `fuseDetections`), and it becomes the "agreement"
 * readout in the bench so the flicker is visible rather than mysterious.
 *
 * Pure — no DOM, no model, no imports. Runs under tsx in verify-pipeline.
 */

/** Normalized to the frame: 0..1, origin top-left, x1/y1 exclusive corner. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScoredBox {
  label: string;
  score: number;
  box: Box;
}

/** A fused box plus the evidence for it. */
export interface FusedBox extends ScoredBox {
  /** How many passes contributed a box to this cluster. */
  support: number;
  /** `support` over the number of passes that ran, 0..1. */
  agreement: number;
  /** Mean IoU of the members against the fused box — how tightly they agreed. */
  tightness: number;
  /** Score before the agreement penalty, for the "why" readout. */
  rawScore: number;
}

export const boxArea = (b: Box): number =>
  Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

export function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a: Box, b: Box): number {
  const inter = intersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Fraction of the SMALLER box covered by the other.
 *
 * IoU alone cannot see containment: a bottle wholly inside a person's box scores
 * a low IoU with it, and so does a duplicate detection of the bottle that happens
 * to be twice as large. This separates the two cases, and is what lets
 * `dropContained` remove a duplicate without removing the bottle.
 */
export function containment(a: Box, b: Box): number {
  const inter = intersectionArea(a, b);
  if (inter <= 0) return 0;
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? inter / smaller : 0;
}

export const clampBox = (b: Box): Box => ({
  x0: Math.min(Math.max(b.x0, 0), 1),
  y0: Math.min(Math.max(b.y0, 0), 1),
  x1: Math.min(Math.max(b.x1, 0), 1),
  y1: Math.min(Math.max(b.y1, 0), 1),
});

export interface FuseOptions {
  /** Boxes of the same label at or above this IoU join one cluster. */
  iouThreshold?: number;
  /**
   * Number of passes that ran. Drives `agreement`, so it must be the number of
   * passes ATTEMPTED, not the number that returned something.
   */
  passCount: number;
  /**
   * How hard a lone detection is punished. 0 disables the penalty entirely; 1
   * scales a single-pass box by 1/passCount. See `fuseDetections`.
   */
  agreementWeight?: number;
  /** Fused boxes below this final score are dropped. */
  minScore?: number;
}

interface Cluster {
  label: string;
  members: ScoredBox[];
  /** Running fused box, recomputed on every insert. */
  box: Box;
  scoreSum: number;
}

/**
 * Weighted Box Fusion across passes.
 *
 * The agreement penalty is the whole point, so it is worth being explicit about
 * the shape. A box found by every pass keeps its score untouched. A box found by
 * one pass out of six is multiplied by roughly 1/6 at `agreementWeight` 1. In
 * between it interpolates linearly:
 *
 *     final = raw × (1 − w + w × support / passCount)
 *
 * This is deliberately NOT a hard filter on support. A genuinely hard object —
 * small, backlit, half-occluded — is often found by exactly one pass, and
 * deleting it would trade a flickering true positive for a permanent false
 * negative. Demoting it instead lets the threshold decide, and lets the UI show
 * "1/6 passes" next to it so a human can judge.
 */
export function fuseBoxes(passes: ScoredBox[][], opts: FuseOptions): FusedBox[] {
  const iouThreshold = opts.iouThreshold ?? 0.55;
  const agreementWeight = opts.agreementWeight ?? 0.55;
  const minScore = opts.minScore ?? 0;
  const passCount = Math.max(1, opts.passCount);

  // Highest score first: strong detections seed the clusters, so a weak box joins
  // a confident one rather than the other way round. Fusing in arrival order
  // instead lets one bad early box capture a cluster and drag the fused
  // coordinates with it.
  const all = passes
    .flat()
    .filter((d) => Number.isFinite(d.score) && boxArea(d.box) > 0)
    .sort((a, b) => b.score - a.score);

  const clusters: Cluster[] = [];

  for (const det of all) {
    let best: Cluster | null = null;
    let bestIou = iouThreshold;
    for (const c of clusters) {
      // Class-aware: a bench and a person overlapping is two objects, not one.
      if (c.label !== det.label) continue;
      const overlap = iou(c.box, det.box);
      if (overlap >= bestIou) {
        bestIou = overlap;
        best = c;
      }
    }

    if (!best) {
      clusters.push({
        label: det.label,
        members: [det],
        box: { ...det.box },
        scoreSum: det.score,
      });
      continue;
    }

    best.members.push(det);
    best.scoreSum += det.score;
    // Score-weighted mean of every member — recomputed from scratch rather than
    // updated incrementally so the result does not depend on insertion order
    // beyond the sort above.
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    for (const m of best.members) {
      x0 += m.box.x0 * m.score;
      y0 += m.box.y0 * m.score;
      x1 += m.box.x1 * m.score;
      y1 += m.box.y1 * m.score;
    }
    best.box = {
      x0: x0 / best.scoreSum,
      y0: y0 / best.scoreSum,
      x1: x1 / best.scoreSum,
      y1: y1 / best.scoreSum,
    };
  }

  const fused: FusedBox[] = [];
  for (const c of clusters) {
    // One pass can legitimately return two boxes for the same object (a tile and
    // its overlapping neighbour both see it). Counting members would then claim
    // more agreement than there is, so support is capped at the pass count.
    const support = Math.min(c.members.length, passCount);
    const agreement = support / passCount;
    const rawScore = c.scoreSum / c.members.length;
    const score = rawScore * (1 - agreementWeight + agreementWeight * agreement);
    if (score < minScore) continue;

    const tightness =
      c.members.reduce((sum, m) => sum + iou(c.box, m.box), 0) / c.members.length;

    fused.push({
      label: c.label,
      score,
      box: clampBox(c.box),
      support,
      agreement,
      tightness,
      rawScore,
    });
  }

  return fused.sort((a, b) => b.score - a.score);
}

/**
 * Drop boxes almost wholly inside a same-label box.
 *
 * WBF clusters by IoU, which misses nested duplicates: a tile pass often returns
 * the visible half of a person as its own confident box, and half a person has a
 * low IoU with the whole person but sits entirely inside it. Left alone it
 * survives fusion as a second "person" and the bench shows two.
 *
 * Same-label only, and the smaller box has to be ≥`threshold` contained, so a
 * bottle on a dining table — different labels — is never touched.
 */
export function dropContained<T extends { label: string; box: Box; score: number }>(
  boxes: T[],
  threshold = 0.85,
): T[] {
  const kept: T[] = [];
  // Largest first, so the survivor is the enclosing box rather than the fragment.
  const byArea = [...boxes].sort((a, b) => boxArea(b.box) - boxArea(a.box));
  for (const cand of byArea) {
    const swallowed = kept.some(
      (k) =>
        k.label === cand.label &&
        boxArea(k.box) >= boxArea(cand.box) &&
        containment(k.box, cand.box) >= threshold,
    );
    if (!swallowed) kept.push(cand);
  }
  return kept.sort((a, b) => b.score - a.score);
}

/** Plain class-aware NMS, for callers that want a single pass cleaned up. */
export function nms<T extends { label: string; box: Box; score: number }>(
  boxes: T[],
  iouThreshold = 0.6,
): T[] {
  const kept: T[] = [];
  for (const cand of [...boxes].sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => k.label === cand.label && iou(k.box, cand.box) >= iouThreshold)) {
      continue;
    }
    kept.push(cand);
  }
  return kept;
}
