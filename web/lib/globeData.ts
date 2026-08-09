/**
 * The globe's server view model.
 *
 * Small on purpose: the globe needs a pin and a card per album, not a trip's path
 * or its ten thousand detections. Anything the pin panel cannot show should not
 * cross the RSC boundary to get here.
 */
import { haversineM } from "./globe/geo";
import { listAllTrips, type TripThumb } from "./tripData";
import type { GeoPoint } from "./types";

export interface GlobeAlbum {
  id: string;
  title: string;
  placeLabel: string;
  region: string;
  country: string;
  origin: GeoPoint;
  startedAt: string;
  momentCount: number;
  durationSec: number;
  distanceM: number;
  cover: TripThumb | null;
}

/** One or more albums sharing a point on the sphere. */
export interface GlobePin {
  /** Stable across renders — derived from member ids, not an array index. */
  key: string;
  origin: GeoPoint;
  albums: GlobeAlbum[];
}

export interface GlobeView {
  albums: GlobeAlbum[];
  pins: GlobePin[];
}

/**
 * Albums closer together than this collapse into one pin.
 *
 * 220 km is roughly "same metro area at a glance": at the default camera
 * distance two pins that close overlap into an unreadable blob. Two of the seeded
 * trips are deliberately in the same metro area so this path actually renders
 * rather than being code nobody ever sees.
 */
const CLUSTER_RADIUS_KM = 220;

export function getGlobeView(): GlobeView {
  // listAllTrips, not listTrips. `/globe` belongs to the aurora landing's route
  // group and its whole point is EVERY journey placed on the Earth — the New
  // York cluster above needs two trips to exist at all. The journal's
  // single-trip listTrips() would put one pin on the globe and never exercise
  // the clustering. Nothing in the journal reads getGlobeView, so this is the
  // aurora side choosing its own source.
  const albums: GlobeAlbum[] = listAllTrips().map((trip) => ({
    id: trip.id,
    title: trip.title,
    placeLabel: trip.placeLabel,
    region: trip.region,
    country: trip.country,
    origin: trip.origin,
    startedAt: trip.startedAt,
    momentCount: trip.stats.momentCount,
    durationSec: trip.stats.durationSec,
    distanceM: trip.stats.distanceM,
    cover: trip.momentThumbs[0] ?? null,
  }));

  const pins = clusterByProximity(albums, CLUSTER_RADIUS_KM).map((cluster) => ({
    key: cluster.items.map((a) => a.id).sort().join("+"),
    origin: cluster.origin,
    albums: cluster.items,
  }));

  return { albums, pins };
}

/**
 * Greedy single-link clustering. O(n²), which is irrelevant at n < 500 and stays
 * readable — exported separately from getGlobeView so verify can assert on it.
 *
 * The cluster's origin is the mean of its members, so a two-album pin sits
 * between them rather than on whichever one happened to be first.
 */
export function clusterByProximity<T extends { origin: GeoPoint }>(
  items: T[],
  radiusKm: number,
): Array<{ origin: GeoPoint; items: T[] }> {
  const clusters: Array<{ origin: GeoPoint; items: T[] }> = [];

  for (const item of items) {
    const near = clusters.find(
      (c) => haversineM(c.origin, item.origin) / 1000 <= radiusKm,
    );
    if (near) {
      near.items.push(item);
      near.origin = meanOrigin(near.items.map((i) => i.origin));
    } else {
      clusters.push({ origin: item.origin, items: [item] });
    }
  }

  return clusters;
}

/**
 * Mean of a small, tight group of points.
 *
 * A plain average of longitudes is wrong across the antimeridian, but a cluster
 * is by definition within a couple hundred kilometres, so the members can never
 * straddle it — except at the poles, which are already out of scope (lib/geo.ts).
 */
function meanOrigin(points: GeoPoint[]): GeoPoint {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}
