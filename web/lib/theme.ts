/**
 * Raw theme hexes for SVG, canvas and WebGL.
 *
 * Tailwind classes can't set an SVG `fill`/`stroke` attribute or a THREE.Color,
 * so the map, the pipeline timeline and the splat stage need the literal values.
 * This file mirrors the @theme block in app/globals.css — change one, change both.
 *
 * Label-family colors live in lib/mock/labels.ts instead, because those are a
 * validated categorical scale rather than part of the brand palette.
 */
export const INK = {
  950: "#0b0f1e",
  900: "#111624",
  850: "#151a2a",
  800: "#191e30",
  700: "#1b2133",
  600: "#23293e",
  500: "#353c55",
} as const;

export const FOG = {
  400: "#6b6880",
  300: "#a8a3c2",
  200: "#c8c4dc",
  100: "#e8e6f0",
} as const;

/**
 * The brand. Interactive chrome ONLY — solid fills on primary actions, rings on
 * interactive surfaces, focus rings, the brand glyph.
 *
 * Deliberately NOT a data colour, despite sitting only ΔE 5.5 from MEMORY[400].
 * See the rule in app/globals.css: brand orange is a form, memory amber is a
 * category, and the two can never appear in the same visual field.
 */
export const BRAND = {
  300: "#ffc45c",
  400: "#f5a623",
  500: "#d98613",
  600: "#a8620a",
} as const;

/** Cool — the robot layer. */
export const MACHINE = {
  300: "#7ff0e2",
  400: "#2dd4bf",
  500: "#14b8a6",
  600: "#0d9488",
} as const;

/** Warm — the human layer. */
export const MEMORY = {
  300: "#fdba74",
  400: "#f59e0b",
  500: "#d97706",
  600: "#b45309",
} as const;

export const STATE = {
  signal: "#34d399",
  signalDim: "#10b981",
  compute: "#a78bfa",
  warn: "#facc15",
  fail: "#fb7185",
} as const;

/** Background for the 3D stage and for punching holes in SVG marks. */
export const CANVAS_BG = INK[950];
