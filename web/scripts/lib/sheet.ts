/**
 * Finding the frames on a sheet, and deciding what belongs to which.
 *
 * `key.ts` knows how to cut one rectangle out of a flat field. This file knows
 * how to work out what the rectangles are — which is the harder half once a
 * sheet stops being a tidy grid.
 *
 * WHY FRAMES ARE FOUND BY THEIR WHITE CORE.
 *
 * The obvious approach — split the strip into N equal columns — fails on the
 * jump sheet: the apex flare is still 0.967 opaque where it crosses into the
 * next frame's column, so any vertical cut saws through solid artwork. The next
 * obvious approach — one connected component per frame — fails for the same
 * reason, in reverse: the flare welds two frames into a single component.
 *
 * What is reliable is that the CHARACTER is the only thing on these sheets that
 * is both bright and neutral. Every flare, ground glow, sparkle, Zzz and question
 * mark is warm — amber or gold. So a component that is opaque AND has no warm
 * cast is a blob, and nothing else is. That finds exactly the right count on all
 * four sheets (24, 5, 4, 5) with no per-sheet tuning at all.
 *
 * Accessories are then attached to whichever core owns them, BY POINT rather
 * than by box: the flare's bounding box overlaps its neighbour's body, so a box
 * test hands the neighbour's artwork to the wrong frame. Reading the label at a
 * single pixel inside the object cannot be wrong that way.
 */
import { VISIBLE, luma, solveAlpha, type Background, type Box, type Raw } from "./key";

export interface Core {
  index: number;
  size: number;
  box: Box;
  /** Centroid of the core's own pixels. */
  cx: number;
  cy: number;
  /** A point known to be inside it, in SHEET coordinates. */
  seed: { x: number; y: number };
}

export interface SheetObject {
  id: number;
  size: number;
  box: Box;
  seed: { x: number; y: number };
}

/** Flood one mask into components. Shared by both passes below. */
function components(
  mask: Uint8Array,
  w: number,
  h: number,
  minSize: number,
): Array<{ size: number; box: Box; seed: { x: number; y: number }; sx: number; sy: number }> {
  const seen = new Uint8Array(w * h);
  const out: Array<{ size: number; box: Box; seed: { x: number; y: number }; sx: number; sy: number }> = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    let sx = 0;
    let sy = 0;
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      const i = q.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const t = (j: number) => {
        if (mask[j] && !seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
      };
      if (x > 0) t(i - 1);
      if (x < w - 1) t(i + 1);
      if (y > 0) t(i - w);
      if (y < h - 1) t(i + w);
    }
    if (size < minSize) continue;
    out.push({
      size,
      box: { x0, y0, x1, y1 },
      seed: { x: start % w, y: (start - (start % w)) / w },
      sx: sx / size,
      sy: sy / size,
    });
  }
  return out;
}

export interface CoreOptions {
  /** Opaque enough to be body, not glow. */
  coreAlpha?: number;
  /** Max R-B for "white". Everything the artist added to the character is warm. */
  coreWarmth?: number;
  minCore: number;
}

/** One per frame: the bright, neutral mass that is the character itself. */
export function bodyCores(img: Raw, bg: Background, bodyY: number, opts: CoreOptions): Core[] {
  const { coreAlpha = 0.5, coreWarmth = 30, minCore } = opts;
  const n = img.w * img.h;
  const mask = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += img.c) {
    const R = img.data[p];
    const B = img.data[p + 2];
    if (R - B > coreWarmth) continue;
    if (solveAlpha(luma(R, img.data[p + 1], B), bg.y, bodyY) >= coreAlpha) mask[i] = 1;
  }
  return components(mask, img.w, img.h, minCore).map((c, index) => ({
    index,
    size: c.size,
    box: c.box,
    cx: c.sx,
    cy: c.sy,
    seed: c.seed,
  }));
}

/**
 * Every painted object on the sheet, at the sheet's own alpha floor.
 *
 * The threshold is never below VISIBLE, whatever the floor says. A painterly
 * sheet's background is not mathematically flat — it carries a faint gradient —
 * so "brighter than the background at all" labels a few hundred noise specks and
 * then welds whole frames together through them. Measured on the sleep strip:
 * 284 objects and one component holding two frames' cores at `> 0`, against 8
 * objects and no welds at VISIBLE.
 */
export function labelSheet(
  img: Raw,
  bg: Background,
  bodyY: number,
  alphaFloor: number,
  minObject: number,
): { labels: Int32Array; objects: SheetObject[] } {
  const n = img.w * img.h;
  const mask = new Uint8Array(n);
  const threshold = Math.max(alphaFloor, VISIBLE);
  for (let i = 0, p = 0; i < n; i++, p += img.c) {
    if (solveAlpha(luma(img.data[p], img.data[p + 1], img.data[p + 2]), bg.y, bodyY) >= threshold) {
      mask[i] = 1;
    }
  }
  const found = components(mask, img.w, img.h, minObject);
  const labels = new Int32Array(n).fill(-1);
  const objects: SheetObject[] = found.map((c, id) => ({ id, size: c.size, box: c.box, seed: c.seed }));
  // Second pass to paint the ids, now that the survivors are known.
  const seen = new Uint8Array(n);
  for (const o of objects) {
    const start = o.seed.y * img.w + o.seed.x;
    const q = [start];
    seen[start] = 1;
    labels[start] = o.id;
    while (q.length) {
      const i = q.pop()!;
      const x = i % img.w;
      const y = (i - x) / img.w;
      const t = (j: number) => {
        if (mask[j] && !seen[j]) {
          seen[j] = 1;
          labels[j] = o.id;
          q.push(j);
        }
      };
      if (x > 0) t(i - 1);
      if (x < img.w - 1) t(i + 1);
      if (y > 0) t(i - img.w);
      if (y < img.h - 1) t(i + img.w);
    }
  }
  return { labels, objects };
}

export interface Ownership {
  /** For each object, the core index that owns it. */
  owner: number[];
  /** Objects that hold two cores — a split that did not work. */
  welded: Array<{ objectId: number; cores: number[] }>;
  /** Objects with no core, and how far they sat from the one they went to. */
  adopted: Array<{ objectId: number; core: number; distance: number }>;
}

/**
 * Attach every painted object to a frame.
 *
 * The core's own seed pixel is read out of the label map — an exact answer, not
 * a proximity guess. Anything with no core of its own (a Zzz, a ground glow, a
 * sparkle) goes to the nearest core, and the caller gates on the distance.
 */
export function ownObjects(
  labels: Int32Array,
  sheetW: number,
  objects: SheetObject[],
  cores: Core[],
): Ownership {
  const owner = new Array<number>(objects.length).fill(-1);
  const holders = new Map<number, number[]>();

  for (const core of cores) {
    const id = labels[core.seed.y * sheetW + core.seed.x];
    if (id < 0) continue;
    owner[id] = core.index;
    holders.set(id, [...(holders.get(id) ?? []), core.index]);
  }

  const welded = [...holders.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([objectId, list]) => ({ objectId, cores: list }));

  const adopted: Ownership["adopted"] = [];
  for (const o of objects) {
    if (owner[o.id] >= 0) continue;
    let best = -1;
    let bestD = Infinity;
    const ox = (o.box.x0 + o.box.x1) / 2;
    const oy = (o.box.y0 + o.box.y1) / 2;
    for (const core of cores) {
      const d = Math.hypot(ox - core.cx, oy - core.cy);
      if (d < bestD) {
        bestD = d;
        best = core.index;
      }
    }
    owner[o.id] = best;
    adopted.push({ objectId: o.id, core: best, distance: bestD });
  }
  return { owner, welded, adopted };
}

/**
 * Reading order, banded rather than sorted.
 *
 * Rows drift — on the first pose sheet by up to 100 px — so sorting on y alone
 * interleaves them and silently renames every frame.
 */
export function readingOrder(cores: Core[], rows: number, sheetH: number): Core[] {
  if (rows <= 1) return [...cores].sort((a, b) => a.cx - b.cx);
  const pitch = sheetH / rows;
  const byY = [...cores].sort((a, b) => a.cy - b.cy);
  const bands: Core[][] = [];
  for (const c of byY) {
    const band = bands[bands.length - 1];
    if (band && c.cy - band[0].cy < pitch / 2) band.push(c);
    else bands.push([c]);
  }
  return bands.flatMap((b) => b.sort((a, z) => a.cx - z.cx));
}

/**
 * What an accessory is, so it can be treated correctly.
 *
 * Lettering must never be mirrored; a glow may be. And a STRAY is neither: the
 * generator leaves a grey four-pointed star on some frames, and because it sits
 * under the character a positional rule files it as a ground glow and ships it.
 * Every real accessory the artist drew is warm; the artifact is not.
 */
export function classifyAccessory(
  img: Raw,
  object: SheetObject,
  labels: Int32Array,
  mainBox: Box,
  minWarmth = 25,
): "glyph" | "glow" | "stray" {
  const warmth: number[] = [];
  for (let y = object.box.y0; y <= object.box.y1; y++) {
    for (let x = object.box.x0; x <= object.box.x1; x++) {
      const i = y * img.w + x;
      if (labels[i] !== object.id) continue;
      const p = i * img.c;
      warmth.push(img.data[p] - img.data[p + 2]);
    }
  }
  warmth.sort((a, b) => a - b);
  const median = warmth.length ? warmth[warmth.length >> 1] : 0;
  if (median < minWarmth) return "stray";
  return object.box.y1 < mainBox.y0 + (mainBox.y1 - mainBox.y0) * 0.35 ? "glyph" : "glow";
}

/**
 * How big this sheet draws the character, three ways.
 *
 * They are reported together because when they disagree the sheet is drawing a
 * different SHAPE, not a different size — the jump blob is rounder than the pose
 * sheet's, and its three estimators spread by 16%. No single number is right
 * there; a person has to look.
 */
export function measureScale(core: Core, ref: Core) {
  const h = (core.box.y1 - core.box.y0 + 1) / (ref.box.y1 - ref.box.y0 + 1);
  const w = (core.box.x1 - core.box.x0 + 1) / (ref.box.x1 - ref.box.x0 + 1);
  const a = Math.sqrt(core.size / ref.size);
  const lo = Math.min(h, w, a);
  const hi = Math.max(h, w, a);
  return { byHeight: h, byWidth: w, byArea: a, spread: hi / lo - 1 };
}
