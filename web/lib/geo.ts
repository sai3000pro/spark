/**
 * Georeference for the MAP: a trip's local metre frame → real lng/lat.
 *
 * The robot navigates in its own local metric frame (x east, z south, metres —
 * see the PLACES block in any spec under lib/mock/trips). The map is real, so
 * those metres are pinned onto the actual world with a similarity transform:
 * an origin the walk hangs from, and a bearing that rotates the authored frame
 * until the route hugs the real paths instead of cutting across them.
 *
 * This is an authored calibration, not surveying: nudge a trip's `mapOrigin` /
 * `bearingDeg` (lib/mock/buildTrip.ts, TripSpec["place"]) until the walk sits
 * right on the tiles, the same way the old SVG map nudged its blobs. Swapping in
 * real robot GPS = feed the odometry fusion output straight to the map and
 * delete the calibration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT the same thing as lib/globe/geo.ts, and they must not be merged.
 *
 *   this file          the map. Rotated. M_PER_DEG_LAT = 110_574, and longitude
 *                      scales by cos(origin latitude).
 *   lib/globe/geo.ts   the globe. Unrotated. 111_320 for BOTH axes.
 *
 * The constants differ by ~0.7% in latitude, which is ~4 m over Waterloo Park's
 * walk — invisible on a spinning globe, and a moment pin sitting off the path on
 * a 15.4-zoom map. A trip's `place.origin` anchors its globe pin; `place.mapOrigin`
 * anchors its walk. For most trips they are the same point. For Waterloo Park
 * they are deliberately ~860 m apart, and moving either one moves a different
 * thing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Per trip rather than module-level, because there are eight trips in eight
 * places. Build one with makeGeo(ref) and keep it for the render — the trig is
 * precomputed once per trip, which is what the old module constants bought and
 * what a 700-point path re-projected every frame needs.
 */
import type { GeoPoint, Vec2 } from "./types";

/** A trip's map calibration, small enough to cross the RSC boundary as a POJO. */
export interface GeoRef {
  origin: GeoPoint;
  /** Rotation of the local +x axis relative to due east, in degrees CCW. */
  bearingDeg: number;
}

export interface TripGeo {
  ref: GeoRef;
  /** Local [x, z] metres → [lng, lat]. Local +x → roughly east, +z → south. */
  localToLngLat(pos: Vec2): [number, number];
  /** The whole trip's bounding box in lng/lat, padded, for fitBounds. */
  tripBounds(points: Vec2[], padM?: number): [[number, number], [number, number]];
}

/** Metres per degree of latitude. Constant enough at any inhabited latitude. */
const M_PER_DEG_LAT = 110_574;

const cache = new Map<string, TripGeo>();

const keyOf = (ref: GeoRef) => `${ref.origin.lat}|${ref.origin.lng}|${ref.bearingDeg}`;

/**
 * Builds (and memoizes) the transform for one trip.
 *
 * Memoized by value so two callers holding equal-but-distinct GeoRef objects —
 * the server builds one per request — get the same instance back, and a
 * `useMemo` keyed on it stays honest.
 */
export function makeGeo(ref: GeoRef): TripGeo {
  const key = keyOf(ref);
  const hit = cache.get(key);
  if (hit) return hit;

  const { origin } = ref;
  const mPerDegLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);

  const rot = (ref.bearingDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const localToLngLat = ([x, z]: Vec2): [number, number] => {
    // Rotate the local frame, then convert metres to degrees. z grows southward
    // in the authored data (screen-style), so it subtracts from latitude.
    const east = x * cos - z * sin;
    const south = x * sin + z * cos;
    return [origin.lng + east / mPerDegLng, origin.lat - south / M_PER_DEG_LAT];
  };

  const tripBounds = (
    points: Vec2[],
    padM = 60,
  ): [[number, number], [number, number]] => {
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
  };

  const geo: TripGeo = { ref, localToLngLat, tripBounds };
  cache.set(key, geo);
  return geo;
}
