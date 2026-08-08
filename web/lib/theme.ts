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
  950: "#09090e",
  900: "#111118",
  850: "#16161f",
  800: "#1a1a24",
  700: "#1e1b2e",
  600: "#272433",
  500: "#3a3550",
} as const;

export const FOG = {
  400: "#6b6880",
  300: "#a8a3c2",
  200: "#c8c4dc",
  100: "#e8e6f0",
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
