/**
 * Georeference: the robot's local metre frame → the real city.
 *
 * The robot navigates in its own local metric frame (x east, z south, metres).
 * The map is real, so those metres are pinned onto the actual streets with a
 * similarity transform anchored at STACKT Market's courtyard (Bathurst & Front,
 * Toronto) — the walk's start point. BEARING is 0 because the flagship trip is
 * AUTHORED from real lat/lng waypoints via `lngLatToLocal`, so the local frame
 * is already true-north aligned.
 *
 * This is an authored calibration, not surveying. Swapping in real robot GPS =
 * replace localToLngLat with the odometry fusion output and delete the
 * constants.
 */
import type { GeoPoint, Vec2 } from "./types";

/** Where local (0, 0) lands on Earth — STACKT Market's courtyard. */
const ORIGIN = { lng: -79.4022, lat: 43.6408 };

/** Rotation of the local +x axis relative to due east, in degrees CCW. */
const BEARING_DEG = 0;

/** Metres per degree at the city's latitude. */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const rot = (BEARING_DEG * Math.PI) / 180;
const cos = Math.cos(rot);
const sin = Math.sin(rot);

/**
 * Local [x, z] metres → [lng, lat], anchored at any trip's origin.
 *
 * Same constants and rotation as the flagship path below — the globe made the
 * walk multi-trip, and every trip's local frame is metres around its own
 * `place.origin`. The lng scale is recomputed per origin latitude; the
 * flagship's own conversion stays bit-identical (cos is monotone in between).
 */
export function localToLngLatAt(origin: GeoPoint, [x, z]: Vec2): [number, number] {
  const east = x * cos - z * sin;
  const south = x * sin + z * cos;
  const mPerDegLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  return [origin.lng + east / mPerDegLng, origin.lat - south / M_PER_DEG_LAT];
}

/** Local [x, z] metres → [lng, lat]. Local +x → east, +z → south. */
export function localToLngLat([x, z]: Vec2): [number, number] {
  const east = x * cos - z * sin;
  const south = x * sin + z * cos;
  return [ORIGIN.lng + east / M_PER_DEG_LNG, ORIGIN.lat - south / M_PER_DEG_LAT];
}

/**
 * The inverse, for AUTHORING: real [lat, lng] → local [x, z] metres. The
 * flagship trip's route is written as coordinates read off the real streets
 * and parks, so the drawn walk genuinely follows Bathurst, Fort York Blvd and
 * the Martin Goodman Trail instead of crossing buildings. (Assumes
 * BEARING_DEG = 0, which is why it is 0.)
 */
export function lngLatToLocal(lat: number, lng: number): Vec2 {
  return [
    Number(((lng - ORIGIN.lng) * M_PER_DEG_LNG).toFixed(1)),
    Number(((ORIGIN.lat - lat) * M_PER_DEG_LAT).toFixed(1)),
  ];
}

/** `tripBounds`, anchored at any trip's origin. */
export function tripBoundsAt(
  origin: GeoPoint,
  points: Vec2[],
  padM = 60,
): [[number, number], [number, number]] {
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
  const [w, s] = localToLngLatAt(origin, [minX - padM, maxZ + padM]);
  const [e, n] = localToLngLatAt(origin, [maxX + padM, minZ - padM]);
  return [
    [Math.min(w, e), Math.min(s, n)],
    [Math.max(w, e), Math.max(s, n)],
  ];
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
