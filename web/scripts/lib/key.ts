/**
 * Keying a painted sprite off its background, shared by the two asset builders
 * (build-design-assets.ts and build-blob-sprites.ts).
 *
 * Every source in ../design/ is an OPAQUE PNG painted on a dark navy field, so
 * before anything can be composited in the browser it has to be given an alpha
 * channel. A luminance threshold is not good enough: the blob's edge feather is
 * 14-20 px wide, and cutting through the middle of it leaves a navy rim on every
 * sprite. The source is a known composite instead —
 *
 *     C = a*F + (1-a)*B
 *
 * with B measured from the corners and F's luminance measured from the body — so
 * alpha can be SOLVED rather than guessed, and the true colour recovered:
 *
 *     a = (Y(C) - Y_B) / (Y_F - Y_B)
 *     F = (C - (1-a)*B) / a            <- THIS is the step that removes the halo
 *
 * Without the un-premultiply the feather stays navy-contaminated and the sprite
 * gets a dark outline. `meanEdgeLuma` in the result exists so a regression there
 * is visible in the build report rather than subtle in the browser.
 *
 * Nothing here is part of the Next build graph — see the header of
 * build-design-assets.ts for why sharp must stay out of package.json.
 */
import sharp from "sharp";

/** Alpha at or above this counts as body when measuring coverage. */
export const SOLID = 0.5;
/** Alpha at or above this counts as "part of some object" for connectivity. */
export const VISIBLE = 0.06;

export interface Raw {
  data: Buffer;
  w: number;
  h: number;
  c: number;
}

export async function readRaw(path: string): Promise<Raw> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function fnv1a(buf: Buffer): string {
  let h = 0x811c9dc5;
  for (const byte of buf) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0");
}

export interface Background {
  rgb: [number, number, number];
  y: number;
}

/** Median background colour, sampled from all four corners. */
export function measureBackground(img: Raw, pad = 16): Background {
  const samples: Array<[number, number, number]> = [];
  const corners: Array<[number, number]> = [
    [0, 0],
    [img.w - pad, 0],
    [0, img.h - pad],
    [img.w - pad, img.h - pad],
  ];
  for (const [ox, oy] of corners) {
    for (let y = oy; y < oy + pad; y++) {
      for (let x = ox; x < ox + pad; x++) {
        const i = (y * img.w + x) * img.c;
        samples.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
      }
    }
  }
  const med = (k: number) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const rgb: [number, number, number] = [med(0), med(1), med(2)];
  return { rgb, y: luma(rgb[0], rgb[1], rgb[2]) };
}

/** Median luminance of the bright body, so the alpha solve has a real F. */
export function measureBodyLuma(img: Raw, floor = 150): number {
  const vals: number[] = [];
  for (let i = 0; i < img.data.length; i += img.c * 7) {
    const y = luma(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (y > floor) vals.push(y);
  }
  vals.sort((a, b) => a - b);
  return vals.length ? vals[vals.length >> 1] : 220;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Component {
  /** Index into `Keyed.labels` — the value this component's pixels carry. */
  id: number;
  /** Pixel count at or above VISIBLE. */
  size: number;
  box: Box;
}

export interface Keyed {
  rgba: Buffer;
  w: number;
  h: number;
  /** Bounding box of everything kept. */
  bbox: Box;
  /** Bounding box of the largest kept component alone — the character itself. */
  mainBox: Box;
  /** Every component that survived, largest first. */
  kept: Component[];
  /**
   * Per-pixel component id, -1 for background and for anything discarded.
   * This is what lets a caller separate one kept component from another
   * exactly — bounding boxes are not enough, because the painted Zzz's box
   * overlaps the blob's without a single pixel of the two touching.
   */
  labels: Int32Array;
  coverage: number;
  holesFilled: number;
  bodyPx: number;
  droppedComponents: number;
  meanEdgeLuma: number;
}

export interface KeyOptions {
  /**
   * "largest" keeps only the biggest connected component and discards the rest —
   * the right call for the walk strip, where every extra component is a firefly.
   * "all" keeps every component of at least `minComponent` px, which is what a
   * pose with a deliberate accessory (the Zzz, the hover glow) needs.
   */
  keep?: "largest" | "all";
  /** Under "all", components smaller than this are treated as noise. */
  minComponent?: number;
}

/**
 * Key one region out of its background and recover its true colour.
 *
 * Order matters: solve alpha, repaint the silhouette's interior from the source
 * (the eyes and mouth are dark and the solve reads dark as transparent), drop
 * stray components, then trim. Doing this at FULL resolution and downscaling
 * once afterwards means the 14-20 px feather becomes sub-pixel and the
 * resampler produces the anti-aliasing for free.
 */
export function keyRegion(
  img: Raw,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  bg: Background,
  bodyY: number,
  opts: KeyOptions = {},
): Keyed {
  const { keep: keepMode = "largest", minComponent = 40 } = opts;
  const n = rw * rh;
  const alpha = new Float32Array(n);
  const rgb = new Uint8ClampedArray(n * 3);
  const span = Math.max(1, bodyY - bg.y);

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const si = ((ry + y) * img.w + (rx + x)) * img.c;
      const R = img.data[si];
      const G = img.data[si + 1];
      const B = img.data[si + 2];
      const a = Math.min(1, Math.max(0, (luma(R, G, B) - bg.y) / span));
      const di = y * rw + x;
      alpha[di] = a;

      // Un-premultiply: F = (C - (1-a)B) / a. The guard keeps the division sane
      // where alpha is near zero; those pixels contribute nothing once composited.
      const as = Math.max(a, 0.06);
      rgb[di * 3] = (R - (1 - as) * bg.rgb[0]) / as;
      rgb[di * 3 + 1] = (G - (1 - as) * bg.rgb[1]) / as;
      rgb[di * 3 + 2] = (B - (1 - as) * bg.rgb[2]) / as;
    }
  }

  // ── Separate the silhouette's inside from its edge ─────────────────────────
  // Flood from the border through transparent pixels. Whatever the flood never
  // reaches is enclosed by the character, and inside a character painted opaque
  // on a flat field the source pixel IS the answer: alpha 1, colour C.
  const reached = new Uint8Array(n);
  const stack: number[] = [];
  const pushIf = (i: number) => {
    if (!reached[i] && alpha[i] < SOLID) {
      reached[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < rw; x++) {
    pushIf(x);
    pushIf((rh - 1) * rw + x);
  }
  for (let y = 0; y < rh; y++) {
    pushIf(y * rw);
    pushIf(y * rw + rw - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % rw;
    const y = (i - x) / rw;
    if (x > 0) pushIf(i - 1);
    if (x < rw - 1) pushIf(i + 1);
    if (y > 0) pushIf(i - rw);
    if (y < rh - 1) pushIf(i + rw);
  }

  // WHY THE WHOLE INTERIOR IS REPAINTED AND NOT JUST THE HOLES.
  //
  // Solving alpha from luminance treats DARKNESS as transparency, which is true
  // at the character's edge and false everywhere inside it. Rescuing only the
  // sub-SOLID pixels leaves the boundary between the two treatments running
  // straight through every dark feature: the top of an eye keeps a solved alpha
  // and an un-premultiplied colour, the bottom is repainted opaque, and the eye
  // ships with a hard step across it and a flat yellow half. Measured on the
  // pose sheet's `surprised`, side by side against the source — the eyes are
  // posterised beyond recognition.
  //
  // Everything the border flood cannot reach is inside the silhouette, where the
  // source is opaque paint. So take the source pixel whole. Only the feather —
  // which the flood does reach — needs the solve, which is the one place it is
  // actually the right model.
  //
  // Restricted to the LARGEST enclosed region, i.e. the character. A soft
  // accessory (the hover glow) has an enclosed bright core too, and forcing that
  // opaque would turn a glow into a hard yellow disc.
  const inside = new Int32Array(n).fill(-1);
  const regions: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (reached[seed] || inside[seed] >= 0) continue;
    const id = regions.length;
    let count = 0;
    const q = [seed];
    inside[seed] = id;
    while (q.length) {
      const i = q.pop()!;
      count++;
      const x = i % rw;
      const y = (i - x) / rw;
      const t = (j: number) => {
        if (!reached[j] && inside[j] < 0) {
          inside[j] = id;
          q.push(j);
        }
      };
      if (x > 0) t(i - 1);
      if (x < rw - 1) t(i + 1);
      if (y > 0) t(i - rw);
      if (y < rh - 1) t(i + rw);
    }
    regions.push(count);
  }
  const body = regions.length ? regions.indexOf(Math.max(...regions)) : -1;

  let holesFilled = 0;
  for (let i = 0; i < n; i++) {
    if (inside[i] !== body || body < 0) continue;
    // Counted before the rewrite, so the metric still means "features the key
    // would have cut out" rather than "pixels touched".
    if (alpha[i] < SOLID) holesFilled++;
    alpha[i] = 1;
    const si = (ry + ((i - (i % rw)) / rw)) * img.w + (rx + (i % rw));
    const p = si * img.c;
    rgb[i * 3] = img.data[p];
    rgb[i * 3 + 1] = img.data[p + 1];
    rgb[i * 3 + 2] = img.data[p + 2];
  }

  // ── Label components ───────────────────────────────────────────────────────
  // Connectivity uses VISIBLE, not SOLID. A soft accessory's opaque core and its
  // glow are one object; thresholding at 0.5 would drop the core and leave the
  // glow behind as a smudge that still inflates the trim bbox.
  const label = new Int32Array(n).fill(-1);
  const comps: Component[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (alpha[seed] < VISIBLE || label[seed] >= 0) continue;
    const id = comps.length;
    let count = 0;
    let bx0 = rw;
    let by0 = rh;
    let bx1 = -1;
    let by1 = -1;
    const q = [seed];
    label[seed] = id;
    while (q.length) {
      const i = q.pop()!;
      count++;
      const x = i % rw;
      const y = (i - x) / rw;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      const tryPush = (j: number) => {
        if (alpha[j] >= VISIBLE && label[j] < 0) {
          label[j] = id;
          q.push(j);
        }
      };
      if (x > 0) tryPush(i - 1);
      if (x < rw - 1) tryPush(i + 1);
      if (y > 0) tryPush(i - rw);
      if (y < rh - 1) tryPush(i + rw);
    }
    comps.push({ id, size: count, box: { x0: bx0, y0: by0, x1: bx1, y1: by1 } });
  }

  const order = comps.map((_, i) => i).sort((a, b) => comps[b].size - comps[a].size);
  // Under "largest": each walk frame contains exactly one blob and every other
  // component is a firefly — including its soft glow, which at the VISIBLE
  // threshold can run to several thousand pixels and survives any
  // percentage-of-largest rule. Anything that splits the blob itself shows up
  // immediately as a coverage-gate failure, so this is safe as well as decisive.
  const keepIds =
    keepMode === "largest"
      ? order.slice(0, comps.length ? 1 : 0)
      : order.filter((i) => comps[i].size >= minComponent);
  const keep = new Set(keepIds);
  const mainId = order.length ? order[0] : -1;

  // ── Compose RGBA, measure, and find the content bbox ────────────────────────
  const rgba = Buffer.alloc(n * 4);
  let x0 = rw;
  let y0 = rh;
  let x1 = -1;
  let y1 = -1;
  let covered = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  for (let i = 0; i < n; i++) {
    // Anything not kept is background — including pixels BELOW the VISIBLE
    // threshold, which never get a component label at all. A dropped component's
    // outermost glow lives at alpha 0.01-0.05 and would otherwise survive as a
    // faint ghost rectangle beside the sprite. The kept body's own sub-0.06
    // feather goes with it, which is imperceptible and is already outside the
    // trim bbox.
    const kept = keep.has(label[i]);
    if (!kept) label[i] = -1;
    const a = kept ? alpha[i] : 0;
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = Math.round(a * 255);

    if (a > 0.06) {
      const x = i % rw;
      const y = (i - x) / rw;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (a >= SOLID) covered++;
      // The feather ring is where a halo would show. Sample it.
      if (a > 0.15 && a < 0.75) {
        edgeSum += luma(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
        edgeCount++;
      }
    }
  }

  return {
    rgba,
    w: rw,
    h: rh,
    bbox: { x0, y0, x1, y1 },
    mainBox: mainId >= 0 ? comps[mainId].box : { x0, y0, x1, y1 },
    kept: keepIds.map((i) => comps[i]),
    labels: label,
    coverage: covered / n,
    holesFilled,
    bodyPx: covered,
    droppedComponents: comps.length - keep.size,
    meanEdgeLuma: edgeCount ? edgeSum / edgeCount : 0,
  };
}

/** A compact ASCII alpha map — the analogue of build-landmask's ASCII Earth. */
export function alphaMap(k: Keyed, cols = 54, rows = 20, box: Box = k.bbox): string {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const lines: string[] = [];
  for (let ry = 0; ry < rows; ry++) {
    let line = "  ";
    for (let rx = 0; rx < cols; rx++) {
      let sum = 0;
      let count = 0;
      const yA = box.y0 + Math.floor((ry * bh) / rows);
      const yB = box.y0 + Math.floor(((ry + 1) * bh) / rows);
      const xA = box.x0 + Math.floor((rx * bw) / cols);
      const xB = box.x0 + Math.floor(((rx + 1) * bw) / cols);
      for (let y = yA; y < yB; y++) {
        for (let x = xA; x < xB; x++) {
          sum += k.rgba[(y * k.w + x) * 4 + 3] / 255;
          count++;
        }
      }
      const a = count ? sum / count : 0;
      line += a > 0.9 ? "@" : a > 0.5 ? "+" : a > 0.05 ? "." : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
