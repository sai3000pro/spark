/**
 * Street-following odometry for authored routes.
 *
 * `generatePath` (stops + a single bowed leg between them) was honest enough
 * for a park lawn, but a walk through a city has to trace real geometry:
 * along Bathurst, over the rail bridge, around the fort, down the waterfront
 * trail. A route is authored as a chain of segments —
 *
 *   walk   a polyline of waypoints read off the real streets, entered and
 *          left at authored times
 *   dwell  milling around one spot (a moment being lived) — near-zero speed,
 *          which is exactly what the pipeline's `dwell` trigger detects
 *
 * — and this generator turns it into a dense, believably-noisy track:
 *
 *   · movement follows the polyline by arc length, eased per segment so the
 *     robot accelerates out of a stop and brakes into the next
 *   · two layered sine wanders (a long weave and a short wobble, each with a
 *     random phase/wavelength per segment) push the track off the centreline
 *     the way a person actually drifts along a path, plus fine white jitter
 *     for sensor noise — nothing ever draws as a straight line
 *   · dwells orbit their spot on two slow incommensurate sines (standing,
 *     shuffling, stepping around the thing being looked at) inside a small
 *     radius
 *
 * All randomness is pre-computed per segment from one seeded RNG, so the
 * track is deterministic for a given (route, seed) and identical between
 * server and client builds.
 */
import type { TrackPoint, Vec2 } from "../types";
import { makeRng, rngRange } from "./rng";

export type RouteSegment =
  | {
      kind: "walk";
      /** Waypoints in local metres, read off the real streets. */
      via: Vec2[];
      departT: number;
      arriveT: number;
    }
  | {
      kind: "dwell";
      at: Vec2;
      fromT: number;
      toT: number;
      /** How far the milling-around wanders, metres. */
      radiusM?: number;
    };

const ease = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

interface WalkPlan {
  kind: "walk";
  from: number;
  to: number;
  via: Vec2[];
  /** Cumulative arc length at each waypoint. */
  cum: number[];
  total: number;
  /** The two wander harmonics: [amplitude m, wavelength m, phase rad]. */
  weave: [number, number, number];
  wobble: [number, number, number];
}

interface DwellPlan {
  kind: "dwell";
  from: number;
  to: number;
  at: Vec2;
  radius: number;
  /** Two incommensurate orbit periods (s) and phases. */
  orbit: [number, number, number, number];
}

type Plan = WalkPlan | DwellPlan;

export function generateRoutePath(
  segments: RouteSegment[],
  durationSec: number,
  sampleSec = 3,
  seed = 4242,
): TrackPoint[] {
  const r = makeRng(seed);

  const plans: Plan[] = segments.map((seg) => {
    if (seg.kind === "dwell") {
      return {
        kind: "dwell",
        from: seg.fromT,
        to: seg.toT,
        at: seg.at,
        radius: seg.radiusM ?? 2.2,
        // Slow enough that sampled speed stays under the pipeline's
        // dwellSpeedMps (0.28) — a dwell that scores as walking is no dwell.
        orbit: [rngRange(r, 60, 90), rngRange(r, 22, 32), rngRange(r, 0, 6.28), rngRange(r, 0, 6.28)],
      };
    }
    const cum = [0];
    for (let i = 1; i < seg.via.length; i++) {
      cum.push(
        cum[i - 1] +
          Math.hypot(seg.via[i][0] - seg.via[i - 1][0], seg.via[i][1] - seg.via[i - 1][1]),
      );
    }
    return {
      kind: "walk",
      from: seg.departT,
      to: seg.arriveT,
      via: seg.via,
      cum,
      total: cum[cum.length - 1],
      weave: [rngRange(r, 1.1, 2.4), rngRange(r, 34, 70), rngRange(r, 0, 6.28)],
      wobble: [rngRange(r, 0.35, 0.7), rngRange(r, 6, 12), rngRange(r, 0, 6.28)],
    };
  });

  // Fine sensor jitter is the ONE per-sample random draw, taken in strict time
  // order so the stream stays deterministic.
  const jitter = () => rngRange(r, -0.32, 0.32);

  const points: TrackPoint[] = [];
  for (let t = 0; t <= durationSec; t += sampleSec) {
    points.push({ t, pos: positionAt(t, plans, jitter), heading: 0, speed: 0 });
  }
  if (points[points.length - 1].t !== durationSec) {
    points.push({ t: durationSec, pos: positionAt(durationSec, plans, jitter), heading: 0, speed: 0 });
  }

  // Heading and speed derive from the sampled positions, never invented.
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

function positionAt(t: number, plans: Plan[], jitter: () => number): Vec2 {
  const plan =
    plans.find((p) => t >= p.from && t <= p.to) ??
    // Between segments (authoring gaps) or past the end: hold the nearest edge.
    plans.reduce((best, p) => {
      const d = Math.min(Math.abs(t - p.from), Math.abs(t - p.to));
      const bd = Math.min(Math.abs(t - best.from), Math.abs(t - best.to));
      return d < bd ? p : best;
    });

  if (plan.kind === "dwell") {
    const [pa, pb, fa, fb] = plan.orbit;
    const x = plan.at[0] + Math.sin((t / pa) * 2 * Math.PI + fa) * plan.radius * 0.5 + jitter() * 0.35;
    const z = plan.at[1] + Math.sin((t / pb) * 2 * Math.PI + fb) * plan.radius * 0.25 + jitter() * 0.35;
    return [Number(x.toFixed(2)), Number(z.toFixed(2))];
  }

  const u = ease(Math.min(1, Math.max(0, (t - plan.from) / Math.max(1e-6, plan.to - plan.from))));
  const d = u * plan.total;

  // Locate d on the polyline.
  let i = 1;
  while (i < plan.cum.length - 1 && plan.cum[i] < d) i++;
  const segLen = Math.max(1e-6, plan.cum[i] - plan.cum[i - 1]);
  const v = (d - plan.cum[i - 1]) / segLen;
  const a = plan.via[i - 1];
  const b = plan.via[i];
  const x = lerp(a[0], b[0], v);
  const z = lerp(a[1], b[1], v);

  // Wander off the centreline along the local normal.
  const nx = -(b[1] - a[1]) / segLen;
  const nz = (b[0] - a[0]) / segLen;
  const [wA, wL, wP] = plan.weave;
  const [sA, sL, sP] = plan.wobble;
  const off =
    Math.sin((d / wL) * 2 * Math.PI + wP) * wA + Math.sin((d / sL) * 2 * Math.PI + sP) * sA;

  return [
    Number((x + nx * off + jitter()).toFixed(2)),
    Number((z + nz * off + jitter()).toFixed(2)),
  ];
}
