/**
 * Test-time augmentation: turning one look into several.
 *
 * Two independent problems, two kinds of pass.
 *
 * 1. JITTER. The same object detected twice at slightly different framings gives
 *    slightly different boxes and scores. A horizontal flip is the cheapest
 *    decorrelated second opinion there is — the model's convolutional biases do
 *    not survive it, so where flip and no-flip agree, the detection is solid.
 *    That agreement is exactly what ./boxes.ts turns into `support`.
 *
 * 2. SMALL OBJECTS. This is the bigger win and the less obvious one. YOLOS and
 *    DETR resize their input to a fixed short edge (~800 px) before doing
 *    anything. A water bottle 40 px across in a 4000 px photo arrives at the
 *    model as ~8 px and is simply not resolvable — no threshold change brings it
 *    back, because the information was destroyed in preprocessing.
 *
 *    So we also run the detector on overlapping TILES of the frame. Each tile is
 *    resized to the same ~800 px, which means the bottle arrives at ~30 px and
 *    becomes findable. This is the SAHI trick (Slicing Aided Hyper Inference),
 *    and on a wide outdoor frame — which is every frame this robot takes — it is
 *    worth more than any model swap.
 *
 * WHY TILE BOXES GET DROPPED AT THE EDGE. A tile cuts objects in half. Half a
 * person is a confident, well-formed, completely wrong box, and it is poison for
 * "best angle" — a truncated box looks like a large near object. So a tile
 * detection touching a cut edge (an edge interior to the frame, not an edge of
 * the frame itself) is discarded. Anything big enough to span a cut is big enough
 * for the full-frame pass to have found it already, and the tile overlap covers
 * the band in between.
 *
 * Browser-only: needs canvas. The pure geometry it relies on lives in ./boxes.ts
 * so verify-pipeline can exercise the fusion without a DOM.
 */
import type { Box, ScoredBox } from "./boxes";

export type QualityMode = "fast" | "balanced" | "thorough";

export interface QualityPreset {
  id: QualityMode;
  label: string;
  note: string;
  /** Include a horizontally flipped pass. */
  flip: boolean;
  /** Tile grid, n×n. 1 means no tiling. */
  grid: number;
  /** How much neighbouring tiles overlap, as a fraction of tile size. */
  overlap: number;
}

export const QUALITY_PRESETS: Record<QualityMode, QualityPreset> = {
  fast: {
    id: "fast",
    label: "Fast",
    note: "One look. What the robot does per-frame at 10 fps.",
    flip: false,
    grid: 1,
    overlap: 0,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    note: "Flip + 2×2 tiles. Finds small objects, ~5× the time.",
    flip: true,
    grid: 2,
    overlap: 0.25,
  },
  thorough: {
    id: "thorough",
    label: "Thorough",
    note: "Flip + 3×3 tiles. The cloud-side pass, ~11× the time.",
    flip: true,
    grid: 3,
    overlap: 0.25,
  },
};

/** Number of forward passes a preset costs. Shown in the UI before you commit. */
export const passCountFor = (p: QualityPreset): number =>
  1 + (p.flip ? 1 : 0) + (p.grid > 1 ? p.grid * p.grid : 0);

/**
 * One planned forward pass: which part of the frame, and whether it is mirrored.
 * `crop` is in normalized frame coordinates, so a plan is resolution-independent
 * and can be reasoned about (and tested) without an image.
 */
export interface Pass {
  id: string;
  crop: Box;
  flip: boolean;
  /** True for the whole-frame passes — their boxes are never edge-dropped. */
  full: boolean;
}

export function planPasses(preset: QualityPreset): Pass[] {
  const whole: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const passes: Pass[] = [{ id: "full", crop: whole, flip: false, full: true }];
  if (preset.flip) passes.push({ id: "full-flip", crop: whole, flip: true, full: true });

  const n = preset.grid;
  if (n > 1) {
    // Tiles overlap, so step < size and the last tile is pinned to the far edge
    // rather than running past it.
    const size = 1 / (n - (n - 1) * preset.overlap);
    const step = size * (1 - preset.overlap);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x0 = Math.min(col * step, 1 - size);
        const y0 = Math.min(row * step, 1 - size);
        passes.push({
          id: `tile-${row}${col}`,
          crop: { x0, y0, x1: x0 + size, y1: y0 + size },
          flip: false,
          full: false,
        });
      }
    }
  }
  return passes;
}

/** Longest edge a pass canvas is rendered at. Above the models' ~800 px short
 *  edge, so upscaling a tile is never thrown away by their own resize. */
const PASS_MAX_EDGE = 960;

export interface SourceFrame {
  bitmap: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Decode whatever the caller has into something canvas can draw.
 *
 * `createImageBitmap` is the fast path and handles blobs, canvases and images
 * alike; the `<img>` fallback exists for Safari versions that reject a bare URL
 * string here.
 */
export async function loadFrame(
  input: string | HTMLCanvasElement | HTMLImageElement | ImageBitmap | Blob,
): Promise<SourceFrame> {
  if (typeof input !== "string" && "width" in input && "height" in input) {
    const el = input as HTMLCanvasElement | HTMLImageElement | ImageBitmap;
    const width = "naturalWidth" in el ? el.naturalWidth || el.width : el.width;
    const height = "naturalHeight" in el ? el.naturalHeight || el.height : el.height;
    return { bitmap: el as CanvasImageSource, width, height };
  }

  const src = typeof input === "string" ? input : URL.createObjectURL(input);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`could not load frame: ${src.slice(0, 80)}`));
    img.src = src;
  });
  if (typeof input !== "string") URL.revokeObjectURL(src);
  return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
}

/** Render one planned pass to its own canvas, upscaling a small crop toward
 *  PASS_MAX_EDGE so the model's internal resize does not throw detail away. */
export function renderPass(frame: SourceFrame, pass: Pass): HTMLCanvasElement {
  const sx = pass.crop.x0 * frame.width;
  const sy = pass.crop.y0 * frame.height;
  const sw = Math.max(1, (pass.crop.x1 - pass.crop.x0) * frame.width);
  const sh = Math.max(1, (pass.crop.y1 - pass.crop.y0) * frame.height);

  const scale = Math.min(PASS_MAX_EDGE / Math.max(sw, sh), 2);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.imageSmoothingQuality = "high";

  if (pass.flip) {
    ctx.translate(dw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(frame.bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}

/** How close to a cut edge a tile box may sit before it is treated as truncated. */
const EDGE_MARGIN = 0.015;

/**
 * Map a pass's boxes back into frame coordinates, undoing flip and crop, and drop
 * the ones truncated by a cut edge.
 *
 * The `full` guard is what keeps a person standing at the left of the FRAME —
 * legitimately touching x=0 — while removing a person bisected by a tile seam.
 * The first is the best view we will ever get of them; the second is half a
 * person wearing a confident score.
 */
export function mapPassBoxes(pass: Pass, boxes: ScoredBox[]): ScoredBox[] {
  const cw = pass.crop.x1 - pass.crop.x0;
  const ch = pass.crop.y1 - pass.crop.y0;
  const out: ScoredBox[] = [];

  for (const d of boxes) {
    let { x0, x1 } = d.box;
    const { y0, y1 } = d.box;
    if (pass.flip) {
      const fx0 = 1 - x1;
      const fx1 = 1 - x0;
      x0 = fx0;
      x1 = fx1;
    }

    if (!pass.full) {
      // A crop edge is "cut" only when it is interior to the frame.
      const cutLeft = pass.crop.x0 > 1e-6 && x0 <= EDGE_MARGIN;
      const cutRight = pass.crop.x1 < 1 - 1e-6 && x1 >= 1 - EDGE_MARGIN;
      const cutTop = pass.crop.y0 > 1e-6 && y0 <= EDGE_MARGIN;
      const cutBottom = pass.crop.y1 < 1 - 1e-6 && y1 >= 1 - EDGE_MARGIN;
      if (cutLeft || cutRight || cutTop || cutBottom) continue;
    }

    out.push({
      label: d.label,
      score: d.score,
      box: {
        x0: pass.crop.x0 + x0 * cw,
        y0: pass.crop.y0 + y0 * ch,
        x1: pass.crop.x0 + x1 * cw,
        y1: pass.crop.y0 + y1 * ch,
      },
    });
  }

  return out;
}
