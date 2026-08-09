/**
 * Earth as a point cloud.
 *
 * Spark perceives the world as points, so Spark's Earth is made of them — the
 * globe reuses the same custom-shader `<points>` machinery as the splat stage,
 * which is what makes the app's two 3D screens read as one system rather than two
 * unrelated demos.
 *
 * Pure and deterministic, mirroring lib/splat/syntheticCloud.ts: no `three`, no
 * `next`, returns typed arrays. That is what lets verify-pipeline.ts assert
 * against it from the terminal.
 *
 * Two decisions here do most of the visual work:
 *
 *   1. Points sit on a FIBONACCI sphere, not a lat/lng grid. A lat/lng grid
 *      bunches hard at the poles, and that pinched-pole look is the single most
 *      recognisable tell of a tutorial globe.
 *   2. Size and brightness are driven by DISTANCE TO COASTLINE, not by a flat
 *      land/sea test. Continental interiors fade to almost nothing while
 *      coastlines stay crisp, so Antarctica reads as an outline instead of a
 *      giant white cap and Europe stays legible at small sizes.
 */
import { vec3ToGeo } from "./geo";
import { FOG, INK, MACHINE } from "./theme";
import { makeRng, rngRange } from "../mock/rng";
import { coastCells, getLandMask, isLand } from "./mask";

export interface GlobeCloud {
  /** On the unit sphere. */
  positions: Float32Array;
  colors: Float32Array;
  /** World-space radius; the shader converts to pixels. */
  sizes: Float32Array;
  /** 0 at the shore → 1 deep inland. Drives the shader's terminator falloff. */
  inland: Float32Array;
  count: number;
}

export interface StarField {
  positions: Float32Array;
  colors: Float32Array;
  /** Screen-space pixels — stars skip the perspective divide. */
  sizes: Float32Array;
  count: number;
}

/**
 * 48,000 samples over the whole sphere ≈ 0.93° spacing — deliberately COARSER
 * than the mask's 0.703° cells, so the dot pattern can never resolve the mask's
 * stair-stepping. Land is ~29% of the sphere, so ~14k points survive.
 */
const DEFAULT_SAMPLES = 48_000;

/** Interior fades out over this many cells from the coast. */
const COAST_FALLOFF_CELLS = 6;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function buildGlobeCloud(opts: { samples?: number } = {}): GlobeCloud {
  const samples = opts.samples ?? DEFAULT_SAMPLES;
  const mask = getLandMask();

  // Derived from the palette rather than added to it — see the "change one,
  // change both" rule in lib/theme.ts. These are not new tokens.
  const coastColor = hexToRgb(FOG[200]);
  const interiorColor = scale(hexToRgb(INK[500]), 0.72);

  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const inland: number[] = [];

  for (let i = 0; i < samples; i++) {
    // Fibonacci sphere: uniform density at every latitude.
    const y = 1 - (2 * (i + 0.5)) / samples;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);

    const { lat, lng } = vec3ToGeo([x, y, z]);
    if (!isLand(mask, lat, lng)) continue;

    const depth = Math.min(1, coastCells(mask, lat, lng) / COAST_FALLOFF_CELLS);
    // exp(-depth): 1.0 at the shore, ~0.37 six cells in, ~0 deep inland.
    const coastFactor = Math.exp(-depth);

    positions.push(x, y, z);
    sizes.push(lerp(0.0038, 0.0062, coastFactor));
    inland.push(1 - coastFactor);

    colors.push(
      lerp(interiorColor[0], coastColor[0], coastFactor),
      lerp(interiorColor[1], coastColor[1], coastFactor),
      lerp(interiorColor[2], coastColor[2], coastFactor),
    );
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    sizes: new Float32Array(sizes),
    inland: new Float32Array(inland),
    count: sizes.length,
  };
}

/**
 * Fibonacci again, not random placement: a uniformly-random star field visibly
 * clumps, and the clumps read as a bug. Seeded jitter varies size and tint.
 *
 * No twinkling. An animated star field is the second-most reliable tell of a
 * demo, right after a pulsing atmosphere.
 */
export function buildStarField(
  opts: { count?: number; radius?: number; seed?: number } = {},
): StarField {
  const count = opts.count ?? 900;
  const radius = opts.radius ?? 60;
  const rng = makeRng(opts.seed ?? 4177);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const dim = hexToRgb(FOG[400]);
  const bright = hexToRgb(FOG[200]);
  const tint = hexToRgb(MACHINE[300]);

  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;

    positions[i * 3] = r * Math.cos(theta) * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = r * Math.sin(theta) * radius;

    const warmth = rngRange(rng, 0, 1);
    // 6% carry the machine teal — just enough that the field feels instrumented.
    const base = rng() < 0.06 ? tint : mix(dim, bright, warmth);
    colors[i * 3] = base[0];
    colors[i * 3 + 1] = base[1];
    colors[i * 3 + 2] = base[2];

    sizes[i] = rngRange(rng, 1.0, 2.2);
  }

  return { positions, colors, sizes, count };
}

// ─────────────────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
