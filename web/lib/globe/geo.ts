/**
 * The bridge between the robot's local metric frame and the real Earth.
 *
 * Spark navigates in metres from wherever a trip started — that is the frame the
 * odometry, the moment pins and the splat anchors all live in, and it is the
 * right one for a robot. But an album gallery and a globe need to know that the
 * walk happened in Kyoto. This file is the entire seam between those two worlds,
 * and `Trip.place.origin` is the only anchor it needs.
 *
 * ONE convention, defined here and nowhere else:
 *
 *   Local ground metres are [east, south] — +x east, +z south.
 *     (South-positive so a y-down SVG map renders north-up untransformed.)
 *
 *   Sphere: lng 0 → +Z, lng +90° → +X, north → +Y.
 *     x = r·cos φ·sin λ     y = r·sin φ     z = r·cos φ·cos λ
 *
 * Getting that sign convention wrong produces a mirrored Earth with Africa where
 * the Americas should be — the most common bug in a hand-built globe, and the
 * hardest to see once you have stared at it for an hour. `geoToVec3` and
 * `vec3ToGeo` are exact inverses and scripts/verify-pipeline.ts asserts it.
 *
 * Pure and dependency-free: no `next`, no `three`. It is imported by the SVG map,
 * the WebGL globe, the server view models and the verify script alike.
 */
import type { GeoPoint, Vec2, Vec3 } from "../types";

const DEG = Math.PI / 180;

/**
 * Metres per degree of latitude. The WGS84 meridian varies from 110,574 m at the
 * equator to 111,694 m at the poles; a trip covers ~1 km, so one mean value is
 * accurate to well under a centimetre here and avoids dragging in a projection.
 */
const M_PER_DEG_LAT = 111_320;

/**
 * Trips within ~±85° work. Beyond that the `cos(lat)` term collapses and
 * longitude stops being meaningful — a polar expedition would need a real
 * projection, and that is out of scope by design rather than by accident.
 */
const MAX_LAT = 85;

const clampLat = (lat: number) => Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));

/**
 * Local ground metres → lat/lng, anchored at the trip origin.
 *
 * Equirectangular about the origin rather than a true projection: over the ~1 km
 * a trip covers, the error is sub-centimetre, and it degrades gracefully instead
 * of needing a library.
 */
export function localToGeo(origin: GeoPoint, pos: Vec2): GeoPoint {
  const [east, south] = pos;
  const lat = clampLat(origin.lat) - south / M_PER_DEG_LAT;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(clampLat(origin.lat) * DEG);
  return {
    lat,
    lng: origin.lng + east / mPerDegLng,
  };
}

/** Exact inverse of `localToGeo`. */
export function geoToLocal(origin: GeoPoint, p: GeoPoint): Vec2 {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(clampLat(origin.lat) * DEG);
  return [(p.lng - origin.lng) * mPerDegLng, (clampLat(origin.lat) - p.lat) * M_PER_DEG_LAT];
}

/** Lat/lng bounds of a set of local points — what a map needs to frame a trip. */
export function geoBounds(origin: GeoPoint, points: Vec2[]): { min: GeoPoint; max: GeoPoint } {
  if (!points.length) return { min: origin, max: origin };

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const pos of points) {
    const { lat, lng } = localToGeo(origin, pos);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  return { min: { lat: minLat, lng: minLng }, max: { lat: maxLat, lng: maxLng } };
}

/** Lat/lng → a point on a sphere of the given radius. The globe's entry point. */
export function geoToVec3(p: GeoPoint, radius = 1): Vec3 {
  const phi = p.lat * DEG;
  const lambda = p.lng * DEG;
  const cosPhi = Math.cos(phi);
  return [
    radius * cosPhi * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * cosPhi * Math.cos(lambda),
  ];
}

/** Exact inverse of `geoToVec3`, for any radius. */
export function vec3ToGeo(v: Vec3): GeoPoint {
  const [x, y, z] = v;
  const r = Math.hypot(x, y, z) || 1;
  return {
    lat: Math.asin(Math.min(1, Math.max(-1, y / r))) / DEG,
    lng: Math.atan2(x, z) / DEG,
  };
}

/** Great-circle distance in metres. Used for pin clustering, not for navigation. */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_008.8; // mean Earth radius
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** `"43.4735° N · 80.5310° W"` — for the trip header and the globe's HUD readout. */
export function formatGeo(p: GeoPoint): string {
  const lat = `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(p.lng).toFixed(4)}° ${p.lng >= 0 ? "E" : "W"}`;
  return `${lat} · ${lng}`;
}
