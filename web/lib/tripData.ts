/**
 * Server-side data access + view models.
 *
 * The important job here is the boundary: a trip carries ~10,000 raw Detection
 * rows, and none of them may cross into a client component. Pages call these
 * functions, which bin/aggregate on the server and hand back small serializable
 * shapes. Tomorrow these read from Postgres instead of lib/mock — the view model
 * types are what the UI depends on, not the storage.
 *
 * Every accessor takes a tripId and returns null on a miss, so pages own the
 * notFound() rather than this layer guessing what a miss means.
 */
import { cache } from "react";
import { familyOf } from "./mock/labels";
import { buildTrip } from "./mock/buildTrip";
import { DEFAULT_TRIP_ID, getTripSpec, TRIP_SPECS } from "./mock/trips";
import { buildObjectIndex, mergeObjectIndexes } from "./objectIndex";
import { binDetections, computeTripStats, type DetectionBin } from "./pipeline";
import type {
  GeoPoint,
  MomentCandidate,
  Moment,
  ObjectIndexEntry,
  TrackPoint,
  TripStats,
  Vec2,
} from "./types";

export interface MomentSummary {
  id: string;
  title: string;
  summary: string;
  tStart: number;
  tEnd: number;
  placeLabel: string;
  placePos: Vec2;
  people: string[];
  objectCount: number;
  topLabels: string[];
  splatStatus: Moment["splat"]["status"];
  vibe: Moment["vibe"];
  hasMusic: boolean;
  /** Present so the map panel can show the pick without loading the whole moment. */
  music?: Moment["music"];
  thumbnailSeed: number;
  thumbnailHue?: number;
  thumbnailUrl?: string;
  transcriptSegmentCount: number;
  /** First line of the transcript — a preview, not the transcript itself. */
  transcriptPreview?: string;
}

export interface TripView {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  placeLabel: string;
  region: string;
  country: string;
  origin: GeoPoint;
  stats: TripStats;
  /** Thinned for SVG rendering — the full path is 700+ samples. */
  path: TrackPoint[];
  moments: MomentSummary[];
  candidates: MomentCandidate[];
  detectionBins: DetectionBin[];
  durationSec: number;
}

export interface ObjectIndexView {
  entries: ObjectIndexEntry[];
  durationSec: number;
  /** Null for the merged cross-trip index — its entries span many trips. */
  tripId: string | null;
}

function toSummary(m: Moment): MomentSummary {
  // Most-confident distinct labels — what you'd say the moment was "of".
  const seen = new Set<string>();
  const topLabels: string[] = [];
  for (const o of m.objects) {
    if (seen.has(o.label)) continue;
    seen.add(o.label);
    topLabels.push(o.label);
    if (topLabels.length === 5) break;
  }

  return {
    id: m.id,
    title: m.title,
    summary: m.summary,
    tStart: m.tStart,
    tEnd: m.tEnd,
    placeLabel: m.place.label,
    placePos: m.place.pos,
    people: m.people,
    objectCount: m.objects.length,
    topLabels,
    splatStatus: m.splat.status,
    vibe: m.vibe,
    hasMusic: !!m.music,
    music: m.music,
    thumbnailSeed: m.keyframes[0].placeholderSeed,
    thumbnailHue: m.keyframes[0].hue,
    thumbnailUrl: m.keyframes[0].url,
    transcriptSegmentCount: m.transcript.length,
    transcriptPreview: m.transcript[0]?.text,
  };
}

const durationOf = (startedAt: string, endedAt: string) =>
  (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;

export function getTripView(tripId: string): TripView | null {
  const spec = getTripSpec(tripId);
  if (!spec) return null;

  const { trip, distanceM } = buildTrip(spec);
  const durationSec = durationOf(trip.startedAt, trip.endedAt);

  return {
    id: trip.id,
    title: trip.title,
    startedAt: trip.startedAt,
    endedAt: trip.endedAt,
    placeLabel: trip.place.label,
    region: trip.place.region,
    country: trip.place.country,
    origin: trip.place.origin,
    stats: computeTripStats(trip, distanceM),
    path: thin(trip.path, 2),
    moments: trip.moments.map(toSummary),
    candidates: trip.candidates,
    detectionBins: binDetections(trip.detections, durationSec, 240, familyOf),
    durationSec,
  };
}

export interface MomentView {
  moment: Moment;
  tripId: string;
  tripTitle: string;
  tripStartedAt: string;
  durationSec: number;
  prev?: { id: string; title: string };
  next?: { id: string; title: string };
  /** Nav targets for this moment's objects, keyed by trackId. */
  navTargets: Record<string, { pos: Vec2; heading: number }>;
}

export function getMomentView(tripId: string, momentId: string): MomentView | null {
  const spec = getTripSpec(tripId);
  if (!spec) return null;

  const { trip } = buildTrip(spec);
  const i = trip.moments.findIndex((m) => m.id === momentId);
  if (i === -1) return null;

  const moment = trip.moments[i];
  const index = buildObjectIndex(trip.moments, trip.path, trip);
  const navTargets: MomentView["navTargets"] = {};
  for (const entry of index) {
    for (const s of entry.sightings) {
      if (s.momentId === momentId && entry.navTarget) {
        navTargets[s.trackId] = { pos: entry.navTarget.pos, heading: entry.navTarget.heading };
      }
    }
  }

  const prev = trip.moments[i - 1];
  const next = trip.moments[i + 1];

  return {
    moment,
    tripId: trip.id,
    tripTitle: trip.title,
    tripStartedAt: trip.startedAt,
    durationSec: durationOf(trip.startedAt, trip.endedAt),
    prev: prev ? { id: prev.id, title: prev.title } : undefined,
    next: next ? { id: next.id, title: next.title } : undefined,
    navTargets,
  };
}

/** One trip's index — what Ask Spark searches, scoped to the trip you're reading. */
export function getObjectIndexView(tripId: string): ObjectIndexView | null {
  const spec = getTripSpec(tripId);
  if (!spec) return null;

  const { trip } = buildTrip(spec);
  return {
    entries: buildObjectIndex(trip.moments, trip.path, trip),
    durationSec: durationOf(trip.startedAt, trip.endedAt),
    tripId: trip.id,
  };
}

/**
 * Every trip's index, merged — what the ⌘K palette searches.
 *
 * Global rather than trip-scoped on purpose. The product claim is that the robot
 * remembers where you left things; scoping that to whichever trip happens to be
 * open would make the feature worse the more you used the product. The palette
 * also lives in a toolbar that renders on the gallery and the globe, where there
 * is no current trip at all.
 *
 * React.cache keeps this to one computation per request even though the app bar
 * and several pages all ask for it.
 */
export const getGlobalObjectIndex = cache((): ObjectIndexView => {
  const indexes = TRIP_SPECS.map((spec) => {
    const { trip } = buildTrip(spec);
    return buildObjectIndex(trip.moments, trip.path, trip);
  });

  return {
    entries: mergeObjectIndexes(indexes),
    // Trip-relative seconds are not comparable across trips; anything rendering a
    // merged result should use the sighting's own tripId to scale a timecode.
    durationSec: 0,
    tripId: null,
  };
});

export interface TripThumb {
  seed: number;
  hue?: number;
  url?: string;
}

export interface TripListItem {
  id: string;
  title: string;
  placeLabel: string;
  region: string;
  country: string;
  origin: GeoPoint;
  startedAt: string;
  endedAt: string;
  stats: TripStats;
  /** [0] is the cover; the rest fill the card's mini strip. */
  momentThumbs: TripThumb[];
}

/**
 * Every trip, newest first.
 *
 * The first call builds all seven trips — the full pipeline over ~35,000
 * detections. That is a one-time per-process cost absorbed by buildTrip's cache,
 * and it is real work rather than faked counts. Measure it on `next build &&
 * next start`, not in dev.
 */
export function listTrips(): TripListItem[] {
  return TRIP_SPECS.map((spec) => {
    const { trip, distanceM } = buildTrip(spec);
    return {
      id: trip.id,
      title: trip.title,
      placeLabel: trip.place.label,
      region: trip.place.region,
      country: trip.place.country,
      origin: trip.place.origin,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      stats: computeTripStats(trip, distanceM),
      momentThumbs: trip.moments.slice(0, 4).map((m) => ({
        seed: m.keyframes[0].placeholderSeed,
        hue: m.keyframes[0].hue,
        url: m.keyframes[0].url,
      })),
    };
  });
}

export const listTripIds = (): string[] => TRIP_SPECS.map((s) => s.id);

export { DEFAULT_TRIP_ID };

const thin = <T,>(arr: T[], every: number): T[] =>
  every <= 1 ? arr : arr.filter((_, i) => i % every === 0 || i === arr.length - 1);
