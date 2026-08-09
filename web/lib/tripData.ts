/**
 * Server-side data access + view models.
 *
 * The important job here is the boundary: a trip carries ~10,000 raw Detection
 * rows, and none of them may cross into a client component. Pages call these
 * functions, which bin/aggregate on the server and hand back small serializable
 * shapes. Tomorrow these read from Postgres instead of lib/mock — the view model
 * types are what the UI depends on, not the storage.
 */
import { familyOf } from "./mock/labels";
import { buildTrip, TRIP_ID } from "./mock/trip-waterloo-park";
import { buildObjectIndex } from "./objectIndex";
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

export function getTripView(): TripView {
  const { trip, distanceM } = buildTrip();
  const durationSec =
    (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000;

  return {
    id: trip.id,
    title: trip.title,
    startedAt: trip.startedAt,
    endedAt: trip.endedAt,
    placeLabel: trip.place.label,
    region: trip.place.region,
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

const thin = <T,>(arr: T[], every: number): T[] =>
  every <= 1 ? arr : arr.filter((_, i) => i % every === 0 || i === arr.length - 1);
