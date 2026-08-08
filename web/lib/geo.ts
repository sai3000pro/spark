/**
 * Georeference: the robot's park-local metre frame → real Waterloo Park.
 *
 * The robot navigates in its own local metric frame (x east, z south, metres —
 * see lib/mock/trip-waterloo-park.ts PLACES). The map is real, so those metres
 * are pinned onto the actual park with a similarity transform anchored at the
 * park's south-west path entrance and rotated so the authored walk hugs the
 * real lawns rather than crossing Silver Lake.
 *
 * This is an authored calibration, not surveying: nudge ORIGIN / BEARING_DEG
 * until the walk sits right on the real tiles, the same way the old SVG map
 * nudged its blobs. Swapping in real robot GPS = replace localToLngLat with
 * the odometry fusion output and delete the constants.
 */
import type { Vec2 } from "./types";

/** Where park-local (0, 0) lands on Earth — near the Father David Bauer Dr
 *  entrance at the park's south-west corner. */
const ORIGIN = { lng: -80.5372, lat: 43.4672 };

/** Rotation of the local +x axis relative to due east, in degrees CCW. */
const BEARING_DEG = 8;

/** Metres per degree at the park's latitude. */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const rot = (BEARING_DEG * Math.PI) / 180;
const cos = Math.cos(rot);
const sin = Math.sin(rot);

/** Park-local [x, z] metres → [lng, lat]. Local +x → roughly east, +z → south. */
export function localToLngLat([x, z]: Vec2): [number, number] {
  // Rotate the local frame, then convert metres to degrees. z grows southward
  // in the authored data (screen-style), so it subtracts from latitude.
  const east = x * cos - z * sin;
  const south = x * sin + z * cos;
  return [ORIGIN.lng + east / M_PER_DEG_LNG, ORIGIN.lat - south / M_PER_DEG_LAT];
}

/** The whole trip's bounding box in lng/lat, padded, for fitBounds. */
export function tripBounds(points: Vec2[], padM = 60): [[number, number], [number, number]] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const [w, s] = localToLngLat([minX - padM, maxZ + padM]);
  const [e, n] = localToLngLat([maxX + padM, minZ - padM]);
  return [
    [Math.min(w, e), Math.min(s, n)],
    [Math.max(w, e), Math.max(s, n)],
  ];
}
