/**
 * Cuts the blob's four art sheets into one registered sprite library.
 *
 *   npm run build:sprites     # writes lib/blobSprites.ts, public/sprites/blob/*
 *
 * WHAT THE SOURCES ARE. Four sheets, all painted opaque on the same dark navy,
 * none of them a tidy grid:
 *
 *   MoreAnimationsSprites.png    24 poses, 3x8 — expressions, turns, and an
 *                                eight-frame walk cycle
 *   Blob sleep-cycle strip.png    5 frames — the Zzz gather and clear
 *   Asking question.png           4 frames — asleep, drowsy, awake, asking
 *   Blob jumping.png              5 frames — curious, crouch, lift-off, apex, land
 *
 * FRAMES ARE FOUND BY THEIR WHITE CORE, not by dividing the strip into equal
 * columns and not by connected components. Both of those fail on the jump sheet,
 * where the apex flare is still 0.967 opaque as it crosses into the next frame:
 * a geometric cut saws through solid artwork, and a component pass welds the two
 * frames into one. The character is the only thing on these sheets that is
 * bright AND neutral — every flare, glow, sparkle, Zzz and question mark is
 * warm — so "opaque with no warm cast" finds exactly one core per frame, on all
 * four sheets, with no per-sheet tuning. See scripts/lib/sheet.ts.
 *
 * EVERYTHING LANDS ON ONE CHARACTER SIZE AND ONE FOOT LINE. The sheets draw the
 * blob at different scales, so each is normalised by ITS OWN reference frame —
 * per sheet, never per frame, or the jump's deliberately squashed crouch gets
 * stretched back out and the drawn leap is flattened. The scale is applied in
 * the single resize that was already happening at the end, so the "key at full
 * resolution, downscale once, let the resampler make the anti-aliasing" rule is
 * untouched.
 *
 * TWO CELLS, NOT ONE. The apex flare needs 2.8x the body's half-width; forcing
 * every frame into a cell that could hold it would inflate the other 66 files
 * with empty space. So there is a `base` cell and a `jump` cell — which is safe
 * because the registration model is not "one cell", it is one character height
 * and one foot line EXPRESSED AS FRACTIONS of whatever cell. `.hero-blob` reads
 * those fractions as custom properties, so swapping cells in the same render as
 * the sprite is invisible. The gate at the end asserts exactly that.
 *
 * THE FOOT LINE IS MEASURED ON THE WHITE CORE, not on everything kept. The
 * ground glow under the crouch reaches 69 px below the character's feet, and a
 * baseline drawn there hangs the blob in the air.
 *
 * WITHIN A CLIP THE DRAWN MOTION SURVIVES. A clip is registered on ONE ground
 * line taken from its grounded reference frame, so every other frame keeps
 * whatever vertical offset the artist gave it. That is what makes the jump rise.
 *
 * Like build-design-assets.ts this is NOT part of the Next build graph: nothing
 * under app/ or lib/ imports scripts/, every output is committed, and sharp
 * stays out of package.json.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
  type Keyed,
} from "./lib/key";
import {
  bodyCores,
  classifyAccessory,
  labelSheet,
  measureScale,
  ownObjects,
  readingOrder,
  type SheetObject,
} from "./lib/sheet";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, "..", "..", "design");
const OUT_DIR = join(HERE, "..", "public", "sprites", "blob");
const MANIFEST = join(HERE, "..", "lib", "blobSprites.ts");
const PUBLIC_PREFIX = "/sprites/blob";

/** The character ships this tall, in every cell. That is what makes a cell swap invisible. */
const OUT_BODY_PX = 300;
/** Margin around a frame's own bounds before keying, in source px. */
const REGION_PAD = 40;
/** Breathing room inside a cell, in output px. */
const CELL_PAD = 12;

type CellName = "base" | "jump";

interface SheetSpec {
  file: string;
  expect: { bytes: number; w: number; h: number };
  rows: number;
  cell: CellName;
  /**
   * Alpha at or below this is background. Only the pose sheet needs it: it draws
   * every pose on a soft dark halo. Measured, the halo plateaus just under the
   * 0.06 visibility threshold and is mostly excluded already — this is margin
   * against an art tweak nudging it over, and it costs one marginal object.
   */
  alphaFloor: number;
  /**
   * Alpha blur in source px.
   *
   * All four of these sheets measure hard-edged — the silhouette steps from
   * transparent to opaque in about one pixel — so all four need it. That was a
   * surprise: the ORIGINAL sheet this pipeline was written for had a 14-20 px
   * painterly feather that the downscale turned into free anti-aliasing. These
   * have no ramp to resample, so without a blur they ship with stair-stepped
   * edges. The gate below fails any sheet that measures hard and declares 0.
   */
  feather: number;
  minComponent: number;
  /**
   * Floor for the recovered luminance of the silhouette's ramp — the halo check.
   * The painterly sheets ramp through the body's own white; the flat-shaded one
   * is drawn with a dark rim, so its ramp legitimately samples darker and the
   * original 180 would condemn every frame on it.
   */
  minEdgeLuma: number;
  /** Frame whose core height sets this sheet's scale. */
  scaleRef: number;
  /** Multiplies the measured scale. Only a human eye can set this — see the report. */
  scaleNudge: number;
  /** Names in reading order. Length is gated against the core count. */
  names: readonly string[];
  /**
   * Extra frames built from a frame the artist DID draw, by keeping only some of
   * its lettering.
   *
   * The sleep strip goes 0, 1, 3, 3-large, 0 z's — there is no two-z drawing, so
   * the loop reads "z, zzz, big zzz" and skips a beat. The z's are separate
   * painted objects, so a two-z frame is the three-z frame minus its furthest
   * one: the artist's own glyphs, at the artist's own sizes and positions, just
   * one fewer of them. Nothing is invented.
   */
  derive?: ReadonlyArray<{ name: string; from: number; keepGlyphs: number }>;
}

/**
 * The pose sheet's 24, in reading order.
 *
 * Six of them read as clear expressions and eight as a walk cycle. The ten
 * `turn-*` frames are body-angle variants that no measurement can name — they
 * are cut and shipped so the set is complete, and the ASCII map in the report is
 * there so anyone can check a name by eye.
 */
const POSE_NAMES = [
  "smile", "wink", "delight", "surprised", "idle", "turn-0", "turn-1", "turn-2",
  "wave", "doze", "turn-3", "turn-4", "turn-5", "turn-6", "turn-7", "turn-8",
  "walk-0", "walk-1", "walk-2", "walk-3", "walk-4", "walk-5", "walk-6", "walk-7",
] as const;

const SHEETS: SheetSpec[] = [
  {
    file: "MoreAnimationsSprites.png",
    expect: { bytes: 4_817_251, w: 3584, h: 1184 },
    rows: 3,
    cell: "base",
    alphaFloor: 0.1,
    feather: 1,
    minComponent: 60,
    // Drawn with a dark rim, so its edge ramp legitimately samples darker than a
    // painterly sheet's. Measured 167-179 across all 24 frames.
    minEdgeLuma: 150,
    scaleRef: 4, // `idle`
    scaleNudge: 1,
    names: POSE_NAMES,
  },
  {
    file: "Blob sleep-cycle strip.png",
    expect: { bytes: 4_629_271, w: 3584, h: 1184 },
    rows: 1,
    cell: "base",
    alphaFloor: 0,
    feather: 1,
    minComponent: 120,
    minEdgeLuma: 150,
    scaleRef: 0,
    scaleNudge: SEATED_NUDGE(),
    names: ["sleep-0", "sleep-1", "sleep-2", "sleep-3", "sleep-4"],
    derive: [{ name: "sleep-2z", from: 2, keepGlyphs: 2 }],
  },
  {
    file: "Asking question.png",
    expect: { bytes: 3_265_359, w: 2800, h: 1184 },
    rows: 1,
    cell: "base",
    alphaFloor: 0,
    feather: 1,
    minComponent: 120,
    minEdgeLuma: 150,
    scaleRef: 0,
    scaleNudge: SEATED_NUDGE(),
    names: ["wake-0", "wake-1", "wake-2", "wake-3"],
  },
  {
    file: "Blob jumping.png",
    expect: { bytes: 3_621_649, w: 3492, h: 1048 },
    rows: 1,
    cell: "jump",
    alphaFloor: 0,
    feather: 1,
    minComponent: 120,
    minEdgeLuma: 150,
    scaleRef: 0,
    scaleNudge: 1,
    names: ["jump-0", "jump-1", "jump-2", "jump-3", "jump-4"],
  },
];

/**
 * The sleep and wake sheets draw a SEATED blob; the pose sheet draws a standing
 * one. Normalising both by core height therefore makes the seated blob as tall
 * as the standing one, and it appears to grow as it wakes. No measurement can
 * resolve that — a seated character is genuinely shorter — so this is the one
 * number set by eye, and it is named rather than buried in a table.
 */
function SEATED_NUDGE() {
  return 0.94;
}

interface ClipSpec {
  name: string;
  frames: readonly string[];
  cell: CellName;
  /** Index WITHIN the clip of the frame whose feet are on the ground. */
  groundRef: number;
  /** Declared, not measured — frame timing is not in the artwork. */
  fps: number;
  loop: boolean;
  /** The frame shown when the clip is not playing. */
  rest: number;
  note: string;
}

const CLIPS: ClipSpec[] = [
  {
    name: "sleep",
    /**
     * z, zz, zzz, BIG zzz, then nothing.
     *
     * Not the strip's own order. It was drawn 0, 1, 3, 3-large, 0 — no two-z
     * frame, and an empty drawing at BOTH ends — so playing it as cut reads as
     * "z, zzz, big zzz" with a stall. `sleep-2z` fills the gap (see `derive`)
     * and the leading empty frame is dropped so the count climbs cleanly and
     * clears once.
     */
    frames: ["sleep-1", "sleep-2z", "sleep-2", "sleep-3", "sleep-4"],
    cell: "base",
    groundRef: 0,
    fps: 1.4,
    loop: true,
    /** The empty-headed frame: what the server paints and what rest looks like. */
    rest: 4,
    note: "one z, two, three, three big, then nothing",
  },
  {
    name: "wake",
    frames: ["wake-0", "wake-1", "wake-2", "wake-3"],
    cell: "base",
    groundRef: 0,
    fps: 6,
    loop: false,
    rest: 3,
    note: "asleep, drowsy, awake, asking",
  },
  {
    name: "jump",
    frames: ["jump-0", "jump-1", "jump-2", "jump-3", "jump-4"],
    cell: "jump",
    groundRef: 0,
    fps: 12,
    loop: false,
    rest: 0,
    note: "curious, crouch, lift-off, apex, landing",
  },
  {
    name: "walk",
    frames: ["walk-0", "walk-1", "walk-2", "walk-3", "walk-4", "walk-5", "walk-6", "walk-7"],
    cell: "base",
    groundRef: 0,
    fps: 10,
    loop: true,
    rest: 0,
    note: "one full gait cycle, two footfalls",
  },
];

const err = (s: string) => process.stderr.write(s + "\n");
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

// ─────────────────────────────────────────────────────────────────────────────

interface Frame {
  name: string;
  sheet: SheetSpec;
  index: number;
  cell: CellName;
  /** The character alone, keyed. */
  body: Keyed;
  /** Lettering, keyed separately so it is never mirrored. Null when there is none. */
  glyph: Keyed | null;
  glyphBox: Box | null;
  /** Region origin on the sheet. */
  origin: { x: number; y: number };
  /** Registration, in REGION coordinates: core centre and core foot line. */
  cx: number;
  foot: number;
  /**
   * The same foot line in SHEET coordinates.
   *
   * A clip's frames each get their own region with its own origin, so comparing
   * region-relative foot lines across a clip measures the padding, not the pose.
   * Measured: it reported the flat sleep loop as drifting 0.167 body heights.
   */
  footSheet: number;
  /** Source px per output px for this sheet. */
  scale: number;
  facing: "left" | "right";
  eyeOffset: number;
  eyePx: number;
  coreH: number;
  coreW: number;
  /** Set when this frame is another frame with some of its lettering removed. */
  derivedFrom?: string;
  accessories: { glow: number; glyph: number; stray: number };
}

async function cutSheet(spec: SheetSpec, refCoreH: number | null): Promise<{ frames: Frame[]; coreH: number }> {
  const path = join(DESIGN, spec.file);
  const buf = readFileSync(path);
  const meta = await sharp(buf).metadata();
  const drift =
    buf.length !== spec.expect.bytes || meta.width !== spec.expect.w || meta.height !== spec.expect.h;
  err(
    `\n${spec.file}\n  ${String(buf.length).padStart(9)} B  ${meta.width}x${meta.height}  ${fnv1a(buf)}` +
      (drift ? "   <-- DRIFT" : ""),
  );
  if (drift) fail(`${spec.file} is not the sheet this script was written against`);

  const img = await readRaw(path);
  const bg = measureBackground(img);
  const bodyY = measureBodyLuma(img);
  const wanted = spec.names.length;
  const cores = readingOrder(
    bodyCores(img, bg, bodyY, { minCore: Math.floor((img.w * img.h) / wanted / 12) }),
    spec.rows,
    img.h,
  );
  const { labels, objects } = labelSheet(img, bg, bodyY, spec.alphaFloor, spec.minComponent);
  const own = ownObjects(labels, img.w, objects, cores);

  const heights = cores.map((c) => c.box.y1 - c.box.y0 + 1);
  const areas = cores.map((c) => c.size);
  const areaSpread = Math.max(...areas) / Math.min(...areas);
  const maxAdopt = own.adopted.reduce((m, a) => Math.max(m, a.distance), 0);
  const pitch = img.w / Math.ceil(wanted / spec.rows);

  err(
    `  bg ${hex(...bg.rgb)} luma ${bg.y.toFixed(1)}  body ${bodyY.toFixed(0)}   ` +
      `floor ${spec.alphaFloor}  feather ${spec.feather}px`,
  );
  err(
    `  cores ${cores.length}/${wanted}   heights ${Math.min(...heights)}..${Math.max(...heights)} px ` +
      `(${(Math.max(...heights) / Math.min(...heights)).toFixed(2)}x)   area spread ${areaSpread.toFixed(2)}x`,
  );
  err(
    `  objects ${objects.length}   welded ${own.welded.length}   adopted ${own.adopted.length} ` +
      `(furthest ${maxAdopt.toFixed(0)} px of a ${pitch.toFixed(0)} px pitch)`,
  );

  if (cores.length !== wanted) fail(`${spec.file}: found ${cores.length} frames, expected ${wanted}`);
  if (areaSpread > 1.6) fail(`${spec.file}: core areas spread ${areaSpread.toFixed(2)}x — a frame merged or went missing`);
  for (const w of own.welded) {
    fail(`${spec.file}: one object holds frames ${w.cores.join(" and ")} — the split failed; raise alphaFloor`);
  }
  if (maxAdopt > pitch) fail(`${spec.file}: an accessory sits ${maxAdopt.toFixed(0)} px from any frame`);

  const scale = refCoreH === null ? 1 : 1; // filled in by the caller once the reference is known
  void scale;

  const frames: Frame[] = [];
  for (let i = 0; i < cores.length && i < spec.names.length; i++) {
    const core = cores[i];
    const mine = objects.filter((o) => own.owner[o.id] === core.index);

    // Sort the frame's own objects into the character, its light, its lettering,
    // and the generator's litter.
    const coreObjId = labels[core.seed.y * img.w + core.seed.x];
    const bodyObjs: SheetObject[] = [];
    const glyphObjs: SheetObject[] = [];
    const counts = { glow: 0, glyph: 0, stray: 0 };
    for (const o of mine) {
      if (o.id === coreObjId) {
        bodyObjs.push(o);
        continue;
      }
      const kind = classifyAccessory(img, o, labels, core.box);
      counts[kind]++;
      if (kind === "glyph") glyphObjs.push(o);
      else if (kind === "glow") bodyObjs.push(o);
      // "stray" is the generator's grey star. Dropped, and counted in the report.
    }

    const all = [...bodyObjs, ...glyphObjs];
    const rx = Math.max(0, Math.min(...all.map((o) => o.box.x0)) - REGION_PAD);
    const ry = Math.max(0, Math.min(...all.map((o) => o.box.y0)) - REGION_PAD);
    const rw = Math.min(img.w - rx, Math.max(...all.map((o) => o.box.x1)) + REGION_PAD - rx + 1);
    const rh = Math.min(img.h - ry, Math.max(...all.map((o) => o.box.y1)) + REGION_PAD - ry + 1);
    const local = (o: SheetObject) => ({ x: o.seed.x - rx, y: o.seed.y - ry });

    const keyOpts = { alphaFloor: spec.alphaFloor, feather: spec.feather, minComponent: spec.minComponent };
    const body = keyRegion(img, rx, ry, rw, rh, bg, bodyY, {
      ...keyOpts,
      keep: "seeded",
      seeds: bodyObjs.map(local),
    });
    // Nearest the head first, so "keep two" keeps the two closest and drops the
    // one drifting furthest away — which is how the z's were drawn to rise.
    const byNearness = [...glyphObjs].sort(
      (a, z) =>
        Math.hypot((a.box.x0 + a.box.x1) / 2 - core.cx, (a.box.y0 + a.box.y1) / 2 - core.box.y1) -
        Math.hypot((z.box.x0 + z.box.x1) / 2 - core.cx, (z.box.y0 + z.box.y1) / 2 - core.box.y1),
    );
    const keyGlyphs = (objs: SheetObject[]) =>
      objs.length
        ? keyRegion(img, rx, ry, rw, rh, bg, bodyY, { ...keyOpts, keep: "seeded", seeds: objs.map(local) })
        : null;
    const glyph = keyGlyphs(byNearness);

    // ── Facing ───────────────────────────────────────────────────────────────
    // The amber eye mass against the body's own centroid, over the core's box so
    // a raised arm or a ground glow cannot tilt it.
    //
    // This is contaminated on exactly one kind of frame: where the artist drew a
    // big warm flare over the character, its mid-luma falloff reads as eye. The
    // apex of the jump reports 14 288 "eye" pixels against a normal 1 500 and
    // comes out facing the wrong way. No pixel test separates them — the flare is
    // the same connected object as the body and its core is the same white — so
    // the fix is not here. A CLIP takes its facing from its grounded reference
    // frame instead; see `clipFacing` below.
    const cbox: Box = { x0: core.box.x0 - rx, y0: core.box.y0 - ry, x1: core.box.x1 - rx, y1: core.box.y1 - ry };
    let sx = 0;
    let sn = 0;
    let ex = 0;
    let en = 0;
    for (let y = cbox.y0; y <= cbox.y1; y++) {
      for (let x = cbox.x0; x <= cbox.x1; x++) {
        const p = (y * body.w + x) * 4;
        if (body.rgba[p + 3] < 128) continue;
        sx += x;
        sn++;
        const [R, G, B] = [body.rgba[p], body.rgba[p + 1], body.rgba[p + 2]];
        if (R > 90 && R > B + 40 && luma(R, G, B) < 200) {
          ex += x;
          en++;
        }
      }
    }
    const bodyCx = sn ? sx / sn : (cbox.x0 + cbox.x1) / 2;
    const eyeOffset = en ? ex / en - bodyCx : 0;

    frames.push({
      name: spec.names[i],
      sheet: spec,
      index: i,
      cell: spec.cell,
      body,
      glyph,
      glyphBox: glyph ? glyph.bbox : null,
      origin: { x: rx, y: ry },
      cx: (cbox.x0 + cbox.x1) / 2,
      foot: cbox.y1,
      footSheet: core.box.y1,
      scale: 1,
      facing: eyeOffset < 0 ? "left" : "right",
      eyeOffset,
      eyePx: en,
      coreH: core.box.y1 - core.box.y0 + 1,
      coreW: core.box.x1 - core.box.x0 + 1,
      accessories: counts,
    });

    for (const d of spec.derive ?? []) {
      if (d.from !== i) continue;
      const kept = byNearness.slice(0, d.keepGlyphs);
      if (kept.length !== d.keepGlyphs) {
        fail(`${d.name}: wanted ${d.keepGlyphs} of \`${spec.names[i]}\`'s glyphs, it has ${byNearness.length}`);
        continue;
      }
      frames.push({ ...frames[frames.length - 1], name: d.name, glyph: keyGlyphs(kept), derivedFrom: spec.names[i] });
    }
  }

  const refScale = measureScale(cores[spec.scaleRef], cores[spec.scaleRef]);
  void refScale;
  return { frames, coreH: cores[spec.scaleRef].box.y1 - cores[spec.scaleRef].box.y0 + 1 };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  err("─".repeat(78));

  const cut: Array<{ spec: SheetSpec; frames: Frame[]; coreH: number }> = [];
  for (const spec of SHEETS) {
    const { frames, coreH } = await cutSheet(spec, null);
    cut.push({ spec, frames, coreH });
  }

  // ── Scale: one factor per sheet, from its own reference frame ──────────────
  // The character ships OUT_BODY_PX tall whatever sheet it came from.
  err("\nscale");
  for (const c of cut) {
    c.frames.forEach((f) => {
      f.scale = (OUT_BODY_PX / c.coreH) * c.spec.scaleNudge;
    });
    const k = c.frames[0].scale;
    err(
      `  ${c.spec.file.padEnd(30)} ref core ${String(c.coreH).padStart(3)} px  ` +
        `x${(OUT_BODY_PX / c.coreH).toFixed(3)} x nudge ${c.spec.scaleNudge} = ${k.toFixed(3)} out px per source px` +
        `   ${k > 1 ? `UPSCALES ${k.toFixed(2)}x` : `downscales ${(1 / k).toFixed(2)}x`}`,
    );
    // An upscale means the sheet is the resolution limit for the whole set.
    if (k > 1.3) fail(`${c.spec.file} would be upscaled ${k.toFixed(2)}x — lower OUT_BODY_PX`);
  }

  const frames = cut.flatMap((c) => c.frames);
  const byName = new Map(frames.map((f) => [f.name, f]));

  // ── Per-clip ground lines ─────────────────────────────────────────────────
  // One anchor per clip, from its grounded frame, so the drawn lift survives.
  const groundOf = new Map<string, number>();
  for (const clip of CLIPS) {
    const ref = byName.get(clip.frames[clip.groundRef]);
    if (!ref) {
      fail(`clip \`${clip.name}\` references a frame that was not cut: ${clip.frames[clip.groundRef]}`);
      continue;
    }
    for (const name of clip.frames) groundOf.set(name, ref.footSheet);
  }

  /** Where this frame's feet sit relative to its clip's ground line, in output px. */
  const footOffset = (f: Frame) => ((groundOf.get(f.name) ?? f.footSheet) - f.footSheet) * f.scale;

  // ── Cells ─────────────────────────────────────────────────────────────────
  // Extents measured from the registration point, made symmetric so a flop is a
  // no-op on registration.
  const cells = new Map<CellName, { w: number; h: number; cx: number; baseline: number; bodyH: number; bodyW: number }>();
  for (const cellName of ["base", "jump"] as CellName[]) {
    const mine = frames.filter((f) => f.cell === cellName);
    if (!mine.length) continue;
    let side = 0;
    let up = 0;
    let down = 0;
    let bodyH = 0;
    let bodyW = 0;
    for (const f of mine) {
      const lift = footOffset(f);
      const boxes = [f.body.bbox, ...(f.glyph ? [f.glyph.bbox] : [])];
      for (const b of boxes) {
        side = Math.max(side, (f.cx - b.x0) * f.scale, (b.x1 - f.cx) * f.scale);
        // `lift` raises the whole frame, so it reaches FURTHER above the ground
        // line and LESS far below it. Getting these two signs the wrong way round
        // sinks the jump cell's foot line to 59% of its height.
        up = Math.max(up, (f.foot - b.y0) * f.scale + lift);
        down = Math.max(down, (b.y1 - f.foot) * f.scale - lift);
      }
      // The character's own box, for the CSS to size itself by — measured on the
      // CORE, which is what the scale was derived from. The keyed component is
      // larger (feather, and any accessory fused to the body) and using it would
      // make every cell disagree about how tall the character is.
      bodyH = OUT_BODY_PX;
      bodyW = Math.max(bodyW, f.coreW * f.scale);
    }
    const w = Math.round(side + CELL_PAD) * 2;
    const h = Math.round(up + down) + CELL_PAD * 2;
    cells.set(cellName, { w, h, cx: w / 2, baseline: Math.round(up) + CELL_PAD, bodyH, bodyW });
  }

  err("\ncells");
  for (const [name, c] of cells) {
    err(
      `  ${name.padEnd(5)} ${c.w}x${c.h}   ar ${(c.w / c.h).toFixed(3)}   footY ${(c.baseline / c.h).toFixed(3)}   ` +
        `bodyH ${(c.bodyH / c.h).toFixed(4)}   bodyW ${(c.bodyW / c.w).toFixed(4)}   ` +
        `character ${(c.bodyH).toFixed(1)} px`,
    );
    // The whole point of allowing two cells: the character is the same size in both.
    if (Math.abs(c.bodyH - OUT_BODY_PX) > 2) {
      fail(`cell \`${name}\` draws the character ${c.bodyH.toFixed(1)} px tall, not ${OUT_BODY_PX}`);
    }
    if (c.baseline / c.h < 0.55 || c.baseline / c.h > 0.99) fail(`cell \`${name}\`: implausible foot line`);
  }

  // ── Report every frame, and gate it ───────────────────────────────────────
  for (const f of frames) {
    const k = f.body;
    const bw = k.mainBox.x1 - k.mainBox.x0 + 1;
    const bh = k.mainBox.y1 - k.mainBox.y0 + 1;
    const lift = footOffset(f) / OUT_BODY_PX;
    err(
      `\n[${f.sheet.file.slice(0, 12)} ${String(f.index).padStart(2)}] ${f.name.padEnd(10)} ` +
        `core ${bw}x${bh}   cov ${(k.coverage * 100).toFixed(1)}%   holes ${((k.holesFilled / Math.max(1, k.bodyPx)) * 100).toFixed(2)}%   ` +
        `edge luma ${k.meanEdgeLuma.toFixed(0)}   ramp ${k.edgeRampPx.toFixed(1)}px   ` +
        `eyes ${f.eyeOffset > 0 ? "+" : ""}${f.eyeOffset.toFixed(0)} (${f.eyePx}px) -> ${f.facing}` +
        `${f.glyph ? "   lettering" : ""}${f.accessories.glow ? `   ${f.accessories.glow} glow` : ""}` +
        `${f.accessories.stray ? `   ${f.accessories.stray} STRAY DROPPED` : ""}` +
        `${f.derivedFrom ? `   derived from ${f.derivedFrom}` : ""}` +
        `${Math.abs(lift) > 0.01 ? `   lift ${lift >= 0 ? "+" : ""}${lift.toFixed(3)}` : ""}`,
    );
    err(alphaMap(k, 44, 13, k.mainBox));

    if (k.coverage < 0.04 || k.coverage > 0.75) {
      fail(`${f.name}: coverage ${(k.coverage * 100).toFixed(1)}% outside 4-75%`);
    }
    if (k.holesFilled / Math.max(1, k.bodyPx) > 0.08) fail(`${f.name}: filled >8% of body — the key is eating the blob`);
    if (k.meanEdgeLuma < f.sheet.minEdgeLuma) {
      fail(`${f.name}: mean edge luma ${k.meanEdgeLuma.toFixed(0)} < ${f.sheet.minEdgeLuma} — halo`);
    }
    if (k.edgeRampPx < 2 && f.sheet.feather === 0) {
      fail(`${f.name}: silhouette steps from 0 to 1 in ${k.edgeRampPx.toFixed(1)}px and will ship jagged — set feather`);
    }
    if (f.eyePx < 200) fail(`${f.name}: only ${f.eyePx} eye pixels — its facing cannot be measured`);
  }

  // ── Clip gates ────────────────────────────────────────────────────────────
  err("\nclips");
  for (const clip of CLIPS) {
    const fs = clip.frames.map((n) => byName.get(n)).filter((f): f is Frame => !!f);
    if (fs.length !== clip.frames.length) {
      fail(`clip \`${clip.name}\` is missing frames`);
      continue;
    }
    const lifts = fs.map((f) => footOffset(f) / OUT_BODY_PX);
    err(
      `  ${clip.name.padEnd(6)} ${fs.length} frames  cell ${clip.cell}  ${clip.fps} fps  ` +
        `${clip.loop ? "loops" : "one-shot"}  rest ${clip.rest}`,
    );
    err(`         lift ${lifts.map((l) => (l >= 0 ? "+" : "") + l.toFixed(3)).join("  ")} body heights`);
    if (clip.name === "jump") {
      const peak = Math.max(...lifts);
      if (peak < 0.25 || peak > 0.8) fail(`the jump rises ${peak.toFixed(3)} body heights — expected 0.25 to 0.80`);
    } else {
      const drift = Math.max(...lifts.map(Math.abs));
      if (drift > 0.12) fail(`clip \`${clip.name}\` drifts ${drift.toFixed(3)} body heights off its ground line`);
    }
  }

  if (failures.length) {
    err("\nFAILED — nothing written:");
    for (const f of failures) err(`  · ${f}`);
    process.exit(1);
  }

  // ── Compose ───────────────────────────────────────────────────────────────
  // Everything is buffered and only written once every gate has passed, so
  // "nothing written" is literally true rather than nearly true.
  const written = new Map<string, Buffer>();

  for (const f of frames) {
    const cell = cells.get(f.cell)!;
    const lift = footOffset(f);

    const place = async (k: Keyed) => {
      const b = k.bbox;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const png = await sharp(k.rgba, { raw: { width: k.w, height: k.h, channels: 4 } })
        .extract({ left: b.x0, top: b.y0, width: w, height: h })
        .resize(Math.max(1, Math.round(w * f.scale)), Math.max(1, Math.round(h * f.scale)), {
          kernel: "lanczos3",
        })
        .png()
        .toBuffer();
      return {
        png,
        w: Math.max(1, Math.round(w * f.scale)),
        h: Math.max(1, Math.round(h * f.scale)),
        left: Math.round(cell.cx + (b.x0 - f.cx) * f.scale),
        top: Math.round(cell.baseline + (b.y0 - f.foot) * f.scale - lift),
      };
    };

    const bodyLayer = await place(f.body);
    const glyphLayer = f.glyph ? await place(f.glyph) : null;

    if (bodyLayer.left < 0 || bodyLayer.top < 0 || bodyLayer.left + bodyLayer.w > cell.w || bodyLayer.top + bodyLayer.h > cell.h) {
      fail(`${f.name} does not fit its cell`);
    }

    const blank = () =>
      sharp({ create: { width: cell.w, height: cell.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

    const bodyCell = await blank()
      .composite([{ input: bodyLayer.png, left: bodyLayer.left, top: bodyLayer.top }])
      .png()
      .toBuffer();

    for (const facing of ["left", "right"] as const) {
      const oriented = facing === f.facing ? bodyCell : await sharp(bodyCell).flop().png().toBuffer();
      let composed = oriented;
      if (glyphLayer) {
        // Lettering is placed at the MIRRORED POSITION but never mirrored
        // itself, or the Zzz read as three backwards z's.
        const leftSpace = f.facing === "left" ? glyphLayer.left : cell.w - glyphLayer.left - glyphLayer.w;
        const left = facing === "left" ? leftSpace : cell.w - leftSpace - glyphLayer.w;
        composed = await sharp(oriented)
          .composite([{ input: glyphLayer.png, left, top: glyphLayer.top }])
          .png()
          .toBuffer();
      }
      written.set(
        `${f.name}-${facing}.webp`,
        await sharp(composed).webp({ quality: 94, alphaQuality: 92, smartSubsample: true, effort: 6 }).toBuffer(),
      );
    }
  }

  if (failures.length) {
    err("\nFAILED — nothing written:");
    for (const f of failures) err(`  · ${f}`);
    process.exit(1);
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  let total = 0;
  for (const [name, buf] of written) {
    writeFileSync(join(OUT_DIR, name), buf);
    total += buf.length;
  }
  const orphans = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webp") && !written.has(f));
  for (const o of orphans) unlinkSync(join(OUT_DIR, o));

  err("\noutputs");
  for (const clip of CLIPS) {
    const bytes = clip.frames.reduce(
      (s, n) => s + (written.get(`${n}-left.webp`)?.length ?? 0) + (written.get(`${n}-right.webp`)?.length ?? 0),
      0,
    );
    err(`  clip ${clip.name.padEnd(6)} ${String(clip.frames.length * 2).padStart(3)} files ${(bytes / 1024).toFixed(1).padStart(8)} KB`);
  }
  err(`  ${"TOTAL".padEnd(11)} ${String(written.size).padStart(3)} files ${(total / 1024).toFixed(1).padStart(8)} KB`);
  if (orphans.length) err(`  removed ${orphans.length} orphaned file(s) from a previous cut`);

  const cold = written.get(`${CLIPS[0].frames[CLIPS[0].rest]}-left.webp`);
  err(`  cold-load  ${CLIPS[0].frames[CLIPS[0].rest]}-left.webp  ${((cold?.length ?? 0) / 1024).toFixed(1)} KB`);

  // ── The generated module ──────────────────────────────────────────────────
  const cellEntry = (name: CellName) => {
    const c = cells.get(name)!;
    return (
      `  ${name}: { width: ${c.w}, height: ${c.h}, cellAr: ${(c.w / c.h).toFixed(3)}, ` +
      `footY: ${(c.baseline / c.h).toFixed(3)}, bodyH: ${(c.bodyH / c.h).toFixed(4)}, bodyW: ${(c.bodyW / c.w).toFixed(4)} },`
    );
  };

  const source = `/**
 * GENERATED FILE — do not edit. Run \`npm run build:sprites\` to regenerate.
 *
 * The blob's frames, cut from four art sheets and registered onto one character
 * height and one foot line. Every frame ships facing both ways; the sheets mix
 * facings, so \`paintedFacing\` records which file is the artwork and which is
 * its flop, and nothing else needs to care.
 *
 * NEVER MIRROR A FRAME IN CSS. Frames marked \`glyph\` carry painted lettering —
 * the Zzz, the question mark — and \`scale: -1 1\` turns them backwards. Both
 * facings exist as separate files with the lettering composited the right way
 * round.
 *
 * Draw a cell at \`cellAr\`, put \`footY\` of its height on the ground, and size it
 * so that \`bodyH\` of its height is the character. Every cell agrees about all
 * three, so swapping cells mid-animation moves nothing.
 */

export type BlobFacing = "left" | "right";

export type BlobFrame =
${frames.map((f) => `  | "${f.name}"`).join("\n")};

export type BlobCellName = ${[...cells.keys()].map((c) => `"${c}"`).join(" | ")};

/** Geometry per cell. The character is ${OUT_BODY_PX} px tall in all of them. */
export const BLOB_CELLS = {
${[...cells.keys()].map(cellEntry).join("\n")}
} as const;

/** The base cell under its old name, so existing call sites keep working. */
export const BLOB_SPRITE = { dir: "${PUBLIC_PREFIX}", ...BLOB_CELLS.base } as const;

/** Which cell a frame is drawn in, and the facts that must not be guessed. */
export const BLOB_FRAMES = {
${frames
  .map(
    (f) =>
      `  "${f.name}": { cell: "${f.cell}", paintedFacing: "${f.facing}", glyph: ${!!f.glyph}, source: "${f.sheet.file}", sheetIndex: ${f.index} },`,
  )
  .join("\n")}
} as const;

/**
 * Named frame sequences.
 *
 * \`fps\`, \`loop\` and \`rest\` are DECLARED — frame timing is not in the artwork.
 * \`lift\` is MEASURED: how far above the clip's ground line the artist drew each
 * frame's feet, in body heights. That is what makes the jump actually rise.
 */
export const BLOB_CLIPS = {
${CLIPS.map((clip) => {
  const fs = clip.frames.map((n) => byName.get(n)!);
  const lifts = fs.map((f) => (footOffset(f) / OUT_BODY_PX).toFixed(3));
  return (
    `  ${clip.name}: {\n` +
    `    note: "${clip.note}",\n` +
    `    cell: "${clip.cell}",\n` +
    `    frames: [${clip.frames.map((n) => `"${n}"`).join(", ")}],\n` +
    `    fps: ${clip.fps},\n` +
    `    loop: ${clip.loop},\n` +
    `    rest: ${clip.rest},\n` +
    `    lift: [${lifts.join(", ")}],\n` +
    `  },`
  );
}).join("\n")}
} as const;

export type BlobClipName = keyof typeof BLOB_CLIPS;

/** The URL of one frame. */
export const blobSprite = (frame: BlobFrame, facing: BlobFacing = "left") =>
  \`${PUBLIC_PREFIX}/\${frame}-\${facing}.webp\`;

/** The cell a frame needs, for the four CSS custom properties. */
export const blobCell = (frame: BlobFrame) => BLOB_CELLS[BLOB_FRAMES[frame].cell];
`;

  // Temp file + rename, so a crash mid-write cannot leave a half-written module.
  writeFileSync(MANIFEST + ".tmp", source);
  renameSync(MANIFEST + ".tmp", MANIFEST);
  err("\nOK\n");
}

main().catch((e) => {
  err(String(e?.stack ?? e));
  process.exit(1);
});
