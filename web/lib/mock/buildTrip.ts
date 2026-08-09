/**
 * Assembles a Trip from an authored TripSpec by running the REAL pipeline.
 *
 * Only the HUMAN layer is authored in a spec — titles, summaries, transcripts,
 * music, vibe, and which objects were physically present. Everything
 * machine-derived (candidates, moment spans, object sightings, keyframes, the
 * object index) is produced by actually running lib/pipeline.ts over generated
 * detections. That is why the timeline's three lanes are genuinely consistent
 * with each other rather than three independently-authored fictions that drift.
 *
 * Swapping in real data = replace `generateDetectionsForTracks` with the robot's
 * detection log and delete the ambient generator. Nothing else moves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHORING RULES — read these before adding a trip.
 *
 * A moment is not guaranteed to exist just because you wrote one. It has to earn
 * promotion through scoreCandidates() like everything else, and a thin moment
 * silently fails PIPELINE_CONFIG.promoteThreshold (0.62) and gets dropped with a
 * console warning. Working backwards from TRIGGER_WEIGHTS, the reliable recipes:
 *
 *   1. Give every moment at least one `laughterAt`. Laughter 0.34 + face_count
 *      for 2 people 0.174 + audio_energy 0.135 + dwell 0.083 = 0.73. Clears on
 *      its own. Failing that, one `keywords` entry plus one novel object gets you
 *      0.24 + 0.30 + 0.174 + 0.135 = 0.85.
 *   2. At least TWO `person` tracks spanning the whole window. They drive
 *      face_count, and they keep promoteToMoment from emitting an empty
 *      objects[] — which verify-pipeline.ts asserts against.
 *   3. Windows of 45s or more. minCandidateSec is 12, but merged spans quantise
 *      to strideSec (3) and a short window loses the dwell contribution.
 *   4. Only labels already in LABEL_FAMILIES (lib/mock/labels.ts). Anything else
 *      falls through familyOf() to "furniture" and the timeline's validated
 *      categorical colours start lying about what they mean.
 *   5. For a novel_object trigger to actually fire, avoid the ambient labels in
 *      generateAmbientTracks — ambient tracks start at t≈20 and will have already
 *      consumed the novelty. Safe: bottle, cell phone, laptop, book, umbrella,
 *      dining table, frisbee, sports ball, sandwich, banana, cake, boat.
 *   6. No new trip may give a `bottle` a peakConfidence above 0.85. Waterloo
 *      Park's snack-bar bottle is the hero of the "where is my water bottle"
 *      demo, and cross-trip search ranks by confidence — a louder bottle
 *      elsewhere would quietly steal it. Note that authored peaks are NOT what
 *      lands: confidenceAt() adds up to ±0.045 of jitter on top, so the hero's
 *      authored 0.93 actually observes as 0.965. Author at 0.85 or below and the
 *      margin holds. Asserted in verify.
 *   7. Splat status across the light trips: mostly ready, exactly one processing,
 *      zero failed. Waterloo already owns the failed case and it is the better
 *      story — two failures reads as a broken pipeline rather than an honest one.
 *   8. A new trip needs no map calibration. Omit `place.mapOrigin` and
 *      `place.bearingDeg` and the walk anchors on `place.origin` facing east,
 *      which is right often enough. Add them only after looking at the route on
 *      the real tiles — that is what they are for, and guessing them is worse
 *      than leaving them out.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type {
  AudioEvent,
  GeoPoint,
  MomentCandidate,
  Moment,
  MusicPick,
  SplatRef,
  TranscriptSegment,
  Trip,
  Vec2,
  Vec3,
  Vibe,
} from "../types";
import { promoteToMoment, scoreCandidates, type KeywordHit, type MomentContent } from "../pipeline";
import {
  generateAmbientTracks,
  generateDetectionsForTracks,
  type TrackSpec,
} from "./generateDetections";
import { generatePath, pathDistanceM, type Stop } from "./generatePath";
import { makeRng, rngRange } from "./rng";

/** Object world position: local frame [east, up, south], offset from a place. */
export const at = (place: Vec2, dx: number, up: number, dz: number): Vec3 => [
  place[0] + dx,
  up,
  place[1] + dz,
];

export interface MomentSpec {
  id: string;
  /** Authored window. The pipeline decides the final span; this seeds the content. */
  tStart: number;
  tEnd: number;
  placeLabel: string;
  placePos: Vec2;
  hue: number;
  title: string;
  summary: string;
  people: string[];
  transcript: Array<[number, string, string]>; // [tOffset, speaker, text]
  tracks: TrackSpec[];
  splat: SplatRef;
  music?: MusicPick;
  vibe: Vibe;
  laughterAt?: number[];
  keywords?: Array<[number, string]>; // [tOffset, phrase]
}

export interface TripSpec {
  id: string;
  title: string;
  /** ISO 8601 with a UTC offset — the offset is what makes clock times local. */
  startedAt: string;
  durationSec: number;
  place: {
    label: string;
    region: string;
    country: string;
    /** Where the trip sits on Earth. Anchors its pin on the globe. */
    origin: GeoPoint;
    /**
     * MAP calibration — where local (0, 0) lands on the vector tiles, and how
     * far the local +x axis is rotated off due east (degrees CCW).
     *
     * Usually the same point as `origin`, and both are optional: omit them and
     * the map anchors on `origin` facing east. They exist because the two
     * numbers do different jobs, and Waterloo Park proves it — its map anchor
     * was nudged ~860 m from its globe pin so the walk hugs the lawns instead
     * of crossing Silver Lake. Moving `origin` moves the pin; moving
     * `mapOrigin` moves the walk. See lib/geo.ts.
     */
    mapOrigin?: GeoPoint;
    bearingDeg?: number;
  };
  /** Local metres. Where the path starts and ends; moments supply their own stops. */
  start: Vec2;
  end: Vec2;
  moments: MomentSpec[];
  /**
   * Per-trip RNG seeds.
   *
   * Waterloo Park PINS these to the historical literals (1337 / 4242 / 90210 /
   * 7788) that its detections were generated with. Changing them reshuffles its
   * detection stream, which shifts candidate scoring, which can drop a moment and
   * move the water bottle's last sighting — breaking a dozen assertions in
   * scripts/verify-pipeline.ts. Other trips derive from a hash of their id so no
   * two trips generate the same ambient noise or the same path wobble.
   */
  seeds: { detections: number; path: number; ambient: number; audio: number };
}

/** Hash-derived seeds, so every trip's noise is distinct but deterministic. */
export function defaultSeeds(id: string): TripSpec["seeds"] {
  const h = hashString(id);
  return {
    detections: h % 100_000,
    path: (h >>> 7) % 100_000,
    ambient: (h >>> 13) % 100_000,
    audio: (h >>> 19) % 100_000,
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

function buildStops(spec: TripSpec): Stop[] {
  const pad = 18; // arrive a little before the moment, leave a little after
  const stops: Stop[] = [{ pos: spec.start, arriveT: 0, departT: 30 }];
  for (const s of spec.moments) {
    stops.push({ pos: s.placePos, arriveT: s.tStart - pad, departT: s.tEnd + pad });
  }
  stops.push({ pos: spec.end, arriveT: spec.durationSec, departT: spec.durationSec });
  return stops;
}

function buildTranscript(spec: MomentSpec): TranscriptSegment[] {
  return spec.transcript.map(([offset, speaker, text], i) => ({
    id: `${spec.id}_seg${i}`,
    t: spec.tStart + offset,
    // Rough speaking rate: ~2.6 words/sec, floor of 1.6s.
    durationSec: Number(Math.max(1.6, text.split(" ").length / 2.6).toFixed(1)),
    speaker,
    text,
    confidence: Number(rngRange(makeRng(1000 + i + spec.id.length), 0.88, 0.99).toFixed(3)),
  }));
}

function buildAudioEvents(spec: TripSpec): AudioEvent[] {
  const events: AudioEvent[] = [];

  for (const moment of spec.moments) {
    for (const seg of buildTranscript(moment)) {
      events.push({
        t: seg.t,
        durationSec: seg.durationSec,
        kind: "speech",
        // Energy tracks the moment's vibe, so a quiet hilltop doesn't score like
        // a frisbee game.
        energy: Number(Math.min(0.98, 0.4 + moment.vibe.energy * 0.55).toFixed(2)),
      });
    }
    for (const t of moment.laughterAt ?? []) {
      events.push({ t: moment.tStart + t, durationSec: 2.4, kind: "laughter", energy: 0.86 });
    }
  }

  // Ambient chatter between moments. Kept below the 0.35 energy gate most of the
  // time so it does NOT trigger on its own — moments have to earn it.
  const r = makeRng(spec.seeds.audio);
  for (let t = 60; t < spec.durationSec - 60; t += rngRange(r, 25, 90)) {
    const insideMoment = spec.moments.some((s) => t > s.tStart - 25 && t < s.tEnd + 25);
    if (insideMoment) continue;
    events.push({
      t: Number(t.toFixed(1)),
      durationSec: Number(rngRange(r, 1.5, 6).toFixed(1)),
      kind: r() < 0.82 ? "speech" : "ambient",
      energy: Number(rngRange(r, 0.14, 0.46).toFixed(2)),
    });
  }

  return events.sort((a, b) => a.t - b.t);
}

function buildKeywordHits(spec: TripSpec): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const moment of spec.moments) {
    for (const [offset, phrase] of moment.keywords ?? []) {
      hits.push({ t: moment.tStart + offset, phrase });
    }
  }
  return hits;
}

function contentFor(spec: MomentSpec): MomentContent {
  return {
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    place: { label: spec.placeLabel, pos: spec.placePos },
    people: spec.people,
    transcript: buildTranscript(spec),
    splat: spec.splat,
    music: spec.music,
    vibe: spec.vibe,
    hue: spec.hue,
  };
}

export interface BuiltTrip {
  trip: Trip;
  distanceM: number;
}

/**
 * Memoized per spec id. Building a trip runs the full pipeline over ~10,000
 * detections, and every page in the app asks for one — so this cache is what
 * keeps the albums grid from doing that six times per request.
 *
 * Note that `buildTrip` mutates candidates in place (status → "promoted") and the
 * cache hands out the same object graph to every caller. Anything downstream that
 * filters or annotates candidates must copy, not mutate.
 */
const cache = new Map<string, BuiltTrip>();

export function buildTrip(spec: TripSpec): BuiltTrip {
  const hit = cache.get(spec.id);
  if (hit) return hit;

  const momentTracks = spec.moments.flatMap((s) => s.tracks);
  const ambientTracks = generateAmbientTracks(
    spec.durationSec,
    spec.moments.map((s) => ({ tStart: s.tStart, tEnd: s.tEnd })),
    spec.seeds.ambient,
  );

  const detections = generateDetectionsForTracks(
    spec.id,
    [...momentTracks, ...ambientTracks],
    spec.seeds.detections,
  );
  const path = generatePath(buildStops(spec), spec.durationSec, 8, spec.seeds.path);
  const audioEvents = buildAudioEvents(spec);
  const keywordHits = buildKeywordHits(spec);

  // Stage 2 for real: the candidates below are found, not authored.
  const candidates = scoreCandidates({
    tripId: spec.id,
    durationSec: spec.durationSec,
    detections,
    audioEvents,
    path,
    keywordHits,
  });

  // Stage 3: match each authored moment to the candidate covering its window.
  const moments: Moment[] = [];
  const claimed = new Set<string>();

  for (const momentSpec of spec.moments) {
    const mid = (momentSpec.tStart + momentSpec.tEnd) / 2;
    const candidate =
      candidates.find((c) => !claimed.has(c.id) && c.tStart <= mid && c.tEnd >= mid) ??
      // Fall back to whichever unclaimed candidate overlaps most, so a tuning
      // change to TRIGGER_WEIGHTS can never silently drop a moment.
      candidates
        .filter((c) => !claimed.has(c.id) && c.tEnd > momentSpec.tStart && c.tStart < momentSpec.tEnd)
        .sort(
          (a, b) =>
            overlap(b, momentSpec.tStart, momentSpec.tEnd) -
            overlap(a, momentSpec.tStart, momentSpec.tEnd),
        )[0];

    if (!candidate) {
      console.warn(
        `[mock] no candidate covered moment ${momentSpec.id} (${momentSpec.tStart}-${momentSpec.tEnd}s) ` +
          `in trip ${spec.id}. See the authoring rules at the top of lib/mock/buildTrip.ts, ` +
          `and check TRIGGER_WEIGHTS / windowThreshold in lib/pipeline.ts.`,
      );
      continue;
    }

    claimed.add(candidate.id);
    candidate.status = "promoted";
    delete candidate.discardReason;
    moments.push(promoteToMoment(candidate, detections, contentFor(momentSpec)));
  }

  // Anything that survived stage 2 but has no moment: stage 3 looked and found
  // nothing worth keeping. That is a real outcome, not a bug.
  for (const c of candidates) {
    if (c.status === "pending") {
      c.status = "discarded";
      c.discardReason = c.discardReason ?? "passed stage 2, but no coherent subject to reconstruct";
    }
  }

  const trip: Trip = {
    id: spec.id,
    title: spec.title,
    startedAt: spec.startedAt,
    endedAt: new Date(new Date(spec.startedAt).getTime() + spec.durationSec * 1000).toISOString(),
    place: spec.place,
    path,
    moments,
    candidates,
    detections,
    audioEvents,
  };

  const built: BuiltTrip = { trip, distanceM: pathDistanceM(path) };
  cache.set(spec.id, built);
  return built;
}

const overlap = (c: MomentCandidate, tStart: number, tEnd: number) =>
  Math.max(0, Math.min(c.tEnd, tEnd) - Math.max(c.tStart, tStart));
