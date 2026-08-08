/**
 * Raw theme hexes for SVG, canvas, WebGL and MapLibre — the NIGHT WALK palette.
 *
 * Tailwind classes can't set an SVG `fill`, a THREE.Color or a map-style paint
 * property, so everything drawn outside the DOM needs the literal values. This
 * file mirrors the @theme block in app/globals.css — change one, change both.
 * scripts/build-map-style.mjs imports these values when regenerating the map.
 */

/** Grounds — indigo-violet, never gray-black. */
export const NIGHT = "#0f0d23";
export const DUSK = "#171432";
export const PLATE = "#1f1b40";
export const HAZE = "#2a2552";

/** Text on dark. FAINT is metadata-only. */
export const STARLIGHT = "#f2eefc";
export const MOTH = "#b5aed6";
export const FAINT = "#837daa";

/** The afterglow — ember is THE accent, gold its highlight twin. */
export const EMBER = "#ff8e5e";
export const EMBER_DEEP = "#b4491f";
export const GOLD = "#ffc46b";

/** Live/measured semantics only. */
export const AURORA = "#3ee6c0";
export const AURORA_DEEP = "#0e7a63";

export interface MomentInk {
  name: string;
  /** The luminous ink itself — markers, lines, accents on dark. */
  base: string;
  /** Pressed / text-on-light version. */
  deep: string;
  /** 12%-alpha wash for halos and washes (rgba string). */
  glow: string;
}

const withGlow = (name: string, base: string, deep: string): MomentInk => {
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);
  return { name, base, deep, glow: `rgba(${r}, ${g}, ${b}, 0.12)` };
};

export const INK_EMBER = withGlow("ember", EMBER, EMBER_DEEP);
export const INK_GOLD = withGlow("gold", GOLD, "#a06a14");
export const INK_AURORA = withGlow("aurora", AURORA, AURORA_DEEP);
export const INK_ORCHID = withGlow("orchid", "#ee6fae", "#a72d6a");
export const INK_LILAC = withGlow("lilac", "#9d8bfa", "#5a48c9");
export const INK_SKY = withGlow("sky", "#6cc5ff", "#1e6ca8");

/** Every moment owns one luminous ink, cycled by index. */
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

/** Background for the 3D splat stage — one step below the page ground. */
export const CANVAS_BG = "#0a0919";
