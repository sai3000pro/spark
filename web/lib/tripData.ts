/**
 * Server-side data access + view models.
 *
 * The important job here is the boundary: a trip carries ~10,000 raw Detection
 * rows, and none of them may cross into a client component. Pages call these
 * functions, which bin/aggregate on the server and hand back small serializable
 * shapes. Tomorrow these read from Postgres instead of lib/mock — the view model
 * types are what the UI depends on, not the storage.
 */
import { cache } from "react";
import { familyOf } from "./mock/labels";
// Two builders, deliberately. The no-arg one is the FLAGSHIP — the STACKT
// Market walk, which is what the journal, the walk screen and the landing's
// narration read; buildSpecTrip(spec) builds any trip and is what the shelf
// reads. Aliased so the two can never be confused at a call site — see the
// additive accessors at the bottom of this file.
import { buildTrip as buildSpecTrip } from "./mock/buildTrip";
import { getTripSpec, stacktMarket, TRIP_SPECS } from "./mock/trips";

const TRIP_ID = stacktMarket.id;
const buildTrip = () => buildSpecTrip(stacktMarket);
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
  tripId: string;
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

/**
 * Any authored trip's walk-screen view. The globe made the walk multi-trip:
 * clicking a banner on the desk globe lands on `/walk?trip=<id>`, and this is
 * what that page reads. Unknown ids return null so the page can fall back to
 * the flagship instead of 500ing on a stale link.
 */
export function getTripViewFor(tripId: string): TripView | null {
  const spec = getTripSpec(tripId);
  if (!spec) return null;
  const { trip, distanceM } = buildSpecTrip(spec);
  const durationSec =
    (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000;

  return {
    id: trip.id,
    title: trip.title,
    startedAt: trip.startedAt,
    endedAt: trip.endedAt,
    placeLabel: trip.place.label,
    region: trip.place.region,
    origin: trip.place.origin,
    stats: computeTripStats(trip, distanceM),
    path: thin(trip.path, 2),
    moments: trip.moments.map(toSummary),
    candidates: trip.candidates,
    detectionBins: binDetections(trip.detections, durationSec, 240, familyOf),
    durationSec,
  };
}

/** Any authored trip's full moments — what the walk's takeover renders. */
export function getTripMomentsFor(tripId: string): Moment[] | null {
  const spec = getTripSpec(tripId);
  if (!spec) return null;
  return buildSpecTrip(spec).trip.moments;
}

/** Any authored trip's ⌘K index, same boundary as `getObjectIndexView`. */
export function getObjectIndexViewFor(tripId: string): ObjectIndexView | null {
  const spec = getTripSpec(tripId);
  if (!spec) return null;
  const { trip } = buildSpecTrip(spec);
  return {
    entries: buildObjectIndex(trip.moments, trip.path, trip),
    durationSec:
      (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000,
    tripId: trip.id,
  };
}

export function getTripView(): TripView {
  return getTripViewFor(TRIP_ID)!;
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

export function getMomentView(momentId: string): MomentView | null {
  const { trip } = buildTrip();
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
    durationSec:
      (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000,
    prev: prev ? { id: prev.id, title: prev.title } : undefined,
    next: next ? { id: next.id, title: next.title } : undefined,
    navTargets,
  };
}

export function getObjectIndexView(): ObjectIndexView {
  const { trip } = buildTrip();
  return {
    entries: buildObjectIndex(trip.moments, trip.path, trip),
    durationSec:
      (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000,
    tripId: trip.id,
  };
}

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
  stats: TripStats;
  /** [0] is the cover; the rest fill the card's mini strip. */
  momentThumbs: TripThumb[];
}

export function listTrips(): TripListItem[] {
  const view = getTripView();
  const { trip } = buildTrip();
  return [
    {
      id: view.id,
      title: view.title,
      placeLabel: view.placeLabel,
      region: view.region,
      country: trip.place.country,
      origin: trip.place.origin,
      startedAt: view.startedAt,
      stats: view.stats,
      momentThumbs: view.moments.slice(0, 4).map((m) => ({
        seed: m.thumbnailSeed,
        hue: m.thumbnailHue,
        url: m.thumbnailUrl,
      })),
    },
  ];
}

export { TRIP_ID };

/* ── The aurora landing's multi-trip accessors ────────────────────────────────
 *
 * ADDITIVE, on purpose. Everything above this line is the journal's single-trip
 * view — `listTrips()` returns Waterloo Park alone and `getObjectIndexView()`
 * indexes it — and the journal at `/landing-page`, `/walk` and `/trip/*` reads
 * exactly that. Nothing here changes any of it.
 *
 * The aurora landing at `/` shows a LIBRARY: seven albums on a grid, seven pins
 * on the globe, and a ⌘K palette that searches across all of them. The seven
 * specs never went away (lib/mock/trips/), and buildTrip(spec) still builds any
 * of them — only the accessors that reached for all seven did. These are those
 * accessors, restored under names of their own so the two designs can disagree
 * about how many trips exist without either one breaking the other.
 */
export function listAllTrips(): TripListItem[] {
  return TRIP_SPECS.map((spec) => {
    const { trip, distanceM } = buildSpecTrip(spec);
    return {
      id: trip.id,
      title: trip.title,
      placeLabel: trip.place.label,
      region: trip.place.region,
      country: trip.place.country,
      origin: trip.place.origin,
      startedAt: trip.startedAt,
      stats: computeTripStats(trip, distanceM),
      momentThumbs: trip.moments.slice(0, 4).map((m) => ({
        seed: m.keyframes[0].placeholderSeed,
        hue: m.keyframes[0].hue,
        url: m.keyframes[0].url,
      })),
    };
  });
}

/**
 * Every trip's index, merged — what the ⌘K palette searches.
 *
 * Global rather than trip-scoped on purpose. The product claim is that the robot
 * remembers where you left things; scoping that to whichever trip happens to be
 * open would make the feature worse the more you used the product.
 *
 * React.cache keeps it to one computation per request. `durationSec: 0` and
 * `tripId: null` are honest: trip-relative seconds are not comparable across
 * trips, so anything rendering a merged result scales its timecode from the
 * sighting's own tripId.
 */
export const getGlobalObjectIndex = cache(
  (): Omit<ObjectIndexView, "tripId"> & { tripId: string | null } => {
    const indexes = TRIP_SPECS.map((spec) => {
      const { trip } = buildSpecTrip(spec);
      return buildObjectIndex(trip.moments, trip.path, trip);
    });
    return { entries: mergeObjectIndexes(indexes), durationSec: 0, tripId: null };
  },
);

const thin = <T,>(arr: T[], every: number): T[] =>
  every <= 1 ? arr : arr.filter((_, i) => i % every === 0 || i === arr.length - 1);
