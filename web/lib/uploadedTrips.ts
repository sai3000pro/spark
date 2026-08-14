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
 *   · the transcript, WHEN one was made. There is a real audio pass now —
 *     Whisper in the browser, lib/audio/ — so `audioEvents` and `keywordHits`
 *     arrive measured and the audio triggers finally fire. It is optional and
 *     often absent (a silent clip, an undecodable codec, or simply not asked
 *     for), and when it is absent this is empty rather than invented, exactly
 *     as it always was. What is still NOT measured is who spoke: Whisper does
 *     not diarise, so every speaker is "unknown".
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
import type { KeywordHit } from "./pipeline";
import type { AudioEvent, Detection, GeoPoint, Moment, SplatView, TrackPoint, TranscriptSegment, Trip, Vec2 } from "./types";

import { forgetJourney } from "./albums";

export interface UploadedWalkInput {
  /** Real detections from real frames. `t` is seconds into the video. */
  detections: Detection[];
  durationSec: number;
  placeLabel?: string;
  region?: string;
  country?: string;
  /**
   * Where the camera was, read from the file's own metadata.
   *
   * Only ever set when the video actually carried a fix. Absent is the common
   * case — see lib/video/probeMetadata.ts — and absent must NOT become a
   * coordinate, which is what the old hardcoded fallback did.
   */
  origin?: GeoPoint;
  /**
   * When it was filmed, with its original UTC offset, from the container.
   *
   * `startedAt` used to be `new Date()`, so a clip filmed on Saturday became a
   * walk that happened at upload time and sorted wrongly in the album.
   */
  recordedAt?: string;
  /** Filename, shown so you can tell two uploads apart. */
  sourceName?: string;
  /** The reconstruction job this walk is waiting on, if one was started. */
  splatJobId?: string;
  /**
   * The audio pass, when the browser ran one. Absent for a silent clip, a
   * codec the browser could not decode, or a user who did not ask for it —
   * all of which are ordinary, so every one of these defaults to empty and the
   * walk is built from the pictures alone.
   */
  audioEvents?: AudioEvent[];
  keywordHits?: KeywordHit[];
  transcript?: TranscriptSegment[];
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
export function attachSplat(
  tripId: string,
  url: string,
  pointCount?: number,
  view?: SplatView,
): boolean {
  const walk = store().walks.get(tripId);
  if (!walk) return false;

  // A reconstruction arrived for a walk the scorer left empty.
  //
  // This loop used to run over nothing and report success, which is the worst
  // shape a bug can take: the splat was on disk, the job said `ready`, and
  // there was no moment anywhere to open it from. Precisely the case someone
  // reaches by pressing "reconstruct it anyway" — they have already overruled
  // the scorer once, and the pipeline then quietly overruled them back.
  //
  // So promote the best candidate it threw away. Nothing is invented: the
  // window, its detections and its labels were all measured, and the only thing
  // that changes is the verdict — which a person has now explicitly disagreed
  // with. See the `rescued` note on the moment, which says so on the page.
  if (walk.built.trip.moments.length === 0) {
    const rescued = rescueOneMoment(walk);
    if (rescued) walk.built.trip.moments.push(rescued);
  }

  for (const moment of walk.built.trip.moments) {
    // `view` is what stops a collected splat rendering as an empty box. An
    // authored capture has a hand-measured camera; this one has a measured one.
    // See lib/video/plyBounds.ts.
    moment.splat = { status: "ready", url, pointCount, ...(view ? { view } : {}) };
  }
  return true;
}

/**
 * Turn the strongest discarded candidate into a moment, so a splat has a door.
 *
 * Picks by score rather than by length: the highest-scoring window is the one
 * the scorer came closest to keeping, and it is where the interesting part of
 * the clip almost certainly is. Returns null only when there was no candidate
 * at all, which means the footage genuinely held nothing — not even a near miss.
 */
function rescueOneMoment(walk: UploadedWalk): Moment | null {
  const { trip } = walk.built;
  const best = [...trip.candidates].sort((a, b) => b.score - a.score)[0];
  if (!best) return null;

  const inWindow = trip.detections.filter((d) => d.t >= best.tStart && d.t <= best.tEnd);
  const labels = rankLabels(inWindow);
  // The camera trace is not retained on the trip, so the moment sits at the
  // origin rather than at a guessed position. Honest: the map already warns
  // that distance is estimated and direction is not estimated at all.
  const pos: Vec2 = [0, 0];

  const content: MomentContent = {
    id: "m_up_rescued",
    title: labels.length ? titleFor(labels) : "The place itself",
    summary: labels.length
      ? summaryFor(labels, best.tEnd - best.tStart)
      : "No single minute stood out, so the whole walk is kept as one place.",
    place: { label: `${fmtClock(best.tStart)}–${fmtClock(best.tEnd)}`, pos },
    people: [],
    transcript: [],
    splat: {
      status: "processing",
      note: "Reconstructed on request, after the scorer kept nothing.",
    },
    vibe: {
      mood: "quiet",
      energy: 0,
      tags: labels.slice(0, 4).map((l) => l.label),
    },
    hue: hueFor(labels),
  };

  best.status = "promoted";
  best.discardReason = undefined;
  return promoteToMoment(best, trip.detections, content);
}

/**
 * Say where a walk happened, after the fact.
 *
 * The file's own metadata is the best source and often absent — location
 * services off, or stripped in sharing — so this is the fallback that is still
 * TRUE: a person who was there typing it in. Marked `originMeasured` exactly as
 * a metadata fix would be, because both are statements of fact about the same
 * thing; what the flag distinguishes is a claim from the hardcoded placeholder,
 * not one source of claim from another.
 *
 * Moves the trip only. Moment positions come from the camera trace and stay
 * relative to the origin, so re-anchoring the walk carries them along and
 * nothing has to be recomputed.
 */
export function setWalkPlace(
  tripId: string,
  place: { origin: GeoPoint; label?: string; region?: string; country?: string },
): boolean {
  const walk = store().walks.get(tripId);
  if (!walk) return false;

  const p = walk.built.trip.place;
  p.origin = place.origin;
  p.originMeasured = true;
  if (place.label) p.label = place.label;
  if (place.region) p.region = place.region;
  if (place.country) p.country = place.country;
  return true;
}

export function __resetUploadedTrips(): void {
  store().walks.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/** Where the camera was at time t, along the measured trace. */
function posAtT(path: TrackPoint[], t: number): Vec2 {
  if (!path.length) return [0, 0];
  if (t <= path[0].t) return path[0].pos;
  const last = path[path.length - 1];
  if (t >= last.t) return last.pos;

  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  return [a.pos[0] + (b.pos[0] - a.pos[0]) * f, a.pos[1] + (b.pos[1] - a.pos[1]) * f];
}

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
    // An album naming an evicted walk would put a pin on the globe with
    // nothing behind it, and show a count that overstates what is there. The
    // album survives; only its reference to this walk goes.
    forgetJourney(oldest);
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
  // The audio triggers finally have something to fire on. Three of the
  // scorer's kinds — audio_energy, laughter, speech_keyword — were unreachable
  // while these were hardcoded empty, which is why an uploaded walk used to
  // find fewer moments than an authored one. Still empty when there was no
  // audio pass, and the result is then exactly what it was before.
  const candidates = scoreCandidates({
    tripId,
    durationSec,
    detections,
    audioEvents: input.audioEvents ?? [],
    keywordHits: input.keywordHits ?? [],
    path,
  });

  const promoted = candidates.filter((c) => c.status !== "discarded");

  // Each moment sits where the camera actually was along the measured trace, so
  // a held shot clusters its moments and a walked stretch spreads them. Read the
  // caveat at the top of this file: the DISTANCE is estimated and the direction
  // is not estimated at all.
  const moments: Moment[] = promoted.map((candidate, i) => {
    const pos = posAtT(path, (candidate.tStart + candidate.tEnd) / 2);
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
      // The real transcript, clipped to this moment's own window. Still empty
      // when no audio pass ran — and an INVENTED one would be the single most
      // dishonest thing this file could do, which is why it never was.
      transcript: (input.transcript ?? []).filter(
        (s) => s.t < candidate.tEnd && s.t + s.durationSec > candidate.tStart,
      ),
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

  for (const c of candidates) {
    if (c.status === "pending") {
      c.status = moments.some((m) => m.candidateId === c.id) ? "promoted" : "discarded";
      if (c.status === "discarded") {
        c.discardReason ??= "passed stage 2, but no coherent subject to reconstruct";
      }
    }
  }

  // The file's own timestamp when it has one, and only then the clock. A parse
  // failure falls through to now rather than producing an invalid date.
  const stamped = input.recordedAt ? Date.parse(input.recordedAt) : NaN;
  const startedAt = Number.isFinite(stamped) ? input.recordedAt! : new Date().toISOString();
  const trip: Trip = {
    id: tripId,
    title: input.sourceName ? `From ${input.sourceName}` : "From an uploaded video",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + durationSec * 1000).toISOString(),
    place: {
      label: input.placeLabel ?? "Uploaded footage",
      region: input.region ?? "—",
      country: input.country ?? "—",
      /*
        The real fix when the file carried one — see lib/video/probeMetadata.ts.

        The fallback is still a coordinate, because the globe has to draw the
        trip somewhere. What changes is that it no longer passes for a
        measurement: `originMeasured` below says which of the two this is, so a
        placeholder can be labelled or hidden instead of pinning every upload on
        earth to one Toronto street corner with total confidence.
      */
      origin: input.origin ?? { lat: 43.6415, lng: -79.4046 },
      originMeasured: Boolean(input.origin),
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
