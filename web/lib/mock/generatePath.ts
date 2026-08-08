/**
 * Robot odometry. Built by walking between stops so that every moment pin
 * provably lies ON the path — if the map showed a moment off the route, the
 * whole "the robot followed you" premise falls apart visually.
 *
 * Dwell (near-zero speed) during a stop is what the `dwell` trigger detects, so
 * this file is also feeding the candidate scorer.
 */
import type { TrackPoint, Vec2 } from "../types";
import { makeRng, rngJitter, type Rng } from "./rng";

export interface Stop {
  pos: Vec2;
  /** When the robot arrives and stops moving. */
  arriveT: number;
  /** When it starts moving again. */
  departT: number;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Smoothstep so the robot accelerates and decelerates instead of snapping. */
const ease = (u: number) => u * u * (3 - 2 * u);

export function generatePath(
  stops: Stop[],
  durationSec: number,
  sampleSec = 8,
  seed = 4242,
): TrackPoint[] {
  const r = makeRng(seed);
  const points: TrackPoint[] = [];

  // Per-leg lateral wander amplitude, so no two legs bend the same way.
  const legWander = stops.map(() => rngJitter(r, 16));

  for (let t = 0; t <= durationSec; t += sampleSec) {
    points.push({ t, pos: positionAt(t, stops, legWander, r), heading: 0, speed: 0 });
  }
  if (points[points.length - 1].t !== durationSec) {
    points.push({
      t: durationSec,
      pos: positionAt(durationSec, stops, legWander, r),
      heading: 0,
      speed: 0,
    });
  }

  // Derive heading and speed from the sampled positions rather than inventing them,
  // so they can never disagree with the drawn path.
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.pos[0] - prev.pos[0];
    const dy = next.pos[1] - prev.pos[1];
    const dt = Math.max(1e-6, next.t - prev.t);
    points[i].heading = Number(Math.atan2(dy, dx).toFixed(4));
    points[i].speed = Number((Math.hypot(dx, dy) / dt).toFixed(4));
  }

  return points;
}

function positionAt(t: number, stops: Stop[], legWander: number[], r: Rng): Vec2 {
  // Before the first stop / after the last: hold.
  if (t <= stops[0].departT) return jitterPos(stops[0].pos, r, 0.25);
  const last = stops[stops.length - 1];
  if (t >= last.arriveT) return jitterPos(last.pos, r, 0.25);

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];

    // Dwelling at `from`.
    if (t >= from.arriveT && t <= from.departT) return jitterPos(from.pos, r, 0.25);

    // In transit from → to.
    if (t > from.departT && t < to.arriveT) {
      const u = ease((t - from.departT) / Math.max(1e-6, to.arriveT - from.departT));
      const x = lerp(from.pos[0], to.pos[0], u);
      const y = lerp(from.pos[1], to.pos[1], u);

      // Bow the leg sideways so walking looks like walking, not surveying.
      const dx = to.pos[0] - from.pos[0];
      const dy = to.pos[1] - from.pos[1];
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.sin(Math.PI * u) * legWander[i];
      return [
        Number((x + (-dy / len) * bow + rngJitter(r, 0.7)).toFixed(2)),
        Number((y + (dx / len) * bow + rngJitter(r, 0.7)).toFixed(2)),
      ];
    }
  }

  return jitterPos(last.pos, r, 0.25);
}

/** Stationary robots still drift a little — keeps speed from being exactly zero. */
const jitterPos = (pos: Vec2, r: Rng, mag: number): Vec2 => [
  Number((pos[0] + rngJitter(r, mag)).toFixed(2)),
  Number((pos[1] + rngJitter(r, mag)).toFixed(2)),
];

export function pathDistanceM(path: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    d += Math.hypot(path[i].pos[0] - path[i - 1].pos[0], path[i].pos[1] - path[i - 1].pos[1]);
  }
  return d;
}

/** Closest path sample to a world position — used to build robot nav targets. */
export function nearestPathPoint(path: TrackPoint[], pos: Vec2): TrackPoint {
  let best = path[0];
  let bestD = Infinity;
  for (const p of path) {
    const d = Math.hypot(p.pos[0] - pos[0], p.pos[1] - pos[1]);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
