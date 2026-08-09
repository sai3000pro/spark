/**
 * GENERATED FILE — do not edit. Run `npm run build:sprites` to regenerate.
 *
 * The blob's poses, cut from "Blob SpriteSheet No fireflies.png" and keyed
 * off its navy field. Every pose ships facing both ways. The sheet itself mixes
 * facings, so which file is the artwork and which is its flop varies by pose —
 * `paintedFacing` below records which, and nothing else needs to care.
 *
 * All poses share ONE cell and one registration point — the body's horizontal
 * centre and its foot line — so swapping pose or facing never moves the
 * character. Draw a sprite at `cellAr` and put `footY` of its height on the
 * ground and it will stand where every other pose stands.
 */

export type BlobFacing = "left" | "right";

export type BlobPose =
  | "idle"
  | "smile"
  | "delight"
  | "surprised"
  | "wave"
  | "sleep"
  | "stand"
  | "step"
  | "walk-1"
  | "walk-2"
  | "walk-3"
  | "walk-4"
  | "crouch"
  | "hop"
  | "hover"
  | "question";

/** Geometry shared by every sprite in the set. */
export const BLOB_SPRITE = {
  dir: "/sprites/blob",
  width: 360,
  height: 504,
  cellAr: 0.714,
  /** Fraction of the cell's height at which the feet touch the ground. */
  footY: 0.768,
  /**
   * The standing character's own height, as a fraction of the cell's — foot
   * line to the top of `idle`'s head. The rest of the cell is headroom for the
   * Zzz and the "?" above, and room for the hover glow below the feet.
   *
   * Draw the CELL at `someHeight / bodyH` and the CHARACTER comes out
   * `someHeight` tall, which is the number a layout actually has an opinion
   * about.
   */
  bodyH: 0.6131,
  /** Its width, as a fraction of the cell's. Symmetric about the centre. */
  bodyW: 0.7556,
} as const;

/**
 * What each pose is, and where it came from.
 *
 * `sheetIndex` is the pose's position in the source sheet's reading order.
 * `glyph` marks a pose carrying lettering (the Zzz, the question mark) — that
 * lettering is composited after the flop, so it reads the right way round in
 * both facings and must never be mirrored by CSS.
 */
export const BLOB_POSES = {
  "idle": { note: "eyes open, at rest", sheetIndex: 0, paintedFacing: "left", glyph: false },
  "smile": { note: "half-lidded smile", sheetIndex: 1, paintedFacing: "left", glyph: false },
  "delight": { note: "eyes closed, open smile", sheetIndex: 2, paintedFacing: "left", glyph: false },
  "surprised": { note: "wide eyes, round mouth", sheetIndex: 3, paintedFacing: "left", glyph: false },
  "wave": { note: "near arm raised", sheetIndex: 4, paintedFacing: "left", glyph: false },
  "sleep": { note: "eyes closed, painted Zzz", sheetIndex: 5, paintedFacing: "right", glyph: true },
  "stand": { note: "feet together, arms down", sheetIndex: 6, paintedFacing: "left", glyph: false },
  "step": { note: "one foot forward", sheetIndex: 7, paintedFacing: "left", glyph: false },
  "walk-1": { note: "near arm swung forward", sheetIndex: 8, paintedFacing: "right", glyph: false },
  "walk-2": { note: "arm crossing the body", sheetIndex: 9, paintedFacing: "right", glyph: false },
  "walk-3": { note: "arms tucked, stride open", sheetIndex: 10, paintedFacing: "right", glyph: false },
  "walk-4": { note: "stride at its widest", sheetIndex: 11, paintedFacing: "right", glyph: false },
  "crouch": { note: "low, both arms down", sheetIndex: 12, paintedFacing: "left", glyph: false },
  "hop": { note: "mid-stride over a lit glow", sheetIndex: 13, paintedFacing: "right", glyph: false },
  "hover": { note: "floating, glow beneath", sheetIndex: 14, paintedFacing: "right", glyph: false },
  "question": { note: "asking — question mark decal over the surprised pose", sheetIndex: 3, paintedFacing: "left", glyph: true },
} as const;

/** The URL of one pose. Poses face left unless asked otherwise. */
export const blobSprite = (pose: BlobPose, facing: BlobFacing = "left") =>
  `/sprites/blob/${pose}-${facing}.webp`;
