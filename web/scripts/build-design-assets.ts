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
 * The key itself — the linear alpha solve that replaces a luminance threshold —
 * lives in lib/key.ts, which build-blob-sprites.ts shares. The report below
 * prints its mean recovered edge luminance so a regression there is visible
 * rather than subtle.
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
import {
  alphaMap,
  fnv1a,
  hex,
  keyRegion,
  luma,
  measureBackground,
  measureBodyLuma,
  readRaw,
  type Keyed,
  type Raw,
} from "./lib/key";

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

const err = (s: string) => process.stderr.write(s + "\n");

// ─────────────────────────────────────────────────────────────────────────────
// Measuring the painted sky
//
// The aurora and the fireflies now live in CSS. These two functions read what
// the artist actually painted so the live versions reproduce it rather than
// approximating it with hand-picked teals and random scatter.
// ─────────────────────────────────────────────────────────────────────────────

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
  const walk = await readRaw(join(DESIGN, SRC.walk));
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
