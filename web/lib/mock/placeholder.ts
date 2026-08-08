/**
 * Procedural keyframe stand-ins, in the riso poster language.
 *
 * The robot's real frames do not exist tonight, so every Keyframe carries a
 * `placeholderSeed` and we print a little risograph scene from it: stacked
 * soft arches, a sun, hill blobs, and film grain — the same drum inks as the
 * rest of the app, so a stand-in thumbnail reads as part of the poster rather
 * than as a gray box. Drop a real `url` on the Keyframe and this is never
 * called.
 *
 * Pure string generation — safe on server and client, no network, no canvas.
 */
import { makeRng, rngRange } from "./rng";

export interface PlaceholderOptions {
  seed: number;
  width?: number;
  height?: number;
  /** Base hue in degrees. Picks the ink pairing so scenes stay distinct. */
  hue?: number;
}

/** Distinct palettes so a lakeside frame never looks like a sunset frame. */
export const SCENE_HUES = {
  water: 195,
  park: 105,
  field: 78,
  golden: 32,
  dusk: 268,
  indoor: 18,
} as const;

export type SceneHue = keyof typeof SCENE_HUES;

interface ScenePalette {
  sky: string;
  arch1: string;
  arch2: string;
  ground: string;
  sun: string;
  blob: string;
}

/** Hue buckets → drum-ink scene palettes (see lib/theme.ts). */
function paletteFor(hue: number): ScenePalette {
  if (hue >= 150 && hue < 240)
    // water — sky blues over teal
    return { sky: "#cfe7f2", arch1: "#6db5d8", arch2: "#2a6f94", ground: "#1ba098", sun: "#fdf8ec", blob: "#0f6b66" };
  if (hue >= 240 || hue < 25)
    // dusk / indoor — violets and roses
    return { sky: "#d9d0f8", arch1: "#e9718f", arch2: "#5b3df0", ground: "#4227c8", sun: "#f4b841", blob: "#b03a58" };
  if (hue >= 25 && hue < 60)
    // golden hour — coral on mustard
    return { sky: "#fae3ad", arch1: "#f4b841", arch2: "#ef5b3c", ground: "#bc3a1e", sun: "#fdf8ec", blob: "#e9718f" };
  // park / field — teals with a mustard sun
  return { sky: "#bfe5df", arch1: "#4eb3a8", arch2: "#1ba098", ground: "#0f6b66", sun: "#f4b841", blob: "#2a6f94" };
}

export function placeholderDataUri({
  seed,
  width = 640,
  height = 400,
  hue = SCENE_HUES.park,
}: PlaceholderOptions): string {
  const r = makeRng(seed);
  const p = paletteFor(((hue % 360) + 360) % 360);
  const horizon = rngRange(r, 0.52, 0.68) * height;

  // Stacked soft arches on the horizon — the "Soft" card move from the poster.
  const arches = Array.from({ length: 4 }, (_, i) => {
    const cx = rngRange(r, 0.1, 0.9) * width;
    const rad = rngRange(r, 0.16, 0.34) * width;
    const fill = i % 2 === 0 ? p.arch1 : p.arch2;
    const op = 0.85 + i * 0.04;
    return `<circle cx="${cx.toFixed(1)}" cy="${(horizon + rad * 0.55).toFixed(1)}" r="${rad.toFixed(1)}" fill="${fill}" opacity="${Math.min(1, op).toFixed(2)}"/>`;
  }).join("");

  // A sun (or moon) punched into the sky.
  const sunX = rngRange(r, 0.18, 0.82) * width;
  const sunY = rngRange(r, 0.16, 0.4) * horizon;
  const sunR = rngRange(r, 0.07, 0.12) * width;

  // Foreground blobs — the subjects you can't quite make out.
  const blobs = Array.from({ length: 3 }, () => {
    const cx = rngRange(r, 0.08, 0.92) * width;
    const cy = rngRange(r, 0.86, 1.04) * height;
    const rad = rngRange(r, 0.1, 0.2) * width;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${p.blob}" opacity="0.9"/>`;
  }).join("");

  // Per-seed suffix on every <defs> id so the markup stays safe to inline.
  const uid = `r${Math.abs(seed | 0).toString(36)}${Math.round(hue)}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<filter id="g${uid}" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch"/>
<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0.9 0.9 0 0"/>
<feComposite operator="in" in2="SourceGraphic"/>
</filter>
<clipPath id="c${uid}"><rect width="${width}" height="${height}"/></clipPath>
</defs>
<g clip-path="url(#c${uid})">
<rect width="${width}" height="${height}" fill="${p.sky}"/>
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${p.sun}"/>
${arches}
<rect x="0" y="${(horizon + height * 0.16).toFixed(1)}" width="${width}" height="${height}" fill="${p.ground}"/>
${blobs}
<rect width="${width}" height="${height}" filter="url(#g${uid})" opacity="0.26"/>
</g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ""))}`;
}
