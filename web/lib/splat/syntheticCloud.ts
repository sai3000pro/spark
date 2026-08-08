/**
 * Builds a point cloud that stands in for a Gaussian splat reconstruction.
 *
 * It is NOT fake data dressed up as a capture — it is derived entirely from the
 * moment's real object sightings: every colored cluster sits at an object's
 * back-projected `worldPos`, so poking around it tells you something true about
 * where things were. What's synthesized is only the surrounding geometry (ground,
 * treeline, sky) that a real reconstruction would have filled in.
 *
 * Pure and deterministic — no three.js import, returns typed arrays ready for a
 * BufferGeometry. Same seed, same cloud, every reload.
 */
import { colorForLabel } from "../mock/labels";
import { makeRng, rngRange, type Rng } from "../mock/rng";
import type { ObjectSighting, Vec2, Vec3 } from "../types";

export interface CloudResult {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  count: number;
  /** Object anchors in the same local frame, for clickable markers. */
  anchors: Array<{ trackId: string; label: string; pos: Vec3; confidence: number }>;
  radius: number;
}

/** How wide a cluster should be, per label — a bench spreads, a cup does not. */
const CLUSTER_SIGMA: Record<string, number> = {
  person: 0.34,
  bench: 0.62,
  "dining table": 0.66,
  bicycle: 0.5,
  chair: 0.3,
  bottle: 0.09,
  cup: 0.07,
  backpack: 0.18,
  "cell phone": 0.06,
  laptop: 0.16,
  bird: 0.11,
  dog: 0.22,
  frisbee: 0.09,
  "sports ball": 0.08,
  kite: 0.3,
  "potted plant": 0.24,
  sandwich: 0.09,
};

const CLUSTER_POINTS: Record<string, number> = {
  person: 900,
  bench: 700,
  "dining table": 700,
  bicycle: 600,
};

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** Gaussian sample via Box–Muller — clusters should fall off, not have edges. */
function gauss(r: Rng): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export interface BuildCloudOptions {
  objects: ObjectSighting[];
  /** The moment's place, so park-frame worldPos can be re-centred on the origin. */
  center: Vec2;
  /** Scene hue in degrees, for ground and foliage tint. */
  hue?: number;
  seed?: number;
  radius?: number;
}

export function buildSyntheticCloud({
  objects,
  center,
  hue = 105,
  seed = 7,
  radius = 11,
}: BuildCloudOptions): CloudResult {
  const r = makeRng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const siz: number[] = [];

  const push = (x: number, y: number, z: number, c: [number, number, number], s: number) => {
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2]);
    siz.push(s);
  };

  // Ground plane. Density falls off toward the edge so the disc has no hard rim.
  const groundBase = hslToRgb(hue + 12, 0.24, 0.25);
  const GROUND_POINTS = 12000;
  for (let i = 0; i < GROUND_POINTS; i++) {
    const a = r() * Math.PI * 2;
    const rad = radius * Math.sqrt(r());
    const shade = 0.7 + r() * 0.6;
    push(
      Math.cos(a) * rad,
      -0.02 + gauss(r) * 0.035,
      Math.sin(a) * rad,
      [groundBase[0] * shade, groundBase[1] * shade, groundBase[2] * shade],
      rngRange(r, 0.04, 0.08),
    );
  }

  // Treeline / structure around the edge, so orbiting reveals depth instead of
  // an empty void behind the subjects.
  const foliage = hslToRgb(hue + 26, 0.32, 0.24);
  const TREES = 9;
  for (let t = 0; t < TREES; t++) {
    const a = (t / TREES) * Math.PI * 2 + rngRange(r, -0.28, 0.28);
    const dist = rngRange(r, radius * 0.72, radius * 1.02);
    const cx = Math.cos(a) * dist;
    const cz = Math.sin(a) * dist;
    const height = rngRange(r, 2.6, 5.4);
    for (let i = 0; i < 700; i++) {
      const h = Math.pow(r(), 0.55) * height;
      // Canopy widens with height, trunk stays tight.
      const spread = h < height * 0.35 ? 0.1 : 0.5 + (h / height) * 1.15;
      const shade = 0.6 + r() * 0.7;
      push(
        cx + gauss(r) * spread,
        h,
        cz + gauss(r) * spread,
        [foliage[0] * shade, foliage[1] * shade, foliage[2] * shade],
        rngRange(r, 0.055, 0.11),
      );
    }
  }

  // Sparse dome — reads as sky haze and keeps the scene from feeling like a floor.
  const sky = hslToRgb(hue, 0.26, 0.38);
  for (let i = 0; i < 1400; i++) {
    const a = r() * Math.PI * 2;
    const el = rngRange(r, 0.12, 1.15);
    const rad = radius * rngRange(r, 1.05, 1.5);
    const fade = rngRange(r, 0.25, 0.6);
    push(
      Math.cos(a) * rad,
      Math.sin(el) * radius * 0.85,
      Math.sin(a) * rad,
      [sky[0] * fade, sky[1] * fade, sky[2] * fade],
      rngRange(r, 0.07, 0.14),
    );
  }

  // The real content: one cluster per tracked object, at its back-projected spot.
  const anchors: CloudResult["anchors"] = [];
  for (const o of objects) {
    if (!o.worldPos) continue;
    const local: Vec3 = [o.worldPos[0] - center[0], o.worldPos[1], o.worldPos[2] - center[1]];
    const base = hexToRgb(colorForLabel(o.label));
    const sigma = CLUSTER_SIGMA[o.label] ?? 0.2;
    const n = CLUSTER_POINTS[o.label] ?? 420;

    // Confidence shows up as cluster crispness: a shaky detection makes a fuzzy
    // blob, a confident one makes a tight object. Honest, and it looks right.
    const looseness = 1 + (1 - o.confidence) * 1.5;

    for (let i = 0; i < n; i++) {
      const shade = 0.62 + r() * 0.62;
      push(
        local[0] + gauss(r) * sigma * looseness,
        Math.max(0, local[1] + gauss(r) * sigma * looseness * 0.85),
        local[2] + gauss(r) * sigma * looseness,
        [base[0] * shade, base[1] * shade, base[2] * shade],
        rngRange(r, 0.06, 0.115),
      );
    }

    anchors.push({ trackId: o.trackId, label: o.label, pos: local, confidence: o.confidence });
  }

  return {
    positions: new Float32Array(pos),
    colors: new Float32Array(col),
    sizes: new Float32Array(siz),
    count: siz.length,
    anchors,
    radius,
  };
}

/** hsl (deg, 0..1, 0..1) → linear-ish rgb 0..1. Good enough for point tinting. */
function hslToRgb(hDeg: number, s: number, l: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}
