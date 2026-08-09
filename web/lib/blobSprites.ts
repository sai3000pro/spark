/**
 * GENERATED FILE — do not edit. Run `npm run build:sprites` to regenerate.
 *
 * The blob's frames, cut from four art sheets and registered onto one character
 * height and one foot line. Every frame ships facing both ways; the sheets mix
 * facings, so `paintedFacing` records which file is the artwork and which is
 * its flop, and nothing else needs to care.
 *
 * NEVER MIRROR A FRAME IN CSS. Frames marked `glyph` carry painted lettering —
 * the Zzz, the question mark — and `scale: -1 1` turns them backwards. Both
 * facings exist as separate files with the lettering composited the right way
 * round.
 *
 * Draw a cell at `cellAr`, put `footY` of its height on the ground, and size it
 * so that `bodyH` of its height is the character. Every cell agrees about all
 * three, so swapping cells mid-animation moves nothing.
 */

export type BlobFacing = "left" | "right";

export type BlobFrame =
  | "smile"
  | "wink"
  | "delight"
  | "surprised"
  | "idle"
  | "turn-0"
  | "turn-1"
  | "turn-2"
  | "wave"
  | "doze"
  | "turn-3"
  | "turn-4"
  | "turn-5"
  | "turn-6"
  | "turn-7"
  | "turn-8"
  | "walk-0"
  | "walk-1"
  | "walk-2"
  | "walk-3"
  | "walk-4"
  | "walk-5"
  | "walk-6"
  | "walk-7"
  | "sleep-0"
  | "sleep-1"
  | "sleep-2"
  | "sleep-3"
  | "sleep-4"
  | "wake-0"
  | "wake-1"
  | "wake-2"
  | "wake-3"
  | "jump-0"
  | "jump-1"
  | "jump-2"
  | "jump-3"
  | "jump-4";

export type BlobCellName = "base" | "jump";

/** Geometry per cell. The character is 300 px tall in all of them. */
export const BLOB_CELLS = {
  base: { width: 380, height: 413, cellAr: 0.920, footY: 0.908, bodyH: 0.7264, bodyW: 0.7560 },
  jump: { width: 738, height: 651, cellAr: 1.134, footY: 0.891, bodyH: 0.4608, bodyW: 0.4214 },
} as const;

/** The base cell under its old name, so existing call sites keep working. */
export const BLOB_SPRITE = { dir: "/sprites/blob", ...BLOB_CELLS.base } as const;

/** Which cell a frame is drawn in, and the facts that must not be guessed. */
export const BLOB_FRAMES = {
  "smile": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 0 },
  "wink": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 1 },
  "delight": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 2 },
  "surprised": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 3 },
  "idle": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 4 },
  "turn-0": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 5 },
  "turn-1": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 6 },
  "turn-2": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 7 },
  "wave": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 8 },
  "doze": { cell: "base", paintedFacing: "right", glyph: true, source: "MoreAnimationsSprites.png", sheetIndex: 9 },
  "turn-3": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 10 },
  "turn-4": { cell: "base", paintedFacing: "left", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 11 },
  "turn-5": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 12 },
  "turn-6": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 13 },
  "turn-7": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 14 },
  "turn-8": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 15 },
  "walk-0": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 16 },
  "walk-1": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 17 },
  "walk-2": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 18 },
  "walk-3": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 19 },
  "walk-4": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 20 },
  "walk-5": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 21 },
  "walk-6": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 22 },
  "walk-7": { cell: "base", paintedFacing: "right", glyph: false, source: "MoreAnimationsSprites.png", sheetIndex: 23 },
  "sleep-0": { cell: "base", paintedFacing: "right", glyph: false, source: "Blob sleep-cycle strip.png", sheetIndex: 0 },
  "sleep-1": { cell: "base", paintedFacing: "right", glyph: true, source: "Blob sleep-cycle strip.png", sheetIndex: 1 },
  "sleep-2": { cell: "base", paintedFacing: "right", glyph: true, source: "Blob sleep-cycle strip.png", sheetIndex: 2 },
  "sleep-3": { cell: "base", paintedFacing: "right", glyph: true, source: "Blob sleep-cycle strip.png", sheetIndex: 3 },
  "sleep-4": { cell: "base", paintedFacing: "right", glyph: false, source: "Blob sleep-cycle strip.png", sheetIndex: 4 },
  "wake-0": { cell: "base", paintedFacing: "right", glyph: true, source: "Asking question.png", sheetIndex: 0 },
  "wake-1": { cell: "base", paintedFacing: "right", glyph: false, source: "Asking question.png", sheetIndex: 1 },
  "wake-2": { cell: "base", paintedFacing: "right", glyph: true, source: "Asking question.png", sheetIndex: 2 },
  "wake-3": { cell: "base", paintedFacing: "right", glyph: true, source: "Asking question.png", sheetIndex: 3 },
  "jump-0": { cell: "jump", paintedFacing: "right", glyph: true, source: "Blob jumping.png", sheetIndex: 0 },
  "jump-1": { cell: "jump", paintedFacing: "right", glyph: false, source: "Blob jumping.png", sheetIndex: 1 },
  "jump-2": { cell: "jump", paintedFacing: "right", glyph: false, source: "Blob jumping.png", sheetIndex: 2 },
  "jump-3": { cell: "jump", paintedFacing: "left", glyph: false, source: "Blob jumping.png", sheetIndex: 3 },
  "jump-4": { cell: "jump", paintedFacing: "left", glyph: false, source: "Blob jumping.png", sheetIndex: 4 },
} as const;

/**
 * Named frame sequences.
 *
 * `fps`, `loop` and `rest` are DECLARED — frame timing is not in the artwork.
 * `lift` is MEASURED: how far above the clip's ground line the artist drew each
 * frame's feet, in body heights. That is what makes the jump actually rise.
 */
export const BLOB_CLIPS = {
  sleep: {
    note: "the Zzz gather and clear",
    cell: "base",
    frames: ["sleep-0", "sleep-1", "sleep-2", "sleep-3", "sleep-4"],
    fps: 1.1,
    loop: true,
    rest: 3,
    lift: [0.000, 0.000, 0.000, 0.000, 0.000],
  },
  wake: {
    note: "asleep, drowsy, awake, asking",
    cell: "base",
    frames: ["wake-0", "wake-1", "wake-2", "wake-3"],
    fps: 6,
    loop: false,
    rest: 3,
    lift: [0.000, 0.002, 0.002, -0.016],
  },
  jump: {
    note: "curious, crouch, lift-off, apex, landing",
    cell: "jump",
    frames: ["jump-0", "jump-1", "jump-2", "jump-3", "jump-4"],
    fps: 12,
    loop: false,
    rest: 0,
    lift: [0.000, -0.020, 0.381, 0.432, -0.014],
  },
  walk: {
    note: "one full gait cycle, two footfalls",
    cell: "base",
    frames: ["walk-0", "walk-1", "walk-2", "walk-3", "walk-4", "walk-5", "walk-6", "walk-7"],
    fps: 10,
    loop: true,
    rest: 0,
    lift: [0.000, -0.004, -0.015, -0.015, -0.078, -0.078, -0.078, -0.075],
  },
} as const;

export type BlobClipName = keyof typeof BLOB_CLIPS;

/** The URL of one frame. */
export const blobSprite = (frame: BlobFrame, facing: BlobFacing = "left") =>
  `/sprites/blob/${frame}-${facing}.webp`;

/** The cell a frame needs, for the four CSS custom properties. */
export const blobCell = (frame: BlobFrame) => BLOB_CELLS[BLOB_FRAMES[frame].cell];
