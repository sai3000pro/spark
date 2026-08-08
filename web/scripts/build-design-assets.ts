/**
 * Bakes the illustrated design assets in ../design/ into web-ready files.
 *
 *   npm run build:design      # writes lib/heroAssets.ts, public/hero/*, report to stderr
 *
 * The sources are 14.9 MB of opaque PNGs painted on a dark navy field. Three
 * things have to happen before they can be used:
 *
 *   1. The blob has no alpha channel. It must be keyed off its background.
 *   2. The aurora plate is 4 MB at 5424x3063 and must be resized and re-encoded.
 *   3. The blob's position on the plate has to be MEASURED, not guessed, or the
 *      sprite drifts off the painted path at other viewport sizes.
 *
 * WHY THE KEY IS A LINEAR SOLVE AND NOT A THRESHOLD.
 * The source is a known opaque composite: C = a*F + (1-a)*B, with B measured
 * from the corners. A luminance threshold would cut through the middle of the
 * blob's 14-20px edge feather and leave a navy rim on every sprite. Instead:
 *
 *     a = (Y(C) - Y_B) / (Y_F - Y_B)
 *     F = (C - (1-a)*B) / a            <- THIS is the step that removes the halo
 *
 * Without the un-premultiply the feather stays navy-contaminated and the sprite
 * gets a dark outline. The report prints the mean recovered edge luminance so a
 * regression here is visible rather than subtle.
 *
 * This script is NOT part of the Next build graph. Nothing under app/ or lib/
 * imports scripts/, and every output is COMMITTED — so `next build` never runs
 * sharp, never reads ../design/, and would still succeed with node_modules
 * deleted and reinstalled. That matters because sharp is only present as a
 * transitive dependency of @huggingface/transformers; it is deliberately not in
 * package.json and must not be added.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, "..", "..", "design");
const OUT_DIR = join(HERE, "..", "public", "hero");

const SRC = {
  /**
   * THE SHIPPED PLATE. The forest and the lit path with the sky left empty —
   * no aurora, no fireflies. Both of those are rendered live in the browser now
   * (components/hero/HeroSky.tsx) so they move, which a baked-in plate cannot.
   */
  plate: "Night forest _ no aurora_ no fireflies.png",
  /**
   * The ORIGINAL painted plate. Not shipped. Read only to measure two things the
   * live layers then reproduce: the aurora's real colours, and where the artist
   * actually put the fireflies. Inventing either would be the one place this
   * stops matching the illustration.
   */
  painted: "Aurora scene _ clean_ empty.png",
  /** Not shipped either — used only to locate the blob on the plate. */
  withBlob: "Aurora scene _ blob_ no text.png",
  walk: "Blob walk-cycle strip.png",
} as const;

/** Recorded so a changed source is caught instead of silently re-encoded. */
const EXPECTED: Record<string, { bytes: number; w: number; h: number }> = {
  [SRC.plate]: { bytes: 3_038_575, w: 5424, h: 3063 },
  [SRC.painted]: { bytes: 4_186_064, w: 5424, h: 3063 },
  [SRC.withBlob]: { bytes: 4_574_227, w: 5429, h: 3060 },
  [SRC.walk]: { bytes: 2_573_002, w: 7072, h: 2336 },
};

const WALK_FRAMES = 6;
/** Output cell width in px. The blob renders ~166-266 px; 400 covers 1.5-2.4x. */
const CELL_W = 400;
/** Alpha at or above this counts as body when measuring coverage. */
const SOLID = 0.5;
/** Alpha at or above this counts as "part of some object" for connectivity. */
const VISIBLE = 0.06;

const err = (s: string) => process.stderr.write(s + "\n");

// ─────────────────────────────────────────────────────────────────────────────
// Raw image helpers
// ─────────────────────────────────────────────────────────────────────────────

interface Raw {
  data: Buffer;
  w: number;
  h: number;
  c: number;
}

async function readRaw(file: string): Promise<Raw> {
  const { data, info } = await sharp(join(DESIGN, file)).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function fnv1a(buf: Buffer): string {
  let h = 0x811c9dc5;
  for (const byte of buf) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0");
}

/** Median background colour, sampled from all four corners. */
function measureBackground(img: Raw, pad = 16): { rgb: [number, number, number]; y: number } {
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
function measureBodyLuma(img: Raw, floor = 150): number {
  const vals: number[] = [];
  for (let i = 0; i < img.data.length; i += img.c * 7) {
    const y = luma(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (y > floor) vals.push(y);
  }
  vals.sort((a, b) => a - b);
  return vals.length ? vals[vals.length >> 1] : 220;
}

// ─────────────────────────────────────────────────────────────────────────────
// Measuring the painted sky
//
// The aurora and the fireflies now live in CSS. These two functions read what
// the artist actually painted so the live versions reproduce it rather than
// approximating it with hand-picked teals and random scatter.
// ─────────────────────────────────────────────────────────────────────────────

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/**
 * The aurora's real colour — measured as the light it ADDS, not as it appears.
 *
 * Sampling the painted pixels directly gives rgb(46,76,103): blue-dominant, and
 * useless. That is not the aurora's colour, it is the aurora composited over a
 * blue night sky. The live layer blends with `screen`, which is additive, so
 * what it needs to emit is the DIFFERENCE between the painted plate and the
 * stripped one — the emitted light itself, which measures as a mint-cyan.
 *
 * The delta is emitted RAW, not normalised to full saturation. Normalising it
 * turns rgb(27,50,41) into rgb(138,255,209) — a near-white mint that screen
 * blends into a solid teal wash and erases the forest behind it. The dimness IS
 * the measurement: `screen` over a dark sky is close to addition, so emitting
 * the measured delta at full opacity reproduces the painted intensity, and the
 * stylesheet only has to divide it across the stacked ribbons.
 */
function measureAurora(painted: Raw, plate: Raw) {
  const deltas: Array<[number, number, number, number]> = []; // r,g,b,y
  for (let y = Math.floor(painted.h * 0.05); y < painted.h * 0.6; y++) {
    for (let x = 0; x < painted.w; x += 2) {
      const i = (y * painted.w + x) * painted.c;
      const dr = painted.data[i] - plate.data[i];
      const dg = painted.data[i + 1] - plate.data[i + 1];
      const db = painted.data[i + 2] - plate.data[i + 2];
      // Brighter in green than in red — the aurora. The warm horizon glow is
      // the opposite and is excluded by `dr < dg`.
      if (dg > 14 && dr < dg) deltas.push([Math.max(0, dr), dg, Math.max(0, db), y / painted.h]);
    }
  }

  if (deltas.length < 2000) {
    fail(`aurora: only ${deltas.length} delta pixels — the two plates may not be the same scene`);
    return { core: "#8affd1", glow: "#87ffff", top: 0.115, bottom: 0.59, coverage: 0 };
  }

  const at = (p: number, k: number) => {
    const v = deltas.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length * p)];
  };
  const raw = (p: number) => hex(at(p, 0), at(p, 1), at(p, 2));
  const ys = deltas.map((s) => s[3]).sort((a, b) => a - b);
  const peak = [at(0.97, 0), at(0.97, 1), at(0.97, 2)] as const;

  return {
    /** The body of a curtain. */
    core: raw(0.6),
    /** Its bright spine. */
    glow: raw(0.9),
    /** The brightest light the painting ever added — the ceiling to stay under. */
    peak: hex(peak[0], peak[1], peak[2]),
    top: Number(ys[Math.floor(ys.length * 0.02)].toFixed(3)),
    bottom: Number(ys[Math.floor(ys.length * 0.98)].toFixed(3)),
    coverage: deltas.length,
  };
}

export interface Firefly {
  x: number;
  y: number;
  r: number;
}

/**
 * Where the fireflies were painted.
 *
 * Differencing the painted plate against the stripped one leaves exactly two
 * things: the aurora and the fireflies. The aurora is a huge, green, diffuse
 * region in the upper sky; a firefly is a tiny, warm, compact dot. Gating on
 * area + warmth separates them, and anything inside the aurora's vertical band
 * is dropped outright as belt-and-braces.
 *
 * Returned in FLOPPED space, because the shipped plate is mirrored.
 */
function measureFireflies(painted: Raw, plate: Raw, auroraBottom: number): Firefly[] {
  const { w, h, c } = painted;
  const lit = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      const dr = painted.data[i] - plate.data[i];
      const dg = painted.data[i + 1] - plate.data[i + 1];
      const db = painted.data[i + 2] - plate.data[i + 2];
      // Brighter in the painted version, and WARM — fireflies are yellow-white,
      // the aurora is green-cyan and loses on the red channel.
      if (dr > 40 && dg > 30 && dr >= db + 12) lit[y * w + x] = 1;
    }
  }

  const seen = new Uint8Array(w * h);
  const found: Firefly[] = [];
  const maxArea = w * h * 0.0005;

  for (let seed = 0; seed < lit.length; seed++) {
    if (!lit[seed] || seen[seed]) continue;
    let n = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    const q = [seed];
    seen[seed] = 1;
    while (q.length) {
      const i = q.pop()!;
      n++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const t = (j: number) => {
        if (lit[j] && !seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
      };
      if (x > 0) t(i - 1);
      if (x < w - 1) t(i + 1);
      if (y > 0) t(i - w);
      if (y < h - 1) t(i + w);
    }

    const cy = (y0 + y1) / 2 / h;
    const wide = x1 - x0 + 1;
    const tall = y1 - y0 + 1;
    const aspect = wide / tall;
    // Compact, small, below the aurora, and not a sliver.
    if (n < 12 || n > maxArea) continue;
    if (cy < auroraBottom) continue;
    if (aspect < 0.45 || aspect > 2.2) continue;

    found.push({
      x: Number((1 - (x0 + x1) / 2 / w).toFixed(4)), // flopped
      y: Number(cy.toFixed(4)),
      r: Number((Math.max(wide, tall) / 2 / w).toFixed(5)),
    });
  }

  return found.sort((a, b) => a.y - b.y);
}

// ─────────────────────────────────────────────────────────────────────────────
// The key
// ─────────────────────────────────────────────────────────────────────────────

interface Keyed {
  rgba: Buffer;
  w: number;
  h: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  coverage: number;
  holesFilled: number;
  bodyPx: number;
  droppedComponents: number;
  meanEdgeLuma: number;
}

/**
 * Key one region out of its background and recover its true colour.
 *
 * Order matters: solve alpha, fill interior holes (the eyes and mouth are dark
 * and would otherwise key out transparent), drop stray components (fireflies),
 * then trim. Doing this at FULL resolution and downscaling once afterwards means
 * the 14-20px feather becomes sub-pixel and the resampler produces the
 * anti-aliasing for free.
 */
function keyRegion(
  img: Raw,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  bg: { rgb: [number, number, number]; y: number },
  bodyY: number,
): Keyed {
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

  // ── Fill interior holes ──────────────────────────────────────────────────
  // Flood from the border through transparent pixels; anything transparent that
  // the flood never reaches is enclosed by the body and is therefore a feature,
  // not background. Set it opaque and keep its ORIGINAL composited colour, which
  // for an enclosed pixel is already the true colour.
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

  let holesFilled = 0;
  for (let i = 0; i < n; i++) {
    if (alpha[i] < SOLID && !reached[i]) {
      alpha[i] = 1;
      const si = (ry + ((i - (i % rw)) / rw)) * img.w + (rx + (i % rw));
      const p = si * img.c;
      rgb[i * 3] = img.data[p];
      rgb[i * 3 + 1] = img.data[p + 1];
      rgb[i * 3 + 2] = img.data[p + 2];
      holesFilled++;
    }
  }

  // ── Drop stray components (fireflies) ────────────────────────────────────
  // Connectivity uses VISIBLE, not SOLID. A firefly's opaque core and its soft
  // glow are one object; thresholding at 0.5 would drop the core and leave the
  // glow behind as a smudge that still inflates the trim bbox.
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (alpha[seed] < VISIBLE || label[seed] >= 0) continue;
    const id = sizes.length;
    let count = 0;
    const q = [seed];
    label[seed] = id;
    while (q.length) {
      const i = q.pop()!;
      count++;
      const x = i % rw;
      const y = (i - x) / rw;
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
    sizes.push(count);
  }
  // Keep ONLY the largest component. Each frame contains exactly one blob, and
  // every other component is a firefly — including its soft glow, which at the
  // VISIBLE threshold can run to several thousand pixels and survives any
  // percentage-of-largest rule. Anything that splits the blob itself shows up
  // immediately as a coverage-gate failure, so this is safe as well as decisive.
  const biggest = sizes.length ? Math.max(...sizes) : 0;
  const keepId = sizes.indexOf(biggest);
  const keep = new Set(biggest > 0 ? [keepId] : []);
  const droppedComponents = Math.max(0, sizes.length - 1);

  // ── Compose RGBA, measure, and find the content bbox ─────────────────────
  const rgba = Buffer.alloc(n * 4);
  let x0 = rw;
  let y0 = rh;
  let x1 = -1;
  let y1 = -1;
  let covered = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  for (let i = 0; i < n; i++) {
    // Anything not connected to the kept blob is background — including pixels
    // BELOW the VISIBLE threshold, which never get a component label at all. A
    // dropped firefly's outermost glow lives at alpha 0.01-0.05 and would
    // otherwise survive as a faint ghost rectangle beside the sprite. The blob's
    // own sub-0.06 feather goes with it, which is imperceptible and is already
    // outside the trim bbox.
    const a = keep.has(label[i]) ? alpha[i] : 0;
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
    coverage: covered / n,
    holesFilled,
    bodyPx: covered,
    droppedComponents,
    meanEdgeLuma: edgeCount ? edgeSum / edgeCount : 0,
  };
}

/** A compact ASCII alpha map — the analogue of build-landmask's ASCII Earth. */
function alphaMap(k: Keyed, cols = 54, rows = 20): string {
  const bw = k.bbox.x1 - k.bbox.x0 + 1;
  const bh = k.bbox.y1 - k.bbox.y0 + 1;
  const lines: string[] = [];
  for (let ry = 0; ry < rows; ry++) {
    let line = "  ";
    for (let rx = 0; rx < cols; rx++) {
      let sum = 0;
      let count = 0;
      const yA = k.bbox.y0 + Math.floor((ry * bh) / rows);
      const yB = k.bbox.y0 + Math.floor(((ry + 1) * bh) / rows);
      const xA = k.bbox.x0 + Math.floor((rx * bw) / cols);
      const xB = k.bbox.x0 + Math.floor(((rx + 1) * bw) / cols);
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

// ─────────────────────────────────────────────────────────────────────────────

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  err("─".repeat(72));
  for (const file of Object.values(SRC)) {
    const buf = readFileSync(join(DESIGN, file));
    const meta = await sharp(buf).metadata();
    const want = EXPECTED[file];
    const drift =
      buf.length !== want.bytes || meta.width !== want.w || meta.height !== want.h ? "  <-- DRIFT" : "";
    err(
      `${file.padEnd(34)} ${String(buf.length).padStart(9)} B  ${meta.width}x${meta.height}  ${fnv1a(buf)}${drift}`,
    );
  }
  err("─".repeat(72));

  // ── Blob frames ──────────────────────────────────────────────────────────
  const walk = await readRaw(SRC.walk);
  const walkBg = measureBackground(walk);
  const walkBody = measureBodyLuma(walk);
  err(
    `\nwalk strip   bg #${walkBg.rgb.map((v) => v.toString(16).padStart(2, "0")).join("")} luma ${walkBg.y.toFixed(1)}   body luma ${walkBody.toFixed(0)}`,
  );

  const cellW = walk.w / WALK_FRAMES;
  if (!Number.isInteger(Math.round(cellW * 100) / 100)) {
    err(`  note: cell width ${cellW.toFixed(2)} is fractional; frames use floor/ceil bounds`);
  }

  const walkKeys: Keyed[] = [];
  for (let f = 0; f < WALK_FRAMES; f++) {
    const x0 = Math.round(f * cellW);
    const x1 = Math.round((f + 1) * cellW);
    walkKeys.push(keyRegion(walk, x0, 0, x1 - x0, walk.h, walkBg, walkBody));
  }

  // Union bbox = the common cell. Six independently trimmed frames would each
  // have a different bbox (the walk's body sway), and that registration would
  // then have to be reintroduced in CSS per frame. One common cell carries it.
  const union = walkKeys.reduce(
    (u, k) => ({
      x0: Math.min(u.x0, k.bbox.x0),
      y0: Math.min(u.y0, k.bbox.y0),
      x1: Math.max(u.x1, k.bbox.x1),
      y1: Math.max(u.y1, k.bbox.y1),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  // Breathing room around the union bbox so the feet never sit flush against the
  // cell edge, and so a CSS glow behind the sprite has somewhere to land.
  const PAD = 14;
  const uw = union.x1 - union.x0 + 1 + PAD * 2;
  const uh = union.y1 - union.y0 + 1 + PAD * 2;
  const cellAr = uw / uh;

  err(`\nwalk common cell ${uw}x${uh}  (aspect ${cellAr.toFixed(3)})`);

  for (let f = 0; f < WALK_FRAMES; f++) {
    const k = walkKeys[f];
    const bw = k.bbox.x1 - k.bbox.x0 + 1;
    const bh = k.bbox.y1 - k.bbox.y0 + 1;
    err(
      `\nwalk[${f}]  bbox ${k.bbox.x0},${k.bbox.y0} ${bw}x${bh}   cov ${(k.coverage * 100).toFixed(2)}%   ` +
        `holes ${k.holesFilled} px (${((k.holesFilled / Math.max(1, k.bodyPx)) * 100).toFixed(2)}% of body)   ` +
        `edge luma ${k.meanEdgeLuma.toFixed(0)}   dropped ${k.droppedComponents}`,
    );
    err(alphaMap(k));

    if (k.bbox.x0 <= 0 || k.bbox.x1 >= k.w - 1) fail(`walk[${f}] bbox touches its cell edge`);
    if (k.coverage < 0.08 || k.coverage > 0.4) fail(`walk[${f}] coverage ${(k.coverage * 100).toFixed(1)}% outside 8-40%`);
    if (k.holesFilled / Math.max(1, k.bodyPx) > 0.08) fail(`walk[${f}] filled >8% of body — the key is eating the blob`);
    if (k.meanEdgeLuma < 180) fail(`walk[${f}] mean edge luma ${k.meanEdgeLuma.toFixed(0)} < 180 — halo`);
  }

  // Idle frame = the one with the narrowest foot separation (both feet planted).
  let idleFrame = 0;
  let narrowest = Infinity;
  for (let f = 0; f < WALK_FRAMES; f++) {
    const k = walkKeys[f];
    const footTop = k.bbox.y1 - Math.round((k.bbox.y1 - k.bbox.y0) * 0.12);
    let minX = k.w;
    let maxX = -1;
    for (let y = footTop; y <= k.bbox.y1; y++) {
      for (let x = k.bbox.x0; x <= k.bbox.x1; x++) {
        if (k.rgba[(y * k.w + x) * 4 + 3] > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    const spread = maxX - minX;
    if (spread < narrowest) {
      narrowest = spread;
      idleFrame = f;
    }
  }
  err(`\nidle frame: ${idleFrame} (narrowest foot spread ${narrowest} px)`);

  // ── Pack the walk sheet ──────────────────────────────────────────────────
  const cellH = Math.round(CELL_W / cellAr);
  // Structural types rather than sharp's own: sharp is an undeclared transitive
  // dependency, so its type namespace is not reliably resolvable here.
  const tiles: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let f = 0; f < WALK_FRAMES; f++) {
    const k = walkKeys[f];
    const sx = Math.max(0, union.x0 - PAD);
    const sy = Math.max(0, union.y0 - PAD);
    const sw = Math.min(uw, k.w - sx);
    const sh = Math.min(uh, k.h - sy);
    const cut = await sharp(k.rgba, { raw: { width: k.w, height: k.h, channels: 4 } })
      .extract({ left: sx, top: sy, width: sw, height: sh })
      .resize(CELL_W, cellH, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    tiles.push({ input: cut, left: f * CELL_W, top: 0 });
  }

  const walkOut = join(OUT_DIR, "blob-walk.webp");
  await sharp({
    create: { width: CELL_W * WALK_FRAMES, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(tiles)
    .webp({ quality: 78, alphaQuality: 70, effort: 6 })
    .toFile(walkOut);

  // ── Blob anchor ──────────────────────────────────────────────────────────
  // Difference-keying the two plate renders does NOT work: they are separate
  // renders of the same scene, not one plate with a blob composited on top, so
  // the diff covers the entire frame. (Measured: 2.67% of pixels differ, bbox
  // spans the full width.) Locate the blob by its own signature instead.
  //
  // The blob is bright AND NEUTRAL. The lit path is equally bright but warm, and
  // that is the whole separation: `max - min` channel spread stays under ~34 on
  // the blob and runs far higher on the path. The horizon glow also passes the
  // brightness+neutrality test, so candidates are additionally gated on aspect
  // ratio — the blob is roughly square, the horizon band is 8:1.
  const anchorSrc = await sharp(join(DESIGN, SRC.withBlob))
    .resize(1356, 764, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const aw = anchorSrc.info.width;
  const ah = anchorSrc.info.height;
  const ac = anchorSrc.info.channels;

  const neutral = new Uint8Array(aw * ah);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = (y * aw + x) * ac;
      const R = anchorSrc.data[i];
      const G = anchorSrc.data[i + 1];
      const B = anchorSrc.data[i + 2];
      if (luma(R, G, B) > 140 && Math.max(R, G, B) - Math.min(R, G, B) < 34) neutral[y * aw + x] = 1;
    }
  }

  const seen = new Int32Array(aw * ah).fill(-1);
  let best: { size: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let seed = 0; seed < neutral.length; seed++) {
    if (!neutral[seed] || seen[seed] >= 0) continue;
    let size = 0;
    let bx0 = aw;
    let by0 = ah;
    let bx1 = -1;
    let by1 = -1;
    const q = [seed];
    seen[seed] = seed;
    while (q.length) {
      const i = q.pop()!;
      size++;
      const x = i % aw;
      const y = (i - x) / aw;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      const t = (j: number) => {
        if (neutral[j] && seen[j] < 0) {
          seen[j] = seed;
          q.push(j);
        }
      };
      if (x > 0) t(i - 1);
      if (x < aw - 1) t(i + 1);
      if (y > 0) t(i - aw);
      if (y < ah - 1) t(i + aw);
    }
    const aspect = (bx1 - bx0 + 1) / (by1 - by0 + 1);
    const hFrac = (by1 - by0 + 1) / ah;
    if (aspect < 0.6 || aspect > 1.6 || hFrac < 0.05 || hFrac > 0.4) continue;
    if (!best || size > best.size) best = { size, x0: bx0, y0: by0, x1: bx1, y1: by1 };
  }

  if (!best) {
    fail("blob anchor: no compact neutral-bright component found in the blob plate");
  }
  // The plate is flopped at build time so the headline gets the dark side of the
  // frame instead of the bright lit path, so cx mirrors with it.
  const wideCx = best ? 1 - (best.x0 + best.x1) / 2 / aw : 0.665;
  const feetY = best ? best.y1 / ah : 0.89;
  const heightFrac = best ? (best.y1 - best.y0 + 1) / ah : 0.19;
  err(
    `\nblob anchor  ${best ? `${best.x1 - best.x0 + 1}x${best.y1 - best.y0 + 1} px, ${best.size} px area` : "NOT FOUND"}   ` +
      `wideCx ${wideCx.toFixed(3)} feetY ${feetY.toFixed(3)} heightFrac ${heightFrac.toFixed(3)}`,
  );
  if (best && (heightFrac <= 0.05 || heightFrac > 0.4)) {
    fail(`blob anchor: implausible height fraction ${heightFrac.toFixed(3)}`);
  }

  // ── The painted sky: aurora colours + firefly positions ──────────────────
  // Both are read from the ORIGINAL plate and reproduced live in CSS. Measured
  // at a working size — 1356x764 is ample for colour statistics and for dot
  // centroids expressed as fractions, and it keeps two full-size decodes out of
  // memory at once.
  const paintedSmall = await sharp(join(DESIGN, SRC.painted))
    .resize(1356, 764, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plateSmall = await sharp(join(DESIGN, SRC.plate))
    .resize(1356, 764, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const paintedRaw: Raw = {
    data: paintedSmall.data,
    w: paintedSmall.info.width,
    h: paintedSmall.info.height,
    c: paintedSmall.info.channels,
  };
  const plateRaw: Raw = {
    data: plateSmall.data,
    w: plateSmall.info.width,
    h: plateSmall.info.height,
    c: plateSmall.info.channels,
  };

  const aurora = measureAurora(paintedRaw, plateRaw);
  err(
    `\naurora      core ${aurora.core}  glow ${aurora.glow}  band y ${aurora.top}-${aurora.bottom}  ` +
      `(${aurora.coverage} sampled px)`,
  );

  const fireflies = measureFireflies(paintedRaw, plateRaw, aurora.top);
  err(`fireflies   ${fireflies.length} found`);
  {
    // A scatter map, so a diff that caught the aurora instead of the dots is
    // obvious rather than subtle — same reasoning as the blob's ASCII alpha map.
    const COLS = 60;
    const ROWS = 16;
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
    for (const f of fireflies) {
      const cx = Math.min(COLS - 1, Math.max(0, Math.round(f.x * (COLS - 1))));
      const cy = Math.min(ROWS - 1, Math.max(0, Math.round(f.y * (ROWS - 1))));
      grid[cy][cx] = grid[cy][cx] === " " ? "*" : "+";
    }
    err(grid.map((r) => "  " + r.join("")).join("\n"));
    err("  (flopped space — matches the shipped plate)");
  }
  if (fireflies.length < 4 || fireflies.length > 40) {
    fail(`fireflies: found ${fireflies.length}, expected 4-40 — the diff is catching the wrong thing`);
  }

  // ── The plate ────────────────────────────────────────────────────────────
  const plateMeta = await sharp(join(DESIGN, SRC.plate)).metadata();
  const wideAr = plateMeta.width! / plateMeta.height!;
  const TALL_AR = 0.75;

  const outputs: Array<{ file: string; bytes: number }> = [];
  const record = async (name: string, pipeline: ReturnType<typeof sharp>) => {
    const file = join(OUT_DIR, name);
    const info = await pipeline.toFile(file);
    outputs.push({ file: name, bytes: info.size });
  };

  for (const width of [1600, 2400]) {
    const base = () => sharp(join(DESIGN, SRC.plate)).flop().resize({ width, kernel: "lanczos3" });
    await record(`aurora-wide-${width}.avif`, base().avif({ quality: 66, effort: 7 }));
    await record(`aurora-wide-${width}.webp`, base().webp({ quality: 86, effort: 6 }));
  }

  // The tall crop is centred on the measured blob so the phone shows the path
  // and the character rather than 26% of a 16:9 frame.
  const cropH = plateMeta.height!;
  const cropW = Math.round(cropH * TALL_AR);
  const centre = Math.round(wideCx * plateMeta.width!);
  const left = Math.min(Math.max(0, centre - Math.round(cropW / 2)), plateMeta.width! - cropW);
  for (const width of [900, 1350]) {
    const base = () =>
      sharp(join(DESIGN, SRC.plate))
        .flop()
        .extract({ left, top: 0, width: cropW, height: cropH })
        .resize({ width, kernel: "lanczos3" });
    await record(`aurora-tall-${width}.avif`, base().avif({ quality: 60, effort: 7 }));
    await record(`aurora-tall-${width}.webp`, base().webp({ quality: 84, effort: 6 }));
  }

  const walkBytes = readFileSync(walkOut).length;
  outputs.unshift({ file: "blob-walk.webp", bytes: walkBytes });

  err("\noutputs");
  let total = 0;
  for (const o of outputs) {
    total += o.bytes;
    err(`  ${o.file.padEnd(26)} ${(o.bytes / 1024).toFixed(1).padStart(7)} KB`);
  }
  err(`  ${"TOTAL".padEnd(26)} ${(total / 1024).toFixed(1).padStart(7)} KB`);

  if (failures.length) {
    err("\nFAILED — nothing written to lib/heroAssets.ts:");
    for (const f of failures) err(`  · ${f}`);
    process.exit(1);
  }

  // ── The generated module ─────────────────────────────────────────────────
  process.stdout.write(`/**
 * GENERATED FILE — do not edit. Run \`npm run build:design\` to regenerate.
 *
 * Geometry measured from the source artwork, so the hero's CSS can never drift
 * from where the blob is actually painted on the plate. Every fraction below is
 * in FLOPPED plate space: the plate is mirrored at build time so the headline
 * gets the dark side of the frame instead of the bright lit path.
 *
 * Sources (bytes / FNV-1a checked at build time):
${Object.values(SRC)
  .map((f) => ` *   ${f}`)
  .join("\n")}
 */

/** Aspect ratios and the widths actually encoded, per art-directed variant. */
export const PLATE = {
  wide: { ar: ${wideAr.toFixed(5)}, widths: [1600, 2400] },
  tall: { ar: ${TALL_AR}, widths: [900, 1350] },
} as const;

/**
 * Where the blob sits on the plate, as fractions of the plate box.
 * \`feetY\` is the BOTTOM of the sprite — the contact point with the path.
 */
export const BLOB_ANCHOR = {
  wideCx: ${wideCx.toFixed(3)},
  /** The tall crop is centred on the blob, so it lands mid-frame by construction. */
  tallCx: 0.5,
  feetY: ${feetY.toFixed(3)},
  heightFrac: ${heightFrac.toFixed(3)},
} as const;

/** The walk cycle, packed as one horizontal sheet of equal cells. */
export const WALK = {
  src: "/hero/blob-walk.webp",
  frames: ${WALK_FRAMES},
  cellAr: ${cellAr.toFixed(3)},
  /** Held when the blob is standing still — the frame with both feet planted. */
  idleFrame: ${idleFrame},
} as const;

/**
 * The aurora's colours, sampled from the ORIGINAL painted plate.
 *
 * The shipped plate has an empty sky; components/hero/HeroSky.tsx paints the
 * curtains live so they drift. These are the real pigments rather than
 * hand-picked teals, which is the difference between matching the illustration
 * and merely being green.
 *
 * \`top\`/\`bottom\` are the fractions of plate height the painted aurora spanned —
 * the live layer masks itself to that band so it never washes over the treeline.
 */
export const AURORA = {
  /** A curtain's body. RAW measured delta — see the note above about dimness. */
  core: "${aurora.core}",
  /** Its bright spine. */
  glow: "${aurora.glow}",
  /** The brightest light the painting added anywhere; the ceiling to stay under. */
  peak: "${aurora.peak}",
  top: ${aurora.top},
  bottom: ${aurora.bottom},
} as const;

/**
 * Where the artist put the fireflies, recovered by differencing the painted
 * plate against the stripped one and keeping the small warm dots.
 *
 * Positions are fractions of the plate box in FLOPPED space, so they line up
 * with the shipped (mirrored) artwork. The live layer drifts each one around its
 * painted position rather than scattering them randomly.
 */
export const FIREFLIES = [
${fireflies.map((f) => `  { x: ${f.x}, y: ${f.y}, r: ${f.r} },`).join("\n")}
] as const;
`);

  err("\nOK\n");
}

main().catch((e) => {
  err(String(e?.stack ?? e));
  process.exit(1);
});
