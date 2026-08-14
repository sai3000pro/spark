/**
 * The globe's server view model.
 *
 * Small on purpose: the globe needs a pin and a card per album, not a trip's path
 * or its ten thousand detections. Anything the pin panel cannot show should not
 * cross the RSC boundary to get here.
 */
import { albumForJourney } from "./albums";
import { haversineM } from "./globe/geo";
import { computeTripStats } from "./pipeline";
import { isWalkMine, isWalkPosted } from "./postedWalks";
import { listAllTrips, type TripThumb } from "./tripData";
import { listUploadedWalks } from "./uploadedTrips";
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
  /**
   * Every walk behind this album is yours. Carried per album rather than
   * inferred on the client because "is this mine" is a server fact
   * (lib/postedWalks.ts) and the client has no way to ask.
   */
  mine: boolean;
  /** At least one of its walks has been put on the shared sphere. */
  posted: boolean;
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
 * The three ways to look at the sphere.
 *
 *   world   every walk anyone has posted — the shared globe, unchanged
 *   mine    every walk that is yours, whether or not it is out there
 *   posted  yours AND out there — the ones you actually put on the world's globe
 *
 * These are the only three that can be answered from what this machine knows.
 * A "friends" or "group" scope is a different phase: it needs the memberships in
 * supabase/migrations/002, and there is no database provisioned, so it is not
 * offered here at all rather than offered and quietly wrong.
 */
export type GlobeScope = "world" | "mine" | "posted";

/** One sphere per scope, so switching is a click and not a round trip. */
export type GlobeScopes = Record<GlobeScope, GlobeView>;

/**
 * Albums closer together than this collapse into one pin.
 *
 * 220 km is roughly "same metro area at a glance": at the default camera
 * distance two pins that close overlap into an unreadable blob. Two of the seeded
 * trips are deliberately in the same metro area so this path actually renders
 * rather than being code nobody ever sees.
 */
const CLUSTER_RADIUS_KM = 220;

/**
 * Which walks each scope keeps, in ONE place.
 *
 * Read per WALK, before albums are merged. Filtering after the merge would let
 * an unposted walk's distance and duration into the world's totals through an
 * album that also holds a posted one — the pin would be public and its numbers
 * would be partly private. So each scope narrows first and groups afterwards,
 * which is why the three spheres are built separately rather than sliced out of
 * one list on the client.
 */
const KEEPS: Record<GlobeScope, (walk: GlobeAlbum) => boolean> = {
  world: (walk) => walk.posted,
  mine: (walk) => walk.mine,
  posted: (walk) => walk.mine && walk.posted,
};

/**
 * Every walk this machine could place on the Earth, before any scope narrows it.
 *
 * listAllTrips, not listTrips: the sphere's whole point is EVERY journey placed
 * on the Earth — the New York cluster needs two trips to exist at all, and the
 * journal's single-trip listTrips() would put one pin on the globe and never
 * exercise the clustering.
 */
function everyWalk(): GlobeAlbum[] {
  return [
    ...listAllTrips().map(
      (trip): GlobeAlbum => ({
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
        mine: isWalkMine(trip.id),
        posted: isWalkPosted(trip.id),
      }),
    ),
    // Uploaded walks were invisible to the globe before posting existed; now the
    // posted ones take their place beside the specs. Their origin is whatever the
    // upload declared — a time transect wearing a map's clothes (lib/uploadedTrips.ts).
    ...listUploadedWalks().map(({ built }): GlobeAlbum => {
      const { trip, distanceM } = built;
      const stats = computeTripStats(trip, distanceM);
      const key = trip.moments[0]?.keyframes[0];
      return {
        id: trip.id,
        title: trip.title,
        placeLabel: trip.place.label,
        region: trip.place.region,
        country: trip.place.country,
        origin: trip.place.origin,
        startedAt: trip.startedAt,
        momentCount: stats.momentCount,
        durationSec: stats.durationSec,
        distanceM: stats.distanceM,
        cover: key ? { seed: key.placeholderSeed, hue: key.hue, url: key.url } : null,
        mine: isWalkMine(trip.id),
        posted: isWalkPosted(trip.id),
      };
    }),
  ];
}

/**
 * The sphere as one scope sees it.
 *
 * Defaults to `world`, which is exactly what this returned before scopes
 * existed: only what has been POSTED reaches the shared globe. The seeded specs
 * default to posted (they are the "everybody else" the plate amalgamates); an
 * uploaded walk appears there only after its owner posts it from the map. The
 * flag lives in lib/postedWalks.ts.
 */
export function getGlobeView(scope: GlobeScope = "world"): GlobeView {
  return viewOf(everyWalk(), scope);
}

/**
 * All three spheres at once, off ONE pass over the walks.
 *
 * The walk screen hands the client every scope rather than re-querying on each
 * toggle: the whole set is a few hundred bytes of titles and coordinates, and a
 * scope switch that costs a round trip would feel like a page load for what is
 * really a change of mind.
 */
export function getGlobeScopes(): GlobeScopes {
  const walks = everyWalk();
  return {
    world: viewOf(walks, "world"),
    mine: viewOf(walks, "mine"),
    posted: viewOf(walks, "posted"),
  };
}

function viewOf(walks: GlobeAlbum[], scope: GlobeScope): GlobeView {
  const grouped = groupByAlbum(walks.filter(KEEPS[scope]));

  const pins = clusterByProximity(grouped, CLUSTER_RADIUS_KM).map((cluster) => ({
    key: cluster.items.map((a) => a.id).sort().join("+"),
    origin: cluster.origin,
    albums: cluster.items,
  }));

  return { albums: grouped, pins };
}

/**
 * Walks filed under the same album collapse into one entry.
 *
 * This is what filing is FOR. Four visits to the same park used to put four
 * unrelated dots on the sphere with four titles; now they are one pin named
 * whatever you called it, and the counts add up. A walk that was never filed is
 * passed through untouched — most are, and an unfiled walk is not a broken one.
 *
 * The album's position is its cover walk's, not the mean of its members: an
 * album spanning two cities should sit on the one you chose to represent it,
 * whereas a mean would park it in a field between them. Proximity clustering
 * still runs afterwards and may merge it with neighbours, which is a different
 * question — "these are near each other" rather than "these are the same trip".
 */
function groupByAlbum(walks: GlobeAlbum[]): GlobeAlbum[] {
  const out: GlobeAlbum[] = [];
  const merged = new Map<string, GlobeAlbum>();

  for (const walk of walks) {
    const album = albumForJourney(walk.id);
    if (!album) {
      // A copy, not the walk: the three scopes are grouped from one shared list
      // and the merge below writes into whatever it is handed.
      out.push({ ...walk });
      continue;
    }

    const existing = merged.get(album.id);
    if (!existing) {
      const seed: GlobeAlbum = { ...walk, id: album.id, title: album.title };
      merged.set(album.id, seed);
      out.push(seed);
      continue;
    }

    existing.momentCount += walk.momentCount;
    existing.durationSec += walk.durationSec;
    existing.distanceM += walk.distanceM;
    // An album is yours only if every walk in it is; it is on the sphere as
    // soon as any one of them is. Both readings are the cautious one — the
    // post toggle refuses an album holding someone else's walk, and a pin that
    // is out there is never labelled private.
    existing.mine &&= walk.mine;
    existing.posted ||= walk.posted;
    // Earliest start, so the album reads as "since then" rather than as
    // whichever walk happened to be enumerated first.
    if (walk.startedAt < existing.startedAt) existing.startedAt = walk.startedAt;
    // The cover walk decides the pin's place and picture.
    if (album.coverJourneyId === walk.id) {
      existing.origin = walk.origin;
      existing.cover = walk.cover;
      existing.placeLabel = walk.placeLabel;
      existing.region = walk.region;
      existing.country = walk.country;
    }
  }

  return out;
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
