/**
 * Procedural keyframe stand-ins, in the NIGHT WALK poster language.
 *
 * The robot's real frames do not exist tonight, so every Keyframe carries a
 * `placeholderSeed` and we print a little twilight scene from it: stacked
 * soft arches, a low moon or sun, hill silhouettes, and film grain — the same
 * luminous inks as the rest of the app, so a stand-in thumbnail reads as part
 * of the poster rather than as a gray box. Drop a real `url` on the Keyframe
 * and this is never called.
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

/** Hue buckets → twilight scene palettes (see lib/theme.ts). */
function paletteFor(hue: number): ScenePalette {
  if (hue >= 150 && hue < 240)
    // water — the lake holding the last blue of the sky
    return { sky: "#1c2c54", arch1: "#2b4a7a", arch2: "#1e6ca8", ground: "#0b1226", sun: "#f2eefc", blob: "#6cc5ff" };
  if (hue >= 240 || hue < 25)
    // dusk / indoor — violets under lamplight
    return { sky: "#2a2552", arch1: "#5a48c9", arch2: "#9d8bfa", ground: "#171432", sun: "#ffc46b", blob: "#ee6fae" };
  if (hue >= 25 && hue < 60)
    // golden hour — the ember band low on the horizon
    return { sky: "#573158", arch1: "#b4491f", arch2: "#ff8e5e", ground: "#2a1836", sun: "#ffc46b", blob: "#ee6fae" };
  // park / field — aurora greens going dark
  return { sky: "#1d3050", arch1: "#14565a", arch2: "#2bb493", ground: "#10233c", sun: "#ffc46b", blob: "#3ee6c0" };
}

export function placeholderDataUri({
  seed,
  width = 640,
  height = 400,
  hue = SCENE_HUES.park,
}: PlaceholderOptions): string {
  const r = makeRng(seed);
  const p = paletteFor(((hue % 360) + 360) % 360);
  const horizon = rngRange(r, 0.5, 0.64) * height;

  // Stars — the sky remembers where the light was.
  const stars = Array.from({ length: 26 }, () => {
    const cx = rngRange(r, 0.02, 0.98) * width;
    const cy = rngRange(r, 0.03, 0.85) * horizon;
    const rad = rngRange(r, 0.6, 1.9);
    const op = rngRange(r, 0.25, 0.85);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="#f2eefc" opacity="${op.toFixed(2)}"/>`;
  }).join("");

  // A low moon (or last sun) with a soft halo.
  const sunX = rngRange(r, 0.18, 0.82) * width;
  const sunY = rngRange(r, 0.25, 0.55) * horizon;
  const sunR = rngRange(r, 0.05, 0.085) * width;

  // Rolling hill silhouettes — two dark bands behind the ground.
  const hill = (y: number, fill: string, op: number) => {
    const h1 = rngRange(r, 0.06, 0.16) * height;
    const h2 = rngRange(r, 0.04, 0.14) * height;
    const mid = rngRange(r, 0.3, 0.7) * width;
    return `<path d="M0 ${(y + h1).toFixed(1)} Q ${(mid / 2).toFixed(1)} ${(y - h1 * 0.4).toFixed(1)} ${mid.toFixed(1)} ${y.toFixed(1)} T ${width} ${(y - h2 * 0.3).toFixed(1)} V ${height} H 0 Z" fill="${fill}" opacity="${op}"/>`;
  };

  // Soft arches on the horizon — treetops holding the last color.
  const arches = Array.from({ length: 4 }, (_, i) => {
    const cx = rngRange(r, 0.1, 0.9) * width;
    const rad = rngRange(r, 0.12, 0.26) * width;
    const fill = i % 2 === 0 ? p.arch1 : p.arch2;
    return `<circle cx="${cx.toFixed(1)}" cy="${(horizon + rad * 0.7).toFixed(1)}" r="${rad.toFixed(1)}" fill="${fill}" opacity="0.7"/>`;
  }).join("");

  // Foreground silhouettes — the subjects you can't quite make out.
  const blobs = Array.from({ length: 3 }, () => {
    const cx = rngRange(r, 0.08, 0.92) * width;
    const cy = rngRange(r, 0.9, 1.06) * height;
    const rad = rngRange(r, 0.09, 0.17) * width;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${p.blob}" opacity="0.55"/>`;
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
<radialGradient id="halo${uid}" cx="50%" cy="50%" r="50%">
<stop offset="0%" stop-color="${p.sun}" stop-opacity="0.5"/>
<stop offset="100%" stop-color="${p.sun}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="after${uid}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${p.sky}" stop-opacity="0"/>
<stop offset="100%" stop-color="${p.sun}" stop-opacity="0.28"/>
</linearGradient>
<clipPath id="c${uid}"><rect width="${width}" height="${height}"/></clipPath>
</defs>
<g clip-path="url(#c${uid})">
<rect width="${width}" height="${height}" fill="${p.sky}"/>
<rect x="0" y="0" width="${width}" height="${horizon.toFixed(1)}" fill="url(#after${uid})"/>
${stars}
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${(sunR * 3.2).toFixed(1)}" fill="url(#halo${uid})"/>
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${p.sun}"/>
${arches}
${hill(horizon * 0.98, p.arch1, 0.45)}
${hill(horizon * 1.06, p.ground, 1)}
${blobs}
<rect width="${width}" height="${height}" filter="url(#g${uid})" opacity="0.22"/>
</g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ""))}`;
}
