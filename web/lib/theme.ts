/**
 * Raw theme hexes for SVG, canvas, WebGL and MapLibre.
 *
 * Tailwind classes can't set an SVG `fill`, a THREE.Color or a map-style paint
 * property, so everything drawn outside the DOM needs the literal values. This
 * file mirrors the @theme block in app/globals.css — change one, change both.
 * scripts/build-map-style.mjs duplicates these values (it runs in plain node)
 * when regenerating the map styles.
 */

/* ── FIELD NOTES — the journal. One register now: landing AND app. ───────── */

export const PAPER = "#faf4e3";
export const VELLUM = "#fffbf0";
export const INK = "#1b1b18";
export const INK_SOFT = "#52524a";
export const INK_FAINT = "#78786c";
export const PINE = "#16292e";
export const SPRUCE = "#2c4347";
export const LAGOON = "#476d73";
export const BRASS = "#d5b473";
export const BRASS_DEEP = "#8a6d2f";
export const MOSS = "#7d7730";
export const CLAY = "#cf5e32";
export const MILK = "#f6f0df";
export const MIST = "#a9bdb9";

/* ── NIGHT WALK — retired twilight register, kept for the generated map's
      revert path and any dark-plate accents that want a luminous ink. ─────── */

export const NIGHT = "#0f0d23";
export const DUSK = "#171432";
export const PLATE = "#1f1b40";
export const HAZE = "#2a2552";

export const STARLIGHT = "#f2eefc";
export const MOTH = "#b5aed6";
export const FAINT = "#837daa";

export const EMBER = "#ff8e5e";
export const EMBER_DEEP = "#b4491f";
export const GOLD = "#ffc46b";

export const AURORA = "#3ee6c0";
export const AURORA_DEEP = "#0e7a63";

export interface MomentInk {
  name: string;
  /** The luminous ink — markers, lines, accents on dark plates (the splat stage). */
  base: string;
  /** The pressed ink — the same pigment stamped on paper. Use on cream. */
  deep: string;
  /** 12%-alpha wash of the luminous ink for halos on dark grounds (rgba string). */
  glow: string;
  /** 8%-alpha wash of the pressed ink for tints on paper (hex + alpha). */
  wash: string;
}

const withGlow = (name: string, base: string, deep: string): MomentInk => {
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);
  return { name, base, deep, glow: `rgba(${r}, ${g}, ${b}, 0.12)`, wash: `${deep}14` };
};

export const INK_EMBER = withGlow("ember", EMBER, EMBER_DEEP);
export const INK_GOLD = withGlow("gold", GOLD, "#a06a14");
export const INK_AURORA = withGlow("aurora", AURORA, AURORA_DEEP);
export const INK_ORCHID = withGlow("orchid", "#ee6fae", "#a72d6a");
export const INK_LILAC = withGlow("lilac", "#9d8bfa", "#5a48c9");
export const INK_SKY = withGlow("sky", "#6cc5ff", "#1e6ca8");

/** Every moment owns one ink, cycled by index — luminous on plates, pressed on paper. */
export const MOMENT_INKS: MomentInk[] = [
  INK_EMBER,
  INK_AURORA,
  INK_LILAC,
  INK_GOLD,
  INK_ORCHID,
  INK_SKY,
];

export const inkForMoment = (index: number): MomentInk =>
  MOMENT_INKS[index % MOMENT_INKS.length];

/** Background for the 3D splat stage — the journal's dark pine plate. */
export const CANVAS_BG = PINE;

/* ── AURORA NIGHT — the original landing at `/` ──────────────────────────────
 *
 * The second palette, mirroring the @theme block of the same name in
 * globals.css. Same contract as everything above: change one, change both.
 *
 * Only what is drawn OUTSIDE the DOM needs literals, which here is the brand
 * glyph — SparkMark is an <svg> and cannot take a Tailwind class on a `fill`.
 * Everything else in the aurora landing goes through utilities.
 */
export const BRAND = {
  300: "#ffc45c",
  400: "#f5a623",
  500: "#d98613",
  600: "#a8620a",
} as const;

export const MACHINE = {
  300: "#7ff0e2",
  400: "#2dd4bf",
  500: "#14b8a6",
  600: "#0d9488",
} as const;

/** ready · reconstructing · stand-in data · failed. */
export const STATE = {
  signal: "#34d399",
  signalDim: "#10b981",
  compute: "#a78bfa",
  warn: "#facc15",
  fail: "#fb7185",
} as const;
