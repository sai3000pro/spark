/**
 * Cuts the blob pose sheet in ../design/ into one web-ready sprite per pose,
 * facing each way, plus the two poses the app needs that the sheet does not
 * carry as a pair: asleep, and asking a question.
 *
 *   npm run build:sprites     # writes lib/blobSprites.ts, public/sprites/blob/*
 *
 * WHAT THE SOURCE IS. "Blob SpriteSheet No fireflies.png" is 2048x2048 of
 * opaque navy with sixteen painted poses on it. It is NOT a grid: the poses sit
 * on a ~481 px column pitch but their rows drift by up to 100 px, so slicing it
 * into 512 px cells cuts feet off. Every pose box here is FOUND by connected
 * components and then verified, never assumed.
 *
 * WHICH WAY EACH POSE FACES IS MEASURED, NOT ASSUMED. The sheet mixes facings:
 * the expression poses look left, most of the walking ones look right. So for
 * every pose the amber eye mass is weighed against the body's own centroid, and
 * THAT decides which of the two shipped facings is the artwork and which is the
 * flop. Assuming one direction for the sheet — which the sheet invites, since
 * the first row is uniform — silently ships half the set walking backwards.
 *
 * The eye mass is weighed over the body's own PIXELS, by component id. Its
 * bounding box will not do: the painted Zzz is the same amber as an eye and its
 * box reaches inside the body's, which reads the sleeping pose as looking hard
 * right and flips it.
 *
 * WHY THE CELL IS SYMMETRIC. Poses are registered on the body's own centre and
 * foot line, then composited into one cell that is as wide to the left of that
 * point as to the right. A cell built to the actual (asymmetric) extents would
 * put the registration point off-centre, and flopping it would shift the
 * character sideways — the sprite would jump every time the app changed facing.
 * Symmetry makes flop and registration the same operation.
 *
 * WHY GLYPHS ARE COMPOSITED SEPARATELY. The Zzz over the sleeping pose is
 * lettering. Flopping the cell would mirror it into three backwards z's. So
 * glyph accessories are lifted off the body layer, the BODY is flopped, and the
 * glyph is put back at the mirrored POSITION with its own pixels untouched. The
 * question mark is built the same way, which is what makes it a member of the
 * same set rather than an overlay bolted on in CSS.
 *
 * Like build-design-assets.ts this is NOT part of the Next build graph: nothing
 * under app/ or lib/ imports scripts/, every output is committed, and sharp
 * stays out of package.json (see that file's header for why).
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
  type Box,
  type Component,
  type Keyed,
  type Raw,
} from "./lib/key";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, "..", "..", "design");
const OUT_DIR = join(HERE, "..", "public", "sprites", "blob");
const PUBLIC_PREFIX = "/sprites/blob";

const SRC = "Blob SpriteSheet No fireflies.png";
/** Recorded so a changed source is caught instead of silently re-cut. */
const EXPECTED = { bytes: 3_116_097, w: 2048, h: 2048 };

const POSE_COUNT = 16;
/** Below this a component is paint noise, not an accessory. */
const MIN_COMPONENT = 120;
/** Margin around each pose's own bounds before keying, in source px. */
const REGION_PAD = 40;
/** Breathing room inside the shared cell, so nothing sits flush to an edge. */
const CELL_PAD = 16;
/** Never upscale the artwork: the cell ships at its own size, capped here. */
const MAX_OUT_W = 400;

/**
 * The sheet in reading order, named for what each pose reads as.
 *
 * `sheetIndex` is the position in that order, kept so any name here can be
 * checked against the source by eye. `drop` removes a pose from the output and
 * says why in the report — nothing is silently skipped.
 */
interface PoseSpec {
  name: string;
  note: string;
  drop?: string;
}

const POSES: PoseSpec[] = [
  { name: "idle", note: "eyes open, at rest" },
  { name: "smile", note: "half-lidded smile" },
  { name: "delight", note: "eyes closed, open smile" },
  { name: "surprised", note: "wide eyes, round mouth" },
  { name: "wave", note: "near arm raised" },
  { name: "sleep", note: "eyes closed, painted Zzz" },
  { name: "stand", note: "feet together, arms down" },
  { name: "step", note: "one foot forward" },
  { name: "walk-1", note: "near arm swung forward" },
  { name: "walk-2", note: "arm crossing the body" },
  { name: "walk-3", note: "arms tucked, stride open" },
  { name: "walk-4", note: "stride at its widest" },
  { name: "crouch", note: "low, both arms down" },
  { name: "hop", note: "mid-stride over a lit glow" },
  { name: "hover", note: "floating, glow beneath" },
  {
    name: "hover-2",
    note: "second floating pose",
    // A grey four-pointed star is painted across this pose's right foot and
    // glow. It is not part of the character, it is not warm enough to key out
    // with the rest of the accessories, and it overlaps the body — so removing
    // it would mean inpainting a foot. `hover` is the same pose, undamaged.
    drop: "a stray grey star artifact crosses the foot; `hover` is the clean twin",
  },
];

/**
 * The question mark, built from a pose that already reads as asking.
 *
 * Its geometry is derived from the sleeping pose's painted Zzz — same warm
 * colour, and a height set from the measured z's — so the two decals look like
 * they came out of the same hand.
 */
const QUESTION = {
  name: "question",
  from: "surprised",
  note: "asking — question mark decal over the surprised pose",
} as const;

/** Height of the "?" as a multiple of the median painted z. */
const QUESTION_SCALE = 2.2;

const err = (s: string) => process.stderr.write(s + "\n");
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

// ─────────────────────────────────────────────────────────────────────────────
// Finding the poses
// ─────────────────────────────────────────────────────────────────────────────

interface Blob {
  size: number;
  box: Box;
  cx: number;
  cy: number;
}

/**
 * Every painted object on the sheet, as connected components of "not the
 * background". Bodies and accessories come out of the same pass; which is which
 * is decided afterwards by size and position, not by a hand-typed table.
 */
function findObjects(img: Raw, bgY: number, bodyY: number): Blob[] {
  const { w, h } = img;
  const n = w * h;
  const span = Math.max(1, bodyY - bgY);
  const lit = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += img.c) {
    const a = (luma(img.data[p], img.data[p + 1], img.data[p + 2]) - bgY) / span;
    if (a >= 0.06) lit[i] = 1;
  }

  const seen = new Uint8Array(n);
  const out: Blob[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (!lit[seed] || seen[seed]) continue;
    let size = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    const q = [seed];
    seen[seed] = 1;
    while (q.length) {
      const i = q.pop()!;
      size++;
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
    if (size < MIN_COMPONENT) continue;
    out.push({ size, box: { x0, y0, x1, y1 }, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  return out;
}

/**
 * Reading order — but banded, not sorted by y.
 *
 * The rows drift: pose 13 sits 100 px higher than pose 15 beside it. Sorting on
 * y alone therefore interleaves rows and silently renames every pose. Grouping
 * by "within half a row pitch of the last row's top" and sorting inside the
 * band is what survives that drift.
 */
function readingOrder(bodies: Blob[], rowPitch: number): Blob[] {
  const byY = [...bodies].sort((a, b) => a.box.y0 - b.box.y0);
  const rows: Blob[][] = [];
  for (const b of byY) {
    const row = rows[rows.length - 1];
    if (row && b.box.y0 - row[0].box.y0 < rowPitch / 2) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}

// ─────────────────────────────────────────────────────────────────────────────
// The decals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The painted Zzz's colours, so the drawn "?" is the same pigment.
 *
 * Sampled from the glyph pixels themselves rather than picked: `fill` is the
 * median warm pixel, `light` the brightest, and the outline is the sheet's own
 * background, which is what the painted glyphs are rimmed with.
 */
function measureGlyphInk(img: Raw, box: Box) {
  const px: Array<[number, number, number]> = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * img.w + x) * img.c;
      const [R, G, B] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (R > 120 && R > B + 50) px.push([R, G, B]);
    }
  }
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const at = (p: number) => px[Math.min(px.length - 1, Math.floor(px.length * p))];
  const mid = at(0.5) ?? [249, 235, 136];
  const top = at(0.98) ?? [252, 245, 191];
  const low = at(0.08) ?? [214, 180, 90];
  return {
    fill: hex(mid[0], mid[1], mid[2]),
    light: hex(top[0], top[1], top[2]),
    deep: hex(low[0], low[1], low[2]),
    samples: px.length,
  };
}

/**
 * A question mark in the sheet's own hand.
 *
 * Stroked geometry with round caps rather than a font: the painted z's are
 * chunky and round-ended, and a <text> element would depend on whatever font
 * happens to be installed on the machine running the build.
 *
 * The navy under-stroke reproduces the rim the painted glyphs carry, kept
 * deliberately thin and part-transparent: on the night-scene background it is
 * invisible either way, but a heavy rim turns into a hard cartoon outline the
 * moment the sprite is put on a light surface, which the z's never do.
 */
function questionSvg(h: number, ink: { fill: string; light: string; deep: string }, rim: string): Buffer {
  const w = Math.round(h * 0.72);
  const hook = "M 22,42 C 22,10 78,8 78,40 C 78,62 50,64 50,88";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 100 140">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ink.light}"/>
      <stop offset="0.62" stop-color="${ink.fill}"/>
      <stop offset="1" stop-color="${ink.deep}"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="${rim}" stroke-width="29" stroke-linecap="round" opacity="0.6">
    <path d="${hook}"/>
  </g>
  <circle cx="50" cy="120" r="16.5" fill="${rim}" opacity="0.6"/>
  <g fill="none" stroke="url(#g)" stroke-width="24" stroke-linecap="round">
    <path d="${hook}"/>
  </g>
  <circle cx="50" cy="120" r="14" fill="url(#g)"/>
</svg>`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface Pose {
  spec: PoseSpec;
  sheetIndex: number;
  keyed: Keyed;
  /** Where the keyed region sits on the sheet. */
  origin: { x: number; y: number };
  /** The character alone, in region coordinates. */
  body: Box;
  /** Lettering that must not be mirrored: its components, ids and union box. */
  glyph: { ids: Set<number>; box: Box; parts: Component[] } | null;
  /** Registration: the body's horizontal centre and its foot line. */
  cx: number;
  baseline: number;
  /** Eye mass relative to the body's centroid: negative is looking left. */
  eyeOffset: number;
  /** The way this pose is PAINTED. The other facing is its flop. */
  facing: "left" | "right";
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const path = join(DESIGN, SRC);
  const buf = readFileSync(path);
  const meta = await sharp(buf).metadata();
  const drift =
    buf.length !== EXPECTED.bytes || meta.width !== EXPECTED.w || meta.height !== EXPECTED.h ? "  <-- DRIFT" : "";
  err("─".repeat(78));
  err(`${SRC.padEnd(34)} ${String(buf.length).padStart(9)} B  ${meta.width}x${meta.height}  ${fnv1a(buf)}${drift}`);
  err("─".repeat(78));
  if (drift) fail("the source sheet is not the one this script was written against");

  const sheet = await readRaw(path);
  const bg = measureBackground(sheet);
  const bodyY = measureBodyLuma(sheet);
  err(`\nsheet   bg ${hex(...bg.rgb)} luma ${bg.y.toFixed(1)}   body luma ${bodyY.toFixed(0)}`);

  // ── Split the sheet into poses and their accessories ───────────────────────
  const objects = findObjects(sheet, bg.y, bodyY).sort((a, b) => b.size - a.size);
  const bodies = objects.slice(0, POSE_COUNT);
  const extras = objects.slice(POSE_COUNT);
  const gap = bodies.length === POSE_COUNT && extras.length ? bodies[POSE_COUNT - 1].size / extras[0].size : Infinity;
  err(
    `objects ${objects.length} over ${MIN_COMPONENT} px   bodies ${bodies.length}   accessories ${extras.length}   ` +
      `size gap ${Number.isFinite(gap) ? gap.toFixed(1) + "x" : "n/a"}`,
  );
  if (bodies.length < POSE_COUNT) fail(`found ${bodies.length} poses, expected ${POSE_COUNT}`);
  // The smallest body is 60k px and the largest accessory 5k. A gap under 4x
  // would mean the two populations have merged and the split is arbitrary.
  if (gap < 4) fail(`bodies and accessories are only ${gap.toFixed(1)}x apart in size — the split is not clean`);

  const pitch = 2048 / 4;
  const ordered = readingOrder(bodies, pitch);
  if (ordered.length !== POSES.length) fail(`the name table has ${POSES.length} entries for ${ordered.length} poses`);

  // Each accessory belongs to whichever pose it sits nearest. They are painted
  // touching their own blob (the glow under the feet, the Zzz beside the head),
  // so anything further than a column pitch away is unexplained and worth a
  // failure rather than a guess.
  const owned: Blob[][] = ordered.map(() => []);
  for (const e of extras) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < ordered.length; i++) {
      const d = Math.hypot(e.cx - ordered[i].cx, e.cy - ordered[i].cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > pitch) fail(`an accessory at ${e.cx.toFixed(0)},${e.cy.toFixed(0)} is not near any pose`);
    else owned[best].push(e);
  }

  // ── Key every pose ─────────────────────────────────────────────────────────
  const poses: Pose[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const spec = POSES[i];
    const body = ordered[i];
    const all = [body, ...owned[i]];
    const rx = Math.max(0, Math.min(...all.map((o) => o.box.x0)) - REGION_PAD);
    const ry = Math.max(0, Math.min(...all.map((o) => o.box.y0)) - REGION_PAD);
    const rw = Math.min(sheet.w - rx, Math.max(...all.map((o) => o.box.x1)) + REGION_PAD - rx + 1);
    const rh = Math.min(sheet.h - ry, Math.max(...all.map((o) => o.box.y1)) + REGION_PAD - ry + 1);

    const keyed = keyRegion(sheet, rx, ry, rw, rh, bg, bodyY, { keep: "all", minComponent: MIN_COMPONENT });
    const main = keyed.mainBox;

    // Lettering versus light. Both accessory kinds are warm, so colour cannot
    // separate them — position can: the Zzz float above the head, the hover
    // glow and its sparks sit under the feet. The head's own top counts as
    // "not above", which is why the threshold is inside the body rather than at
    // its top edge.
    let glyph: { ids: Set<number>; box: Box; parts: Component[] } | null = null;
    for (const c of keyed.kept.slice(1)) {
      if (c.box.y1 >= main.y0 + (main.y1 - main.y0) * 0.35) continue;
      if (!glyph) glyph = { ids: new Set([c.id]), box: { ...c.box }, parts: [c] };
      else {
        glyph.ids.add(c.id);
        glyph.parts.push(c);
        glyph.box = {
          x0: Math.min(glyph.box.x0, c.box.x0),
          y0: Math.min(glyph.box.y0, c.box.y0),
          x1: Math.max(glyph.box.x1, c.box.x1),
          y1: Math.max(glyph.box.y1, c.box.y1),
        };
      }
    }

    // Registration and facing, both measured on the BODY'S OWN PIXELS — by
    // component id, not by bounding box. The eye mass is amber and mid-dark and
    // nothing else on the blob is, but the painted Zzz is exactly that colour
    // and its box reaches inside the body's, so a box-bounded scan reads the
    // sleeping pose as looking hard right.
    const mainId = keyed.kept[0].id;
    let sx = 0;
    let sn = 0;
    let ex = 0;
    let en = 0;
    for (let y = main.y0; y <= main.y1; y++) {
      for (let x = main.x0; x <= main.x1; x++) {
        const idx = y * keyed.w + x;
        if (keyed.labels[idx] !== mainId) continue;
        const p = idx * 4;
        if (keyed.rgba[p + 3] < 128) continue;
        sx += x;
        sn++;
        const [R, G, B] = [keyed.rgba[p], keyed.rgba[p + 1], keyed.rgba[p + 2]];
        if (R > 90 && R > B + 40 && luma(R, G, B) < 200) {
          ex += x;
          en++;
        }
      }
    }
    const bodyCx = sn ? sx / sn : (main.x0 + main.x1) / 2;
    const eyeOffset = en ? ex / en - bodyCx : NaN;
    if (en < 200) fail(`${spec.name}: only ${en} eye pixels — its facing cannot be measured`);

    poses.push({
      spec,
      sheetIndex: i,
      keyed,
      origin: { x: rx, y: ry },
      body: main,
      glyph,
      cx: (main.x0 + main.x1) / 2,
      baseline: main.y1,
      eyeOffset,
      // WHICH WAY THIS POSE IS PAINTED. The sheet mixes facings — the expression
      // poses look left, most of the walk poses look right — so this is measured
      // per pose and never assumed. The output always ships both facings; this
      // only decides which of the two is the flop.
      facing: eyeOffset < 0 ? "left" : "right",
    });
  }

  // ── Report and gate ────────────────────────────────────────────────────────
  for (const p of poses) {
    const k = p.keyed;
    const bw = p.body.x1 - p.body.x0 + 1;
    const bh = p.body.y1 - p.body.y0 + 1;
    err(
      `\n[${String(p.sheetIndex).padStart(2)}] ${p.spec.name.padEnd(10)} body ${bw}x${bh}   ` +
        `cov ${(k.coverage * 100).toFixed(1)}%   holes ${((k.holesFilled / Math.max(1, k.bodyPx)) * 100).toFixed(2)}%   ` +
        `edge luma ${k.meanEdgeLuma.toFixed(0)}   eyes ${p.eyeOffset > 0 ? "+" : ""}${p.eyeOffset.toFixed(0)} px ` +
        `-> painted ${p.facing}   ` +
        `kept ${k.kept.length}${p.glyph ? " (lettering)" : ""}${p.spec.drop ? "   DROPPED" : ""}`,
    );
    err(alphaMap(k, 46, 15));
    if (p.spec.drop) {
      err(`  dropped: ${p.spec.drop}`);
      continue;
    }
    if (k.coverage < 0.08 || k.coverage > 0.5) fail(`${p.spec.name}: coverage ${(k.coverage * 100).toFixed(1)}% outside 8-50%`);
    if (k.holesFilled / Math.max(1, k.bodyPx) > 0.08) fail(`${p.spec.name}: filled >8% of body — the key is eating the blob`);
    if (k.meanEdgeLuma < 180) fail(`${p.spec.name}: mean edge luma ${k.meanEdgeLuma.toFixed(0)} < 180 — halo`);
  }

  const shipped = poses.filter((p) => !p.spec.drop);
  const sleeper = shipped.find((p) => p.glyph);
  if (!sleeper) fail("no pose carries lettering — the painted Zzz was expected on `sleep`");
  if (sleeper && sleeper.spec.name !== "sleep") fail(`lettering found on \`${sleeper.spec.name}\`, expected \`sleep\``);
  if (shipped.filter((p) => p.glyph).length > 1) fail("more than one pose carries lettering — the name table is out of step");

  // ── The question mark's ink and size ───────────────────────────────────────
  // Measured before the cell is sized, because the "?" is drawn OUTSIDE the
  // body and the cell has to be built with room for it. Sizing the cell to the
  // painted poses first and discovering afterwards that the decal overflows is
  // how the mark ends up clipped at the top of one sprite in the set.
  //
  // The glyph box is in region coordinates and measureGlyphInk reads the sheet,
  // so it is shifted back by the region's origin before sampling.
  const zBox = sleeper?.glyph?.box ?? null;
  const ink =
    sleeper && zBox
      ? measureGlyphInk(sheet, {
          x0: zBox.x0 + sleeper.origin.x,
          y0: zBox.y0 + sleeper.origin.y,
          x1: zBox.x1 + sleeper.origin.x,
          y1: zBox.y1 + sleeper.origin.y,
        })
      : null;
  // One z, not the whole cluster: the "?" is a single glyph and has to be sized
  // against a single glyph or it comes out three times too big.
  const zHeights = (sleeper?.glyph?.parts ?? []).map((c) => c.box.y1 - c.box.y0 + 1).sort((a, b) => a - b);
  const zH = zHeights.length ? zHeights[zHeights.length >> 1] : 0;
  err(
    `\nglyph ink   ${ink ? `${ink.fill} / ${ink.light} / ${ink.deep} from ${ink.samples} px` : "n/a"}   ` +
      `${zHeights.length} z's, median ${zH} px tall`,
  );

  const base = shipped.find((p) => p.spec.name === QUESTION.from);
  if (!base) {
    fail(`the question pose is built from \`${QUESTION.from}\`, which is not in the sheet`);
    err("\nFAILED — nothing written:");
    for (const f of failures) err(`  · ${f}`);
    process.exit(1);
  }

  const qH = Math.max(24, Math.round(zH * QUESTION_SCALE));
  const qPng = await sharp(
    questionSvg(qH, ink ?? { fill: "#f9eb88", light: "#fcf5c3", deep: "#d6b45a" }, hex(...bg.rgb)),
  )
    .png()
    .toBuffer();
  const qMeta = await sharp(qPng).metadata();
  const qBodyW = base.body.x1 - base.body.x0 + 1;
  const qBodyH = base.body.y1 - base.body.y0 + 1;
  /** Clear of the head, on the side the blob is facing, in left-facing space. */
  const qDx = qBodyW * 0.22;
  const qGap = qBodyH * 0.06;
  /** How far above the base pose's foot line the mark's top sits. */
  const qUp = base.baseline - base.body.y0 + qGap + qMeta.height!;
  err(
    `\nquestion    "?" ${qMeta.width}x${qMeta.height} px (${QUESTION_SCALE}x the ${zH} px z)   ` +
      `${qDx.toFixed(0)} px off centre, ${qGap.toFixed(0)} px clear of the head, over \`${QUESTION.from}\``,
  );

  // ── The shared cell ────────────────────────────────────────────────────────
  // Extents are measured from the registration point, then made symmetric so a
  // flop is a no-op on registration. `up`/`down` include the accessories: the
  // hover glow lives below the foot line and would otherwise be clipped, and
  // the question mark reaches higher than any painted pose does.
  let side = qDx + qMeta.width! / 2;
  let up = qUp;
  let down = 0;
  for (const p of shipped) {
    side = Math.max(side, p.cx - p.keyed.bbox.x0, p.keyed.bbox.x1 - p.cx);
    up = Math.max(up, p.baseline - p.keyed.bbox.y0);
    down = Math.max(down, p.keyed.bbox.y1 - p.baseline);
  }
  const cellW = Math.round(side + CELL_PAD) * 2;
  const cellH = Math.round(up + down) + CELL_PAD * 2;
  const cellCx = cellW / 2;
  const cellBaseline = Math.round(up) + CELL_PAD;
  const outW = Math.min(MAX_OUT_W, cellW);
  const outH = Math.round((cellH * outW) / cellW);
  err(
    `\ncell ${cellW}x${cellH} -> ${outW}x${outH}   aspect ${(cellW / cellH).toFixed(3)}   ` +
      `foot line at ${(cellBaseline / cellH).toFixed(3)} of height`,
  );

  if (failures.length) {
    err("\nFAILED — nothing written:");
    for (const f of failures) err(`  · ${f}`);
    process.exit(1);
  }

  // ── Compose ────────────────────────────────────────────────────────────────
  const outputs: Array<{ file: string; bytes: number }> = [];

  /** One pose as a cell-sized RGBA PNG: body registered, lettering lifted off. */
  const bodyCell = async (p: Pose) => {
    const rgba = Buffer.from(p.keyed.rgba);
    // Per pixel, not per box: the Zzz's bounding box overlaps the blob's, and
    // clearing the box would take a bite out of the top of its head.
    if (p.glyph) {
      for (let i = 0; i < p.keyed.labels.length; i++) {
        if (p.glyph.ids.has(p.keyed.labels[i])) rgba[i * 4 + 3] = 0;
      }
    }
    // Cropped to its own content first: the keyed region carries REGION_PAD of
    // empty margin on every side and can be wider than the cell, which sharp
    // refuses to composite.
    const b = p.keyed.bbox;
    const layer = await sharp(rgba, { raw: { width: p.keyed.w, height: p.keyed.h, channels: 4 } })
      .extract({ left: b.x0, top: b.y0, width: b.x1 - b.x0 + 1, height: b.y1 - b.y0 + 1 })
      .png()
      .toBuffer();
    return sharp({
      create: { width: cellW, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: layer,
          left: Math.round(cellCx - (p.cx - b.x0)),
          top: Math.round(cellBaseline - (p.baseline - b.y0)),
        },
      ])
      .png()
      .toBuffer();
  };

  /** The lettering alone, as a PNG plus its box in cell coordinates. */
  const glyphLayer = async (p: Pose) => {
    if (!p.glyph) return null;
    const g = p.glyph.box;
    const w = g.x1 - g.x0 + 1;
    const h = g.y1 - g.y0 + 1;
    const rgba = Buffer.from(p.keyed.rgba);
    for (let i = 0; i < p.keyed.labels.length; i++) {
      if (!p.glyph.ids.has(p.keyed.labels[i])) rgba[i * 4 + 3] = 0;
    }
    const png = await sharp(rgba, { raw: { width: p.keyed.w, height: p.keyed.h, channels: 4 } })
      .extract({ left: g.x0, top: g.y0, width: w, height: h })
      .png()
      .toBuffer();
    const left = Math.round(cellCx - p.cx) + g.x0;
    const top = Math.round(cellBaseline - p.baseline) + g.y0;
    // Decal positions are all held in LEFT-facing output space, so a pose that
    // happens to be painted facing right has its lettering mirrored into that
    // space here — once — instead of at every use.
    return { png, w, h, left: p.facing === "left" ? left : cellW - left - w, top };
  };

  interface Decal {
    png: Buffer;
    w: number;
    h: number;
    left: number;
    top: number;
  }

  /**
   * Mirror a decal's POSITION without mirroring the decal. This is the whole
   * reason lettering is composited after the flop instead of before it.
   */
  const mirrored = (d: Decal) => ({ ...d, left: cellW - d.left - d.w });

  const write = async (
    name: string,
    facing: "left" | "right",
    /** The way the cell's artwork is painted — the flop is what differs. */
    source: "left" | "right",
    cell: Buffer,
    /** Positioned in left-facing output space; mirrored here when needed. */
    decal: Decal | null,
  ) => {
    const oriented = facing === source ? cell : await sharp(cell).flop().png().toBuffer();
    const placed = decal ? (facing === "left" ? decal : mirrored(decal)) : null;
    const composed = placed
      ? await sharp(oriented)
          .composite([{ input: placed.png, left: placed.left, top: placed.top }])
          .png()
          .toBuffer()
      : oriented;
    const file = `${name}-${facing}.webp`;
    const info = await sharp(composed)
      .resize(outW, outH, { fit: "fill", kernel: "lanczos3" })
      // The eyes are two 30 px amber discs on a white body and they are the
      // whole face. At the walk sheet's quality 78 they posterise into blocks
      // and the chroma bleeds green over the highlight; `smartSubsample` and a
      // higher quality cost about 7% in bytes and fix both. These sprites are
      // 16-20 KB each — the wrong place to economise.
      .webp({ quality: 94, alphaQuality: 92, smartSubsample: true, effort: 6 })
      .toFile(join(OUT_DIR, file));
    outputs.push({ file, bytes: info.size });
  };

  for (const p of shipped) {
    const cell = await bodyCell(p);
    const decal = await glyphLayer(p);
    await write(p.spec.name, "left", p.facing, cell, decal);
    await write(p.spec.name, "right", p.facing, cell, decal);
  }

  // The asking pose. The mark sits clear of the head on the side the blob is
  // facing — to its left in left-facing space, and it mirrors with the body.
  const qCellLeft = Math.round(cellCx - qDx - qMeta.width! / 2);
  const qCellTop = cellBaseline - Math.round(qUp);
  err(`\nquestion    "?" placed at ${qCellLeft},${qCellTop} in the cell`);
  if (qCellTop < 0 || qCellLeft < 0) fail("the question mark does not fit inside the cell");
  else {
    const cell = await bodyCell(base);
    const decal: Decal = { png: qPng, w: qMeta.width!, h: qMeta.height!, left: qCellLeft, top: qCellTop };
    await write(QUESTION.name, "left", base.facing, cell, decal);
    await write(QUESTION.name, "right", base.facing, cell, decal);
  }

  err("\noutputs");
  let total = 0;
  for (const o of outputs) {
    total += o.bytes;
    err(`  ${o.file.padEnd(24)} ${(o.bytes / 1024).toFixed(1).padStart(7)} KB`);
  }
  err(`  ${"TOTAL".padEnd(24)} ${(total / 1024).toFixed(1).padStart(7)} KB   ${outputs.length} files`);

  if (failures.length) {
    err("\nFAILED — nothing written to lib/blobSprites.ts:");
    for (const f of failures) err(`  · ${f}`);
    process.exit(1);
  }

  // ── The generated module ───────────────────────────────────────────────────
  const listed = [
    ...shipped.map((p) => ({
      name: p.spec.name,
      note: p.spec.note,
      sheetIndex: p.sheetIndex,
      glyph: !!p.glyph,
      painted: p.facing,
    })),
    { name: QUESTION.name, note: QUESTION.note, sheetIndex: base!.sheetIndex, glyph: true, painted: base!.facing },
  ];

  process.stdout.write(`/**
 * GENERATED FILE — do not edit. Run \`npm run build:sprites\` to regenerate.
 *
 * The blob's poses, cut from "${SRC}" and keyed
 * off its navy field. Every pose ships facing both ways. The sheet itself mixes
 * facings, so which file is the artwork and which is its flop varies by pose —
 * \`paintedFacing\` below records which, and nothing else needs to care.
 *
 * All poses share ONE cell and one registration point — the body's horizontal
 * centre and its foot line — so swapping pose or facing never moves the
 * character. Draw a sprite at \`cellAr\` and put \`footY\` of its height on the
 * ground and it will stand where every other pose stands.
 */

export type BlobFacing = "left" | "right";

export type BlobPose =
${listed.map((p) => `  | "${p.name}"`).join("\n")};

/** Geometry shared by every sprite in the set. */
export const BLOB_SPRITE = {
  dir: "${PUBLIC_PREFIX}",
  width: ${outW},
  height: ${outH},
  cellAr: ${(cellW / cellH).toFixed(3)},
  /** Fraction of the cell's height at which the feet touch the ground. */
  footY: ${(cellBaseline / cellH).toFixed(3)},
} as const;

/**
 * What each pose is, and where it came from.
 *
 * \`sheetIndex\` is the pose's position in the source sheet's reading order.
 * \`glyph\` marks a pose carrying lettering (the Zzz, the question mark) — that
 * lettering is composited after the flop, so it reads the right way round in
 * both facings and must never be mirrored by CSS.
 */
export const BLOB_POSES = {
${listed
  .map(
    (p) =>
      `  "${p.name}": { note: "${p.note}", sheetIndex: ${p.sheetIndex}, paintedFacing: "${p.painted}", glyph: ${p.glyph} },`,
  )
  .join("\n")}
} as const;

/** The URL of one pose. Poses face left unless asked otherwise. */
export const blobSprite = (pose: BlobPose, facing: BlobFacing = "left") =>
  \`${PUBLIC_PREFIX}/\${pose}-\${facing}.webp\`;
`);

  err("\nOK\n");
}

main().catch((e) => {
  err(String(e?.stack ?? e));
  process.exit(1);
});
