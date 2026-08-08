/**
 * Raw theme hexes for SVG, canvas and WebGL — the RISO ATLAS palette.
 *
 * Tailwind classes can't set an SVG `fill`/`stroke` attribute or a THREE.Color,
 * so the map, the pins and the splat stage need the literal values. This file
 * mirrors the @theme block in app/globals.css — change one, change both.
 */
export const CREAM = "#f6eedd";
export const CREAM_BRIGHT = "#fdf8ec";
export const CREAM_DEEP = "#ece1c8";

export const INK = "#232038";
export const INK_SOFT = "#56536e";
export const INK_FAINT = "#767390";

export interface RisoInk {
  name: string;
  /** The drum ink itself — fills, pins, blocks. */
  base: string;
  /** Text-safe / pressed version. */
  deep: string;
  /** The tint — soft grounds, halos. */
  soft: string;
}

export const VIOLET: RisoInk = { name: "violet", base: "#5b3df0", deep: "#4227c8", soft: "#d9d0f8" };
export const CORAL: RisoInk = { name: "coral", base: "#ef5b3c", deep: "#bc3a1e", soft: "#f9cfc2" };
export const TEAL: RisoInk = { name: "teal", base: "#1ba098", deep: "#0f6b66", soft: "#bfe5df" };
export const MUSTARD: RisoInk = { name: "mustard", base: "#f4b841", deep: "#92670a", soft: "#fae3ad" };
export const ROSE: RisoInk = { name: "rose", base: "#e9718f", deep: "#b03a58", soft: "#f8d3db" };
export const SKY: RisoInk = { name: "sky", base: "#6db5d8", deep: "#2a6f94", soft: "#cfe7f2" };

/** Every moment on the map owns one drum ink, cycled by index. */
export const MOMENT_INKS: RisoInk[] = [CORAL, TEAL, VIOLET, MUSTARD, ROSE, SKY];

export const inkForMoment = (index: number): RisoInk =>
  MOMENT_INKS[index % MOMENT_INKS.length];

/** The night plate — where the splats live. */
export const NAVY = "#1d2145";
export const NAVY_DEEP = "#141732";

/** Background for the 3D stage. */
export const CANVAS_BG = NAVY_DEEP;
