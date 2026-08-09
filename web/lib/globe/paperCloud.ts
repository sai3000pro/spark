/**
 * Earth, stippled in the journal's inks.
 *
 * The desk globe's point cloud — the same fibonacci-sphere + distance-to-coast
 * sampling as the retired dark globe (lib/globe/globePoints.ts), re-inked for
 * paper: coasts crisp in PINE, interiors in a LAGOON wash lightened toward the
 * page, the way an engraver stipples a plate. No day/night terminator — ink
 * has no night side.
 *
 * Pure and deterministic: no `three`, no `next`, typed arrays out. The pocket
 * globe asks for a coarse cloud, the full plate for a fine one.
 */
import { geoToVec3, vec3ToGeo } from "./geo";
import { coastCells, getLandMask, isLand } from "./mask";
import { LAGOON, PAPER, PINE } from "../theme";
import type { GeoPoint } from "../types";

export interface PaperCloud {
  /** On the unit sphere. */
  positions: Float32Array;
  colors: Float32Array;
  /** World-space radius; the shader converts to pixels. */
  sizes: Float32Array;
  /** 1 at the shore → 0 deep inland. Drives per-point opacity. */
  shore: Float32Array;
  count: number;
}

/** Interior fades out over this many mask cells from the coast. */
const COAST_FALLOFF_CELLS = 6;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The coastline's ink — PINE lifted toward LAGOON so the stipple reads a
    shade lighter than pressed-black. */
const COAST: Rgb = mix(hexToRgb(PINE), hexToRgb(LAGOON), 0.35);
/** LAGOON, lightened toward the paper — the interior wash. */
const INTERIOR: Rgb = mix(hexToRgb(LAGOON), hexToRgb(PAPER), 0.32);

export function buildPaperCloud(opts: { samples?: number } = {}): PaperCloud {
  const samples = opts.samples ?? 110_000;
  const mask = getLandMask();

  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const shore: number[] = [];

  for (let i = 0; i < samples; i++) {
    // Fibonacci sphere, unjittered: uniform density at every latitude, and the
    // lattice's even spacing is the look — a plate stippled by a steady hand,
    // not sprayed. The dots are sized to nearly touch, so landmasses read as
    // solid shapes at a glance and dissolve into points up close.
    const y = 1 - (2 * (i + 0.5)) / samples;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);

    const { lat, lng } = vec3ToGeo([x, y, z]);
    if (!isLand(mask, lat, lng)) continue;

    const depth = Math.min(1, coastCells(mask, lat, lng) / COAST_FALLOFF_CELLS);
    // 1.0 at the shore, ~0.37 six cells in — coastlines carry the read.
    const coastFactor = Math.exp(-depth);

    positions.push(x, y, z);
    // ~110k samples space ~0.011 world units apart; a ~0.010–0.013 sprite
    // (gaussian core ≈ half that) closes most of the gap between neighbours.
    sizes.push(lerp(0.0095, 0.0125, coastFactor));
    shore.push(coastFactor);

    colors.push(
      lerp(INTERIOR[0], COAST[0], coastFactor),
      lerp(INTERIOR[1], COAST[1], coastFactor),
      lerp(INTERIOR[2], COAST[2], coastFactor),
    );
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    sizes: new Float32Array(sizes),
    shore: new Float32Array(shore),
    count: sizes.length,
  };
}

/**
 * A great-circle arc between two origins, as points just above the surface —
 * the expedition line hopping between walks. Slerp between the endpoint
 * vectors; the segment count scales with the angle so short hops and
 * transatlantic legs get the same dot spacing.
 */
export function voyageArcPoints(a: GeoPoint, b: GeoPoint, radius = 1.012): Float32Array {
  const va = geoToVec3(a);
  const vb = geoToVec3(b);
  const dot = Math.min(
    1,
    Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]),
  );
  const omega = Math.acos(dot);
  // ~one dot per 1.2° of arc, at least 8 so a short hop still reads as dashed.
  const steps = Math.max(8, Math.round(omega / (1.2 * (Math.PI / 180))));
  const out = new Float32Array((steps + 1) * 3);

  const sinOmega = Math.sin(omega) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ka = Math.sin((1 - t) * omega) / sinOmega;
    const kb = Math.sin(t * omega) / sinOmega;
    const x = ka * va[0] + kb * vb[0];
    const y = ka * va[1] + kb * vb[1];
    const z = ka * va[2] + kb * vb[2];
    const norm = radius / (Math.hypot(x, y, z) || 1);
    out[i * 3] = x * norm;
    out[i * 3 + 1] = y * norm;
    out[i * 3 + 2] = z * norm;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
