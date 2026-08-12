/**
 * Angle coverage — red where a surface still needs more angles, green where it
 * has enough.
 *
 * A port of `KeyframeCoverage` in
 * ios/Sources/GauzensplatCaptureCore/CaptureRecords.swift, and this time it is
 * the same MEASUREMENT and not a proxy for it. The accumulator, the twelve
 * buckets, the five-of-twelve threshold, the fire-once crossing edge and the
 * colour ramp are all the Swift, transliterated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS WORKS WITHOUT DEPTH
 *
 * iOS buckets the azimuth of the SURFACE → CAMERA vector:
 *
 *     let ax = camPos.x - world.x, az = camPos.z - world.z
 *     var ang = atan2(ax, az)
 *     let bucket = Int(ang / (2 * .pi) * 12)
 *
 * That is the azimuth of a *direction*, and a direction needs no range. The ray
 * from the camera through a pixel is fixed by device orientation, the pixel's
 * position and the field of view; reverse it and you have surface → camera,
 * which is the same quantity iOS computes. No depth appears anywhere in it.
 *
 * Depth was only ever doing DATA ASSOCIATION — answering "which surface is this
 * observation of?" by quantising a 3D point to a 12 cm voxel. Sparse optical
 * flow answers the same question a different way: two observations are the same
 * surface when they are the same visual point tracked between frames. That is
 * lib/tracking.ts, and it is the only part of the pipeline that differs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS BUYS, AND WHY IT IS THE WHOLE POINT
 *
 * The pan-versus-orbit distinction falls out of the arithmetic instead of being
 * bolted on top of it:
 *
 *   · Turn on the spot — the camera does not move, the surface does not move,
 *     so its bearing is constant. One bucket, forever. Stays red.
 *   · Walk around it — the bearing sweeps, buckets fill, it greens.
 *   · Walk straight at it — its bearing barely changes, so it stays red while
 *     things passing at the sides green. Correct: a head-on approach is a poor
 *     capture of the thing you are approaching.
 *
 * An earlier version of this file measured dwell time per compass direction,
 * which greened a tripod stare at a blank wall — the single worst input you can
 * hand a reconstructor. That accumulator is gone rather than kept alongside.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT STILL FALLS SHORT OF THE NATIVE APP
 *
 *   · A bare wall yields no trackable points, so it gets no measurement. LiDAR
 *     sees it. The UI must not imply otherwise.
 *   · No metric scale — angles only. So `acceptPoseNovelty`'s 0.15 m
 *     translation test has no equivalent here and keyframe tagging is NOT
 *     ported; coverage drives the HUD, not the pipeline.
 *   · A track that dies banks its buckets into a coarse DIRECTION cell rather
 *     than a world voxel, so revisiting is approximate.
 *
 * No DOM, no React, no `window` — same discipline as lib/uploadedTrips.ts's
 * builders, so all of it is exercisable under `tsx`. See scripts/verify-pipeline.ts.
 */

/** Azimuth buckets round the full circle. iOS `azBuckets`. */
export const BUCKETS = 12;

/** Distinct buckets before a surface is green. iOS `enoughAngles`. */
export const ENOUGH = 5;

/** Direction-cell size for the persistence layer, degrees. */
export const CELL_DEG = 20;

/**
 * Assumed horizontal field of view of a phone's rear camera.
 *
 * There is no web API for it — `MediaTrackSettings` does not carry it, and the
 * only way to know is to calibrate. 65° across the sensor's long side is close
 * for the main (non-ultrawide) lens on most phones. Being a few degrees out
 * skews bearings slightly; it does not change the shape of the measurement.
 */
export const ASSUMED_HFOV_DEG = 65;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/** Population count for the 12-bit masks used throughout. */
export function popcount(n: number): number {
  n = n - ((n >> 1) & 0x5555);
  n = (n & 0x3333) + ((n >> 2) & 0x3333);
  n = (n + (n >> 4)) & 0x0f0f;
  return (n + (n >> 8)) & 0x1f;
}

/**
 * The iOS accumulator, generic over its key.
 *
 * `KeyframeCoverage` keys by world voxel. Here the same class is used twice
 * over: once keyed by TRACK ID, which is the live measurement, and once keyed
 * by DIRECTION CELL, which is the memory that outlives a track. Both want
 * identical semantics, so both get the identical object.
 */
export class BucketCoverage {
  private readonly cells = new Map<number, number>();
  /** Keys that have already fired their crossing. iOS `crossed`. */
  private readonly crossedKeys = new Set<number>();

  constructor(
    readonly buckets: number = BUCKETS,
    readonly enough: number = ENOUGH,
  ) {}

  /**
   * Observe one key from one bucket. Returns true iff this pushed it past
   * `enough` for the FIRST time — iOS's `threshold_crossing` edge, once per key.
   */
  observe(key: number, bucket: number): boolean {
    const b = clamp(Math.floor(bucket), 0, this.buckets - 1);
    const before = this.cells.get(key) ?? 0;
    const after = before | (1 << b);
    this.cells.set(key, after);

    if (
      after !== before &&
      popcount(before) < this.enough &&
      popcount(after) >= this.enough &&
      !this.crossedKeys.has(key)
    ) {
      this.crossedKeys.add(key);
      return true;
    }
    return false;
  }

  /** Fold another key's buckets in — banking a dead track, or seeding a new one. */
  merge(key: number, mask: number): void {
    if (!mask) {
      if (!this.cells.has(key)) this.cells.set(key, 0);
      return;
    }
    this.cells.set(key, (this.cells.get(key) ?? 0) | mask);
  }

  mask(key: number): number {
    return this.cells.get(key) ?? 0;
  }

  has(key: number): boolean {
    return this.cells.has(key);
  }

  /** iOS `level`. 0 = never seen, 1 = enough angles. */
  level(key: number): number {
    return Math.min(1, popcount(this.cells.get(key) ?? 0) / this.enough);
  }

  delete(key: number): void {
    this.cells.delete(key);
    this.crossedKeys.delete(key);
  }

  clear(): void {
    this.cells.clear();
    this.crossedKeys.clear();
  }

  /**
   * iOS `fraction` — green over everything OBSERVED, never over everything
   * possible. Nobody scans the sky and the floor beneath their feet, so a
   * denominator of "all directions" would cap a perfect capture near a third
   * and the number would mean nothing.
   */
  get fraction(): number {
    if (this.cells.size === 0) return 0;
    return this.greenCount / this.cells.size;
  }

  get greenCount(): number {
    let green = 0;
    for (const m of this.cells.values()) if (popcount(m) >= this.enough) green++;
    return green;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Every bucket used by anything, anywhere.
   *
   * This is the angle budget: which sides of the scene have actually been shot
   * from. It is what the app can offer a phone with no depth sensor — it cannot
   * say which surface is thin, so instead it shows whether the capture pattern
   * was thorough enough to make thin surfaces unlikely.
   */
  get unionMask(): number {
    let u = 0;
    for (const m of this.cells.values()) u |= m;
    return u;
  }

  entries(): [number, number][] {
    return [...this.cells.entries()];
  }
}

/** iOS `colorRamp`: 0 → red, 0.5 → yellow, 1 → green. Ported unchanged. */
export function colorRamp(t: number): { r: number; g: number; b: number } {
  const c = clamp(t, 0, 1);
  const r = c < 0.5 ? 1 : 1 - (c - 0.5) * 2;
  const g = c < 0.5 ? c * 2 : 1;
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orientation → direction
//
// World frame: +X east, +Y north, +Z up — the frame DeviceOrientationEvent is
// defined against. Device frame: +X out the right edge, +Y out the top edge,
// +Z out of the SCREEN, so the rear camera looks along −Z.
// ─────────────────────────────────────────────────────────────────────────────

/** Row-major 3×3, device → world. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type Vec3 = readonly [number, number, number];

/**
 * The W3C rotation matrix for an orientation sample: R = Rz(α)·Rx(β)·Ry(γ).
 *
 * α need not be an absolute compass bearing — on Android without
 * `deviceorientationabsolute` it is relative to wherever the page started. That
 * is harmless: every bucket comparison happens within one recording, so a
 * constant offset cancels. Drift over a long take does not cancel, which is a
 * real limit and is stated in the UI.
 */
export function rotationMatrix(alpha: number, beta: number, gamma: number): Mat3 {
  const cA = Math.cos(rad(alpha)), sA = Math.sin(rad(alpha));
  const cB = Math.cos(rad(beta)), sB = Math.sin(rad(beta));
  const cG = Math.cos(rad(gamma)), sG = Math.sin(rad(gamma));

  return [
    cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG,
    sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG,
    -cB * sG, sB, cB * cG,
  ];
}

/** R · v — device frame into world frame. */
export function worldFromDevice(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

/** Rᵀ · v — world frame into device frame. R is orthonormal, so this is R⁻¹. */
export function deviceFromWorld(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
  ];
}

/** Unit world vector for a yaw (bearing, clockwise from +Y) and pitch. */
export function directionOf(yawDeg: number, pitchDeg: number): Vec3 {
  const y = rad(yawDeg), p = rad(pitchDeg);
  const cp = Math.cos(p);
  return [cp * Math.sin(y), cp * Math.cos(y), Math.sin(p)];
}

export interface LookDirection {
  yawDeg: number;
  pitchDeg: number;
  R: Mat3;
}

/**
 * Where the REAR camera is pointing, from one orientation sample.
 *
 * The camera axis is −Z of the device, so its world direction is the negated
 * third column of R. Worth stating because the obvious shortcut — α as heading,
 * β as pitch — is only right for a phone held bolt upright, and is wrong by
 * tens of degrees the moment it tilts, which is most of a real scan.
 */
export function cameraDirection(
  alpha: number | null,
  beta: number | null,
  gamma: number | null,
): LookDirection | null {
  if (alpha == null || beta == null || gamma == null) return null;

  const R = rotationMatrix(alpha, beta, gamma);
  const d = worldFromDevice(R, [0, 0, -1]);

  return {
    yawDeg: wrap360(deg(Math.atan2(d[0], d[1]))),
    pitchDeg: deg(Math.asin(clamp(d[2], -1, 1))),
    R,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixels ↔ directions
// ─────────────────────────────────────────────────────────────────────────────

export interface Projection {
  /** Pixels per unit of tangent: focal length in this surface's own pixels. */
  focal: number;
  width: number;
  height: number;
  /** `screen.orientation.angle`, degrees. */
  screenAngle: number;
}

/**
 * Focal length in the target surface's pixels.
 *
 * Handles `object-cover`: the video is scaled to COVER its box and cropped, so
 * the frame is wider than what is visible. The field of view belongs to the
 * whole frame, so the scale must be undone before it becomes pixels. Pass the
 * grab canvas (which holds the full, uncropped frame) and the scale is 1:1;
 * pass the display box and the crop is accounted for.
 *
 * The FOV spans the sensor's long side, which is not always `videoWidth` —
 * some phones hand back an already-rotated portrait frame.
 */
export function focalFor(
  boxW: number,
  boxH: number,
  videoW: number,
  videoH: number,
  hFovDeg: number = ASSUMED_HFOV_DEG,
): number {
  if (!videoW || !videoH) {
    return Math.max(boxW, boxH) / (2 * Math.tan(rad(hFovDeg) / 2));
  }
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const longSide = Math.max(videoW, videoH) * scale;
  return longSide / (2 * Math.tan(rad(hFovDeg) / 2));
}

/**
 * Where a world direction lands on the surface, or null if behind the camera.
 *
 * `screenAngle` rotates device axes into screen axes: turn the phone landscape
 * and the OS re-uprights the picture, but α/β/γ stay in device coordinates, so
 * without this the overlay tips over with the phone.
 */
export function projectToScreen(
  R: Mat3,
  world: Vec3,
  proj: Projection,
): { x: number; y: number } | null {
  const [dx, dy, dz] = deviceFromWorld(R, world);

  // The camera looks down −Z, so dz ≥ 0 is behind it. The margin keeps
  // directions grazing the edge from projecting to ±infinity.
  if (dz > -0.05) return null;

  const a = rad(proj.screenAngle);
  const c = Math.cos(a), s = Math.sin(a);
  const u = dx * c - dy * s; // along screen-right
  const v = dx * s + dy * c; // along screen-up

  return {
    x: proj.width / 2 + proj.focal * (u / -dz),
    y: proj.height / 2 - proj.focal * (v / -dz),
  };
}

/**
 * The exact inverse: the world direction of the ray through a pixel.
 *
 * This is what replaces LiDAR unprojection. iOS turns a depth sample into a
 * world POINT; this turns a pixel into a world RAY. The point is needed to pick
 * a voxel — which optical flow makes unnecessary — and the ray is all the
 * bucket arithmetic ever wanted.
 */
export function bearingOfPixel(
  R: Mat3,
  sx: number,
  sy: number,
  proj: Projection,
): { azDeg: number; elDeg: number } | null {
  if (!proj.focal) return null;

  // Normalised so dz = −1; only the direction matters.
  const u = (sx - proj.width / 2) / proj.focal;
  const v = -(sy - proj.height / 2) / proj.focal;

  const a = rad(proj.screenAngle);
  const c = Math.cos(a), s = Math.sin(a);
  const dx = u * c + v * s;
  const dy = -u * s + v * c;

  const len = Math.hypot(dx, dy, 1);
  const world = worldFromDevice(R, [dx / len, dy / len, -1 / len]);

  return {
    azDeg: wrap360(deg(Math.atan2(world[0], world[1]))),
    elDeg: deg(Math.asin(clamp(world[2], -1, 1))),
  };
}

/**
 * iOS's bucket, from a camera → surface ray.
 *
 * The ray points away from the camera; iOS buckets the reverse vector, surface
 * → camera. Hence the 180°. Everything else is `Int(ang / (2π) * 12)`.
 */
export function surfaceAzimuthBucket(rayAzDeg: number, buckets: number = BUCKETS): number {
  const az = wrap360(rayAzDeg + 180);
  return Math.min(buckets - 1, Math.floor((az / 360) * buckets));
}

/** Coarse direction cell, for banking a dead track's buckets. */
export function directionCellKey(
  azDeg: number,
  elDeg: number,
  cellDeg: number = CELL_DEG,
): number {
  const a = Math.floor(wrap360(azDeg) / cellDeg);
  // Clamped off the poles, where azimuth cells converge to nothing.
  const e = Math.floor(clamp(elDeg, -89.9, 89.9) / cellDeg);
  return a * 64 + (e + 32);
}

/** Metres between two WGS-84 fixes. Haversine; good to a metre at these scales. */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const Rm = 6_371_000;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Which of low / level / high the camera is looking from. */
export function pitchBand(pitchDeg: number): 0 | 1 | 2 {
  if (pitchDeg < -12) return 0;
  if (pitchDeg > 12) return 2;
  return 1;
}
