/**
 * GENERATED FILE — do not edit. Run `npm run build:design` to regenerate.
 *
 * Geometry measured from the source artwork, so the hero's CSS can never drift
 * from where the blob is actually painted on the plate. Every fraction below is
 * in FLOPPED plate space: the plate is mirrored at build time so the headline
 * gets the dark side of the frame instead of the bright lit path.
 *
 * Sources (bytes / FNV-1a checked at build time):
 *   Night forest _ no aurora_ no fireflies.png
 *   Aurora scene _ clean_ empty.png
 *   Aurora scene _ blob_ no text.png
 *   Blob walk-cycle strip.png
 */

/** Aspect ratios and the widths actually encoded, per art-directed variant. */
export const PLATE = {
  wide: { ar: 1.77081, widths: [1600, 2400] },
  tall: { ar: 0.75, widths: [900, 1350] },
} as const;

/**
 * Where the blob sits on the plate, as fractions of the plate box.
 * `feetY` is the BOTTOM of the sprite — the contact point with the path.
 */
export const BLOB_ANCHOR = {
  wideCx: 0.665,
  /** The tall crop is centred on the blob, so it lands mid-frame by construction. */
  tallCx: 0.5,
  feetY: 0.891,
  heightFrac: 0.190,
} as const;

/** The walk cycle, packed as one horizontal sheet of equal cells. */
export const WALK = {
  src: "/hero/blob-walk.webp",
  frames: 6,
  cellAr: 1.105,
  /** Held when the blob is standing still — the frame with both feet planted. */
  idleFrame: 0,
} as const;

/**
 * The aurora's colours, sampled from the ORIGINAL painted plate.
 *
 * The shipped plate has an empty sky; components/hero/HeroSky.tsx paints the
 * curtains live so they drift. These are the real pigments rather than
 * hand-picked teals, which is the difference between matching the illustration
 * and merely being green.
 *
 * `top`/`bottom` are the fractions of plate height the painted aurora spanned —
 * the live layer masks itself to that band so it never washes over the treeline.
 */
export const AURORA = {
  /** A curtain's body. RAW measured delta — see the note above about dimness. */
  core: "#152824",
  /** Its bright spine. */
  glow: "#254235",
  /** The brightest light the painting added anywhere; the ceiling to stay under. */
  peak: "#2e523c",
  top: 0.115,
  bottom: 0.589,
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
  { x: 0.3392, y: 0.5144, r: 0.00332 },
  { x: 0.6689, y: 0.5268, r: 0.00627 },
  { x: 0.5236, y: 0.5334, r: 0.00258 },
  { x: 0.333, y: 0.5406, r: 0.01217 },
  { x: 0.9251, y: 0.5838, r: 0.00664 },
  { x: 0.7577, y: 0.5844, r: 0.00516 },
  { x: 0.8315, y: 0.6459, r: 0.0059 },
  { x: 0.0583, y: 0.6649, r: 0.00922 },
  { x: 0.2673, y: 0.7205, r: 0.00664 },
  { x: 0.7312, y: 0.7277, r: 0.00479 },
  { x: 0.3761, y: 0.8685, r: 0.00332 },
  { x: 0.8721, y: 0.8711, r: 0.00147 },
  { x: 0.8444, y: 0.9136, r: 0.00258 },
] as const;
