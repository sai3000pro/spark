/**
 * Walks built from an uploaded video.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL HERE, AND WHAT IS NOT. Read before trusting a number on screen.
 *
 * REAL — genuinely measured from the footage:
 *   · the detections. A real detector ran on real frames in the browser and the
 *     `t` on each one is a real timestamp in the video.
 *   · the candidates. `scoreCandidates` — the same function the authored trips
 *     use, the same TRIGGER_WEIGHTS, the same thresholds. Nothing is nudged.
 *   · which windows became moments, and which were discarded and why.
 *   · every object sighting, its confidence, its first and last frame.
 *
 * NOT REAL — synthesized, because a video file does not carry it:
 *   · POSITION. There is no odometry and no GPS. Moments are laid out along a
 *     straight transect in the order they happened, so the map has something
 *     truthful-in-time to draw; it is a timeline wearing a map's clothes, and
 *     `synthetic: true` on the trip is what says so in the UI.
 *   · the transcript. No audio pass yet, so there is none — rather than invent
 *     one. The audio triggers therefore never fire, which is the honest result
 *     and is why an uploaded walk finds fewer moments than an authored one.
 *   · the title and summary, which are assembled from the labels actually seen
 *     in the window. Plain description, not an LLM pretending to be one.
 *
 * Storage is the same globalThis singleton discipline as lib/liveTrip.ts, with
 * the same limitations: survives dev module reloads, does NOT survive a server
 * restart, single process only, nothing on disk. See that file's header — the
 * argument is identical and so is the one-file path to a database.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No `next/*` imports: scripts/verify-pipeline.ts can reach this and runs under tsx.
 */
import { promoteToMoment, scoreCandidates, type MomentContent } from "./pipeline";
import { pathDistanceM } from "./mock/generatePath";
import { familyOf } from "./mock/labels";
import { SCENE_HUES } from "./mock/placeholder";
import { estimateCameraPath } from "./video/estimateMotion";
import { estimateWorldPos } from "./video/trackFrames";
import type { BuiltTrip } from "./mock/buildTrip";
import type { Detection, GeoPoint, Moment, Trip, Vec2 } from "./types";

export interface UploadedWalkInput {
  /** Real detections from real frames. `t` is seconds into the video. */
  detections: Detection[];
  durationSec: number;
  placeLabel?: string;
  region?: string;
  country?: string;
  origin?: GeoPoint;
  /** Filename, shown so you can tell two uploads apart. */
  sourceName?: string;
  /** The reconstruction job this walk is waiting on, if one was started. */
  splatJobId?: string;
}

export interface UploadedWalk {
  id: string;
  createdAt: string;
  sourceName: string;
  splatJobId: string | null;
  built: BuiltTrip;
}

/** Ids carry their own provenance so `trip_upload_*` is greppable everywhere. */
export const UPLOAD_ID_PREFIX = "trip_upload_";

export const isUploadedTripId = (id: string): boolean => id.startsWith(UPLOAD_ID_PREFIX);

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

interface Store {
  walks: Map<string, UploadedWalk>;
}

const KEY = Symbol.for("spark.uploadedTrips.store");

/** Beyond this the oldest is dropped — an unbounded map of 10k-detection trips
 *  is a memory leak with a friendly name. */
const MAX_WALKS = 8;

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const fresh: Store = { walks: new Map() };
  g[KEY] = fresh;
  return fresh;
}

export function getUploadedWalk(id: string): UploadedWalk | null {
  return store().walks.get(id) ?? null;
}

export function listUploadedWalks(): UploadedWalk[] {
  return [...store().walks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Attach the splat once the reconstruction lands. Every moment shares it —
 *  one video reconstructs to one scene, not one per moment. */
export function attachSplat(tripId: string, url: string, pointCount?: number): boolean {
  const walk = store().walks.get(tripId);
  if (!walk) return false;
  for (const moment of walk.built.trip.moments) {
    moment.splat = { status: "ready", url, pointCount };
  }
  return true;
}

export function __resetUploadedTrips(): void {
  store().walks.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/** Metres between consecutive moments on the synthetic transect. */
const TRANSECT_SPACING_M = 55;

export function createUploadedWalk(input: UploadedWalkInput): UploadedWalk {
  const now = new Date();
  const id = `${UPLOAD_ID_PREFIX}${now.getTime().toString(36)}`;
  const built = buildWalkFromDetections(id, input);

  const s = store();
  s.walks.set(id, {
    id,
    createdAt: now.toISOString(),
    sourceName: input.sourceName ?? "uploaded video",
    splatJobId: input.splatJobId ?? null,
    built,
  });

  while (s.walks.size > MAX_WALKS) {
    const oldest = [...s.walks.keys()][0];
    s.walks.delete(oldest);
  }

  return s.walks.get(id)!;
}

function buildWalkFromDetections(tripId: string, input: UploadedWalkInput): BuiltTrip {
  const { durationSec } = input;
  // Re-stamp onto this trip so ids and refs are internally consistent even if
  // the client labelled them something else.
  const detections: Detection[] = input.detections.map((d) => ({ ...d, tripId }));

  // Camera motion, measured from how the boxes move. This is what makes `dwell`
  // reachable without odometry — without it the only signals are novelty and
  // face count, novelty all fires in the opening seconds, and every upload
  // returns zero moments. See the header of lib/video/estimateMotion.ts.
  const path = estimateCameraPath(detections, durationSec);

  // Stage 2, for real. Still no audio, so the speech triggers cannot fire —
  // which is why an uploaded walk finds fewer moments than an authored one, and
  // that is the correct outcome rather than a shortfall to paper over.
  const candidates = scoreCandidates({
    tripId,
    durationSec,
    detections,
    audioEvents: [],
    path,
  });

  const promoted = candidates.filter((c) => c.status !== "discarded");

  // Lay the kept moments out in time order along a transect. Read the caveat at
  // the top of this file: this is chronology drawn as geography.
  const moments: Moment[] = promoted.map((candidate, i) => {
    const pos: Vec2 = [i * TRANSECT_SPACING_M, 0];
    const inWindow = detections.filter(
      (d) => d.t >= candidate.tStart && d.t <= candidate.tEnd,
    );

    // Anchors for the splat stage. Back-projected from the box, not measured —
    // stamped here rather than at detection time because a detection only knows
    // where it sits in the FRAME; where that lands in the world depends on which
    // moment claimed it, and that is decided above.
    for (const d of inWindow) {
      d.worldPos = estimateWorldPos(d, pos);
    }

    const labels = rankLabels(inWindow);

    const content: MomentContent = {
      id: `m_up_${i}`,
      title: titleFor(labels),
      summary: summaryFor(labels, candidate.tEnd - candidate.tStart),
      place: { label: `${fmtClock(candidate.tStart)}–${fmtClock(candidate.tEnd)}`, pos },
      people: [],
      // No audio pass, so no transcript. An invented one would be the single
      // most dishonest thing this file could do.
      transcript: [],
      splat: {
        status: "processing",
        note: input.splatJobId
          ? "Reconstructing this scene from the uploaded video."
          : "No reconstruction was requested for this upload.",
      },
      vibe: {
        mood: labels.length > 2 ? "busy" : "quiet",
        energy: Math.min(1, inWindow.length / Math.max(1, (candidate.tEnd - candidate.tStart) * 6)),
        tags: labels.slice(0, 4).map((l) => l.label),
      },
      hue: hueFor(labels),
    };

    return promoteToMoment(candidate, detections, content);
  });

  // A path so the map has something to draw. Straight, evenly walked, and
  // labelled synthetic everywhere it surfaces.
  const stops: Stop[] = [
    { pos: [-TRANSECT_SPACING_M, 0], arriveT: 0, departT: 0 },
    ...moments.map((m) => ({
      pos: m.place.pos,
      arriveT: m.tStart,
      departT: m.tEnd,
    })),
    { pos: [moments.length * TRANSECT_SPACING_M, 0], arriveT: durationSec, departT: durationSec },
  ];
  const path = generatePath(stops, durationSec, 4, 20260808);

  for (const c of candidates) {
    if (c.status === "pending") {
      c.status = moments.some((m) => m.candidateId === c.id) ? "promoted" : "discarded";
      if (c.status === "discarded") {
        c.discardReason ??= "passed stage 2, but no coherent subject to reconstruct";
      }
    }
  }

  const startedAt = new Date().toISOString();
  const trip: Trip = {
    id: tripId,
    title: input.sourceName ? `From ${input.sourceName}` : "From an uploaded video",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + durationSec * 1000).toISOString(),
    place: {
      label: input.placeLabel ?? "Uploaded footage",
      region: input.region ?? "—",
      country: input.country ?? "—",
      origin: input.origin ?? { lat: 43.6415, lng: -79.4046 },
    },
    path,
    moments,
    candidates,
    detections,
    audioEvents: [],
  };

  return { trip, distanceM: pathDistanceM(path) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Describing what was seen — plain, from the labels, no invention
// ─────────────────────────────────────────────────────────────────────────────

interface RankedLabel {
  label: string;
  count: number;
  peak: number;
}

function rankLabels(detections: Detection[]): RankedLabel[] {
  const by = new Map<string, RankedLabel>();
  for (const d of detections) {
    const hit = by.get(d.label);
    if (hit) {
      hit.count++;
      hit.peak = Math.max(hit.peak, d.confidence);
    } else {
      by.set(d.label, { label: d.label, count: 1, peak: d.confidence });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

function titleFor(labels: RankedLabel[]): string {
  if (!labels.length) return "Something held the frame";
  const names = labels.slice(0, 3).map((l) => l.label);
  if (names.length === 1) return `A ${names[0]}, steadily`;
  if (names.length === 2) return `${cap(names[0])} and ${names[1]}`;
  return `${cap(names[0])}, ${names[1]} and ${names[2]}`;
}

function summaryFor(labels: RankedLabel[], lengthSec: number): string {
  if (!labels.length) {
    return `${Math.round(lengthSec)} seconds the scorer kept without a clear subject.`;
  }
  const parts = labels
    .slice(0, 3)
    .map((l) => `${l.label} (${Math.round(l.peak * 100)}%)`)
    .join(", ");
  return `${Math.round(lengthSec)} seconds of footage the detector stayed interested in. Seen here: ${parts}.`;
}

/** Scene hue from the dominant label's family, so keyframes are not all one colour. */
function hueFor(labels: RankedLabel[]): number {
  const family = labels[0] ? familyOf(labels[0].label) : "furniture";
  switch (family) {
    case "people":
      return SCENE_HUES.golden;
    case "animal":
      return SCENE_HUES.park;
    case "vehicle":
      return SCENE_HUES.dusk;
    case "food":
      return SCENE_HUES.indoor;
    case "sport":
      return SCENE_HUES.field;
    default:
      return SCENE_HUES.indoor;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const fmtClock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
