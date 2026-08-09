/**
 * The arithmetic behind throwing the hero blob around.
 *
 * Pure functions over numbers, deliberately: the component owns events, phase
 * and the DOM, and this file owns nothing but motion. That split is what makes
 * the interesting part — does a fling land where it looks like it should, does
 * the walk home terminate — testable without a browser.
 *
 * EVERY DISTANCE IS IN PIXELS AND EVERY VELOCITY IN PIXELS PER SECOND, but the
 * constants that shape the motion are expressed as multiples of `unit`, the
 * character's on-screen height. A blob is about a fifth of the hero's height at
 * every viewport, so tuning against `unit` means the throw feels the same on a
 * 360 px phone and a 3440 px ultrawide. Tuning in raw pixels does not: the same
 * flick would loft it a third of the way up a laptop and barely lift it on a
 * monitor.
 *
 * The coordinate frame is an OFFSET FROM HOME, not a position on the page: the
 * blob's resting spot is (0, 0), x grows right, y grows DOWN, and the ground is
 * y = 0. So a blob in the air always has negative y, and "has it landed" is
 * `y >= 0` rather than a comparison against some measured path line. Home is
 * already on the path — that is what makes this frame worth using.
 */

/** Gravity, in character-heights per second squared. */
const GRAVITY = 9;
/** Velocity lost to the air each second, as `v *= exp(-AIR_DRAG * dt)`. */
const AIR_DRAG = 0.9;
/** Fraction of downward speed kept on a bounce. */
const RESTITUTION = 0.42;
/** Fraction of horizontal speed kept when it hits the ground. */
const GROUND_FRICTION = 0.72;
/** Fraction of horizontal speed kept, reversed, off a wall. */
const WALL_BOUNCE = -0.5;
/** Below this downward speed on contact, it stops bouncing. */
const SETTLE_VY = 0.9;
/** How fast a skid along the ground bleeds off, per second. */
const SLIDE_DRAG = 3.5;
/** Below this sideways speed the skid is over and it stands up. */
const SLIDE_STOP = 0.35;
/** Walk-home speed — about one body-height per second, which reads as trudging. */
const WALK_SPEED = 0.9;
/** Close enough to home to stop walking, in px. */
const ARRIVE_PX = 2;

export interface Motion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Freeze at the top of the arc instead of falling back down. This is what
   * makes the launch hop reuse the fling's integrator rather than needing a
   * second animation mechanism: the jump is a throw that never comes down,
   * because by then the page is navigating.
   */
  hold: boolean;
}

export interface Env {
  /** The character's on-screen height in px — the yardstick for everything. */
  unit: number;
  minX: number;
  maxX: number;
  /** Most negative y the blob may reach, i.e. how high it can go. */
  ceiling: number;
}

export interface Sample {
  t: number;
  x: number;
  y: number;
}

/** How far back to look when reading a throw off the pointer trail, in ms. */
const FLING_WINDOW_MS = 80;
/**
 * Ignore trails shorter than this. A throw is not measurable over one frame:
 * two events a millisecond apart divide a one-pixel jitter by a tiny dt and
 * report 1000 px/s from a hand that was holding perfectly still — which is
 * exactly how a drag toy ends up hurling things across the screen when you
 * simply let go of it. Verified: without this floor, `[{t:0,x:0},{t:1,x:1}]`
 * comes back as a hard fling.
 */
const MIN_TRAIL_MS = 24;

/** The speed of a throw at the moment of release. */
export function releaseVelocity(samples: readonly Sample[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 1; i >= 0; i--) {
    first = samples[i];
    if (last.t - samples[i].t >= FLING_WINDOW_MS) break;
  }
  const span = last.t - first.t;
  if (span < MIN_TRAIL_MS) return { vx: 0, vy: 0 };
  const dt = span / 1000;
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export type BallisticResult = "flying" | "apex" | "landed";

/**
 * Advance one frame of free flight. Mutates `m` — this runs inside rAF and
 * allocating a fresh object 60 times a second to satisfy a purity principle
 * would be the wrong trade.
 */
export function stepBallistic(m: Motion, dt: number, env: Env): BallisticResult {
  m.vy += GRAVITY * env.unit * dt;

  const damp = Math.exp(-AIR_DRAG * dt);
  m.vx *= damp;
  m.vy *= damp;

  m.x += m.vx * dt;
  m.y += m.vy * dt;

  // A launch is a throw that stops at the top.
  if (m.hold && m.vy >= 0) {
    m.vy = 0;
    return "apex";
  }

  if (m.x < env.minX) {
    m.x = env.minX;
    m.vx *= WALL_BOUNCE;
  } else if (m.x > env.maxX) {
    m.x = env.maxX;
    m.vx *= WALL_BOUNCE;
  }

  if (m.y < env.ceiling) {
    m.y = env.ceiling;
    m.vy = 0;
  }

  if (m.y >= 0) {
    m.y = 0;
    if (m.vy > SETTLE_VY * env.unit) {
      // A real bounce.
      m.vy = -m.vy * RESTITUTION;
      m.vx *= GROUND_FRICTION;
      return "flying";
    }
    // Coming down slowly, or thrown flat along the ground in the first place.
    // Settling here on vertical speed alone would stop a hard sideways fling
    // dead on the first frame — the blob would be snatched out of your hand and
    // put back down 40px away. It keeps its sideways speed and SKIDS instead.
    m.vy = 0;
    m.vx *= Math.exp(-SLIDE_DRAG * dt);
    // And this is what makes the skid terminate: the bounce sequence alone
    // converges without ever reaching zero, and the blob would shiver on the
    // path forever at a hundredth of a pixel.
    if (Math.abs(m.vx) < SLIDE_STOP * env.unit) {
      m.vx = 0;
      return "landed";
    }
  }

  return "flying";
}

/**
 * Advance one frame of walking home. Returns the distance covered, which the
 * caller accumulates to decide when to change the walk frame — cadence locked to
 * DISTANCE, not to time, is what stops it moon-walking when the last step is
 * shorter than the others.
 */
export function stepWalk(m: Motion, dt: number, env: Env): { moved: number; arrived: boolean } {
  const remaining = Math.abs(m.x);
  if (remaining <= ARRIVE_PX) {
    m.x = 0;
    return { moved: 0, arrived: true };
  }
  const step = Math.min(remaining, WALK_SPEED * env.unit * dt);
  m.x += m.x > 0 ? -step : step;
  return { moved: step, arrived: Math.abs(m.x) <= ARRIVE_PX };
}

/** How high it is, 0 on the ground and 1 at the ceiling. Drives the ground glow. */
export function airFraction(m: Motion, env: Env): number {
  if (env.ceiling >= 0) return 0;
  return Math.min(1, Math.max(0, m.y / env.ceiling));
}

/**
 * Tumble. Tied to horizontal speed rather than integrated as real angular
 * momentum: a blob is a beanbag, and the only thing that has to read is "it was
 * thrown". Capped so a hard fling spins rather than blurs.
 */
export function tumble(m: Motion, env: Env): number {
  const spin = (m.vx / (env.unit * 6)) * 18;
  return Math.max(-22, Math.min(22, spin));
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
