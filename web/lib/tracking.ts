/**
 * Sparse point tracking, for telling surfaces apart without depth.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The iOS recorder identifies a surface by its position: unproject LiDAR depth,
 * quantise to a 12 cm voxel, done. Two observations belong to the same surface
 * because they landed in the same voxel. A browser has no depth, so it cannot
 * do that — but it does not have to. Two observations also belong to the same
 * surface if they are the same VISUAL POINT tracked from one frame to the next,
 * which is a question pixels can answer on their own.
 *
 * So this replaces the voxel grid as the data-association step, and everything
 * downstream (see lib/coverage.ts) is the iOS algorithm unchanged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLOCK MATCHING, NOT LUCAS–KANADE
 *
 * LK is the textbook answer and is more precise. It is also gradient descent on
 * a 2×2 solve that diverges quietly on low texture, and its failures look like
 * plausible motion rather than like errors. Coarse-to-fine block matching is
 * exhaustive over a small window: it cannot diverge, its cost IS its confidence,
 * and integer-pixel precision is far more than enough here — the output feeds
 * 30° buckets, where a pixel of jitter is nothing.
 *
 * It runs on a ~192 px frame at ~12 Hz, which is roughly a megaflop a frame.
 * That matters: this shares a phone with a MediaRecorder and a WebRTC encoder.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * No DOM: takes raw pixels, returns numbers. Exercisable under `tsx`.
 */

export interface Gray {
  data: Uint8Array;
  w: number;
  h: number;
}

/** Rec. 601 luma, integer-shifted — this runs on every pixel of every frame. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return { data: out, w, h };
}

/** 2×2 box downsample. Cheap, and the blur is wanted — it is the pyramid. */
export function halve(g: Gray): Gray {
  const w = g.w >> 1;
  const h = g.h >> 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = (y << 1) * g.w;
    const r1 = r0 + g.w;
    for (let x = 0; x < w; x++) {
      const c = x << 1;
      out[y * w + x] =
        (g.data[r0 + c] + g.data[r0 + c + 1] + g.data[r1 + c] + g.data[r1 + c + 1]) >> 2;
    }
  }
  return { data: out, w, h };
}

/**
 * Coarse-to-fine levels, floored at 40 px.
 *
 * The floor is not an optimisation. A block needs `half` pixels of margin, so a
 * tiny top level makes a wide band around the frame untrackable — and the frame
 * EDGE is where the informative points are: things passing at the side are what
 * sweep through angles as you walk, while the middle of the view barely moves.
 * Halving past this point throws away the measurement to save nothing.
 */
export function pyramid(g: Gray, levels: number): Gray[] {
  const out = [g];
  for (let i = 1; i < levels; i++) {
    const prev = out[i - 1];
    if (prev.w < 80 || prev.h < 80) break;
    out.push(halve(prev));
  }
  return out;
}

/** Standard deviation of a block — the texture gate. */
export function blockStdDev(g: Gray, x: number, y: number, half: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let dy = -half; dy <= half; dy++) {
    const row = (y + dy) * g.w;
    for (let dx = -half; dx <= half; dx++) {
      const v = g.data[row + x + dx];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

function sad(
  a: Gray, ax: number, ay: number,
  b: Gray, bx: number, by: number,
  half: number,
): number {
  let s = 0;
  for (let dy = -half; dy <= half; dy++) {
    let ia = (ay + dy) * a.w + ax - half;
    let ib = (by + dy) * b.w + bx - half;
    for (let dx = -half; dx <= half; dx++, ia++, ib++) {
      const d = a.data[ia] - b.data[ib];
      s += d < 0 ? -d : d;
    }
  }
  return s;
}

const inBounds = (g: Gray, x: number, y: number, m: number) =>
  x >= m && y >= m && x < g.w - m && y < g.h - m;

interface Match {
  x: number;
  y: number;
  /** Mean absolute difference per pixel, 0…255. Low is good. */
  cost: number;
}

/** Exhaustive search in a ±radius window around a guess. */
function searchLevel(
  prev: Gray, px: number, py: number,
  next: Gray, gx: number, gy: number,
  radius: number, half: number,
): Match | null {
  if (!inBounds(prev, px, py, half)) return null;
  let best = Infinity;
  let bx = gx;
  let by = gy;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = gy + dy;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = gx + dx;
      if (!inBounds(next, x, y, half)) continue;
      const c = sad(prev, px, py, next, x, y, half);
      if (c < best) {
        best = c;
        bx = x;
        by = y;
      }
    }
  }
  if (!isFinite(best)) return null;
  const area = (2 * half + 1) * (2 * half + 1);
  return { x: bx, y: by, cost: best / area };
}

/**
 * Coarse-to-fine match of one point from `prevPyr` into `nextPyr`.
 *
 * The wide search happens once, at the top of the pyramid where a pixel is
 * worth 2^levels of the real frame; every level below only refines by ±1. That
 * is what makes a fast pan trackable without a 40-pixel search window.
 */
export function trackPoint(
  prevPyr: Gray[], nextPyr: Gray[],
  x: number, y: number,
  half: number, radius: number,
): Match | null {
  const top = prevPyr.length - 1;
  const fit = (v: number, g: Gray, axis: "w" | "h") =>
    Math.min(g[axis] - half - 1, Math.max(half, v));

  let gx = Math.round(x / (1 << top));
  let gy = Math.round(y / (1 << top));

  for (let l = top; l >= 0; l--) {
    const s = 1 << l;
    const prev = prevPyr[l];
    const next = nextPyr[l];
    let sx = Math.round(x / s);
    let sy = Math.round(y / s);

    if (l === 0) {
      // The only level whose bounds are a real answer: if the point itself is
      // against the edge of the actual frame, it has left and should die.
      if (!inBounds(prev, sx, sy, half)) return null;
    } else {
      // A coarse level only supplies a guess for the level below. Clamping a
      // near-edge point inward gives a slightly-off guess, which the finer
      // levels then correct — whereas rejecting it loses the point outright.
      sx = fit(sx, prev, "w");
      sy = fit(sy, prev, "h");
    }

    const res = searchLevel(
      prev, sx, sy,
      next, fit(gx, next, "w"), fit(gy, next, "h"),
      // ±2 rather than ±1 below the top, so a guess skewed by the clamp above
      // is still recoverable.
      l === top ? radius : 2, half,
    );
    if (!res) return null;
    if (l === 0) return res;
    gx = res.x * 2;
    gy = res.y * 2;
  }
  return null;
}

export interface TrackedPoint {
  id: number;
  x: number;
  y: number;
  /** Frames survived. Young points are not yet trustworthy. */
  age: number;
}

export interface TrackerUpdate {
  points: TrackedPoint[];
  /** Points that died this frame, so their coverage can be banked. */
  lost: TrackedPoint[];
  /** Points seeded this frame, so their coverage can be seeded. */
  born: TrackedPoint[];
  /**
   * Median per-frame displacement in frame pixels. High means consecutive
   * frames barely overlap, which is what actually starves a reconstructor —
   * COLMAP needs shared features between neighbouring views.
   */
  medianFlow: number;
}

export interface TrackerOptions {
  /** Half-width of the match block. 3 → 7×7. */
  half?: number;
  /** Search radius at the top pyramid level. */
  radius?: number;
  /** Below this block std-dev there is nothing to match; do not pretend. */
  minTexture?: number;
  /** Above this mean-abs-difference the match is not the same surface. */
  maxCost?: number;
  gridCols?: number;
  gridRows?: number;
}

/**
 * A grid of points, re-seeded as they die.
 *
 * A grid rather than a corner detector: corners cluster on whatever happens to
 * be busiest, and a capture where one poster is tracked forty times and the
 * rest of the room not at all reports coverage that means nothing. One point
 * per grid cell spreads the measurement over the frame.
 */
export class PointTracker {
  private readonly half: number;
  private readonly radius: number;
  private readonly minTexture: number;
  private readonly maxCost: number;
  private readonly cols: number;
  private readonly rows: number;

  private prev: Gray[] | null = null;
  private points: TrackedPoint[] = [];
  private nextId = 1;

  constructor(opts: TrackerOptions = {}) {
    this.half = opts.half ?? 3;
    this.radius = opts.radius ?? 4;
    this.minTexture = opts.minTexture ?? 7;
    this.maxCost = opts.maxCost ?? 18;
    this.cols = opts.gridCols ?? 6;
    this.rows = opts.gridRows ?? 8;
  }

  reset(): void {
    this.prev = null;
    this.points = [];
  }

  update(frame: Gray): TrackerUpdate {
    const pyr = pyramid(frame, 3);
    const lost: TrackedPoint[] = [];
    const flows: number[] = [];

    if (!this.prev) {
      this.prev = pyr;
      const born = this.seed(pyr[0]);
      return { points: [...this.points], lost, born, medianFlow: 0 };
    }

    const survivors: TrackedPoint[] = [];
    for (const p of this.points) {
      const fwd = trackPoint(this.prev, pyr, p.x, p.y, this.half, this.radius);
      if (!fwd || fwd.cost > this.maxCost) {
        lost.push(p);
        continue;
      }
      // Forward–backward check. A block that matches something plausible in the
      // next frame but does not match back to where it started is a repeated
      // texture or an occlusion boundary — the two cases that silently
      // manufacture parallax that never happened.
      const back = trackPoint(pyr, this.prev, fwd.x, fwd.y, this.half, this.radius);
      if (!back || Math.hypot(back.x - p.x, back.y - p.y) > 1.5) {
        lost.push(p);
        continue;
      }
      flows.push(Math.hypot(fwd.x - p.x, fwd.y - p.y));
      survivors.push({ id: p.id, x: fwd.x, y: fwd.y, age: p.age + 1 });
    }

    this.points = survivors;
    this.prev = pyr;
    const born = this.seed(pyr[0]);

    flows.sort((a, b) => a - b);
    const medianFlow = flows.length ? flows[flows.length >> 1] : 0;
    return { points: [...this.points], lost, born, medianFlow };
  }

  /** One point per empty grid cell, at its most textured spot. */
  private seed(g: Gray): TrackedPoint[] {
    const margin = this.half + 2;
    const cw = g.w / this.cols;
    const ch = g.h / this.rows;

    const taken = new Set<number>();
    for (const p of this.points) {
      taken.add(Math.floor(p.y / ch) * this.cols + Math.floor(p.x / cw));
    }

    const born: TrackedPoint[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (taken.has(r * this.cols + c)) continue;

        let bestX = -1;
        let bestY = -1;
        let bestTex = this.minTexture;
        // Nine candidates rather than every pixel: this runs for every empty
        // cell of every frame, and the exact pixel does not matter — only that
        // it has something to match on.
        for (let sy = 1; sy <= 3; sy++) {
          for (let sx = 1; sx <= 3; sx++) {
            const x = Math.round(c * cw + (sx * cw) / 4);
            const y = Math.round(r * ch + (sy * ch) / 4);
            if (!inBounds(g, x, y, margin)) continue;
            const tex = blockStdDev(g, x, y, this.half);
            if (tex > bestTex) {
              bestTex = tex;
              bestX = x;
              bestY = y;
            }
          }
        }
        // Nothing textured enough. Correct outcome: blank sky and bare walls
        // get no point, so nothing downstream claims to know anything there.
        if (bestX < 0) continue;

        const p: TrackedPoint = { id: this.nextId++, x: bestX, y: bestY, age: 0 };
        this.points.push(p);
        born.push(p);
      }
    }
    return born;
  }
}

export const medianOf = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
