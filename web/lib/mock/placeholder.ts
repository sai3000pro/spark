/**
 * Procedural keyframe stand-ins.
 *
 * The robot's real frames do not exist tonight, so every Keyframe carries a
 * `placeholderSeed` and we synthesize a soft, out-of-focus scene from it: sky
 * gradient, horizon, a few blurred subject blobs, vignette. It reads as "a photo
 * you can't quite make out yet" rather than as a grey box, which keeps the
 * layout honest. Drop a real `url` on the Keyframe and this is never called.
 *
 * Pure string generation — safe on server and client, no network, no canvas.
 */
import { makeRng, rngRange } from "./rng";

export interface PlaceholderOptions {
  seed: number;
  width?: number;
  height?: number;
  /** Base hue in degrees. Pick per-moment so each scene is recognizable. */
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

export function placeholderDataUri({
  seed,
  width = 640,
  height = 400,
  hue = SCENE_HUES.park,
}: PlaceholderOptions): string {
  const r = makeRng(seed);
  const horizon = rngRange(r, 0.5, 0.68);
  const skyLight = rngRange(r, 62, 74);
  const groundDark = rngRange(r, 16, 26);
  const hueShift = rngRange(r, -14, 14);

  const blobs = Array.from({ length: 4 }, () => {
    const cx = rngRange(r, 0.08, 0.92) * width;
    const cy = rngRange(r, horizon - 0.18, horizon + 0.24) * height;
    const rad = rngRange(r, 0.06, 0.19) * width;
    const l = rngRange(r, 24, 68);
    const h = hue + rngRange(r, -40, 40);
    const op = rngRange(r, 0.35, 0.72);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="hsl(${h.toFixed(0)} 42% ${l.toFixed(0)}%)" opacity="${op.toFixed(2)}"/>`;
  }).join("");

  // Suggestion of depth: a couple of horizontal bands near the horizon.
  const bands = Array.from({ length: 3 }, (_, i) => {
    const y = (horizon + 0.04 + i * 0.07) * height;
    const op = 0.16 - i * 0.04;
    return `<rect x="0" y="${y.toFixed(1)}" width="${width}" height="${(height * 0.05).toFixed(1)}" fill="hsl(${(hue + 20).toFixed(0)} 30% 8%)" opacity="${op.toFixed(2)}"/>`;
  }).join("");

  // A low sun and its wash across the ground. This is what stops the frame reading
  // as a flat colour swatch — one bright anchor plus a directional gradient is most
  // of what makes an out-of-focus photo look like a photo.
  const sunX = rngRange(r, 0.2, 0.8) * width;
  const sunY = rngRange(r, horizon - 0.3, horizon - 0.06) * height;
  const sunR = rngRange(r, 0.1, 0.2) * width;

  // Foliage silhouettes on the horizon, dark against the sky.
  const canopy = Array.from({ length: 7 }, (_, i) => {
    const cx = ((i + rngRange(r, 0.1, 0.9)) / 7) * width;
    const rad = rngRange(r, 0.05, 0.13) * width;
    const cy = horizon * height - rad * rngRange(r, 0.15, 0.5);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}"/>`;
  }).join("");

  // Per-seed suffix on every <defs> id. Not needed while these are consumed as
  // `<img src="data:…">` (each is its own document), but it makes the markup safe
  // to inline directly into a page later, where ids are document-global.
  const uid = `p${Math.abs(seed | 0).toString(36)}${Math.round(hue)}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="sky${uid}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${(hue + hueShift - 10).toFixed(0)} 44% ${(skyLight * 0.72).toFixed(0)}%)"/>
<stop offset="${(horizon * 0.62).toFixed(3)}" stop-color="hsl(${(hue + hueShift).toFixed(0)} 40% ${skyLight.toFixed(0)}%)"/>
<stop offset="${horizon.toFixed(3)}" stop-color="hsl(${(hue + hueShift + 14).toFixed(0)} 32% ${(skyLight * 0.5).toFixed(0)}%)"/>
<stop offset="1" stop-color="hsl(${(hue + hueShift + 26).toFixed(0)} 28% ${groundDark.toFixed(0)}%)"/>
</linearGradient>
<radialGradient id="sun${uid}" cx="0.5" cy="0.5" r="0.5">
<stop offset="0" stop-color="hsl(${(hue + 40).toFixed(0)} 70% 88%)" stop-opacity="0.85"/>
<stop offset="0.45" stop-color="hsl(${(hue + 30).toFixed(0)} 60% 72%)" stop-opacity="0.35"/>
<stop offset="1" stop-color="hsl(${(hue + 20).toFixed(0)} 55% 62%)" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vig${uid}" cx="0.5" cy="0.46" r="0.78">
<stop offset="0.4" stop-color="#000" stop-opacity="0"/>
<stop offset="1" stop-color="#09090e" stop-opacity="0.62"/>
</radialGradient>
<filter id="soft${uid}" x="-25%" y="-25%" width="150%" height="150%">
<feGaussianBlur stdDeviation="${(width * 0.03).toFixed(1)}"/>
</filter>
<filter id="haze${uid}" x="-25%" y="-25%" width="150%" height="150%">
<feGaussianBlur stdDeviation="${(width * 0.012).toFixed(1)}"/>
</filter>
</defs>
<rect width="${width}" height="${height}" fill="url(#sky${uid})"/>
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="url(#sun${uid})"/>
<g filter="url(#haze${uid})" fill="hsl(${(hue + 30).toFixed(0)} 34% 9%)" opacity="0.72">${canopy}</g>
<g filter="url(#soft${uid})">${blobs}</g>
${bands}
<rect width="${width}" height="${height}" fill="url(#vig${uid})"/>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ""))}`;
}
