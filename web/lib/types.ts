/**
 * THE CONTRACT — single source of truth for the capture pipeline.
 *
 * Three stages, cheapest first:
 *
 *   Detection[]        every frame, on-device, ~10fps, disposable
 *        │  scoreCandidates()
 *        ▼
 *   MomentCandidate[]  a window flagged as interesting + WHY it was flagged
 *        │  promoteToMoment()
 *        ▼
 *   Moment[]           the thing you relive: splat + transcript + objects + vibe
 *
 * Everything downstream (splat anchors, "where is my X?", trip replay) reads from
 * these shapes. If you need a new field, add it here first — do not widen types
 * at the call site.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/**
 * WGS84 degrees. The ONLY real-world coordinate in this contract.
 *
 * Geo is anchored exactly once, at `Trip.place.origin`. Everything else —
 * TrackPoint.pos, Moment.place.pos, ObjectSighting.worldPos — stays in the
 * robot's local metric frame, because that is the frame it actually navigates
 * in. lib/geo.ts converts between the two for the map, lib/globe/geo.ts for the
 * globe — two conversions on purpose, see the header of either file.
 *
 * Putting a lat/lng on every moment instead would be derived data that can drift
 * from `pos`, and it would double the payload crossing the RSC boundary.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Normalized to the frame: [x, y, w, h], each 0..1, origin top-left. */
export type BBox = [number, number, number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — lightweight detection
// ─────────────────────────────────────────────────────────────────────────────

export type DetectionSource = "onboard" | "cloud" | "manual";

export interface Detection {
  id: string;
  tripId: string;
  frameId: string;
  /** Seconds since trip start. The universal clock for every stage. */
  t: number;
  /** COCO class name, lowercase. */
  label: string;
  /** 0..1 */
  confidence: number;
  bbox: BBox;
  /**
   * Stable across frames for the same physical object. This is what turns a pile
   * of per-frame boxes into one ObjectSighting — without it there is no
   * "where is my water bottle", only "a water bottle was on screen 400 times".
   */
  trackId?: string;
  /** Metres from camera. iPhone LiDAR when available, monocular estimate otherwise. */
  depthM?: number;
  /** Back-projected into the trip's local frame. Becomes the splat anchor. */
  worldPos?: Vec3;
  source: DetectionSource;
}

/**
 * Audio is a first-class trigger source, not an afterthought — laughter and a
 * spike in speech energy are stronger moment signals than anything visual.
 */
export interface AudioEvent {
  t: number;
  durationSec: number;
  kind: "speech" | "laughter" | "music" | "ambient";
  /** 0..1 normalized loudness. */
  energy: number;
}

/** Robot odometry breadcrumb. Drives the trip map and the nav targets. */
export interface TrackPoint {
  t: number;
  /** Local trip frame, metres. Not lat/lng — the robot navigates in its own frame. */
  pos: Vec2;
  /** Radians, 0 = +x. */
  heading: number;
  /** Metres/sec. Near-zero for a sustained window is the `dwell` trigger. */
  speed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — moment candidate
// ─────────────────────────────────────────────────────────────────────────────

export type Trigger =
  /** A label not yet seen this trip. Strongest cheap visual signal. */
  | { kind: "novel_object"; label: string }
  | { kind: "face_count"; value: number }
  /** Robot held still — you stopped, so something mattered. */
  | { kind: "dwell"; seconds: number }
  | { kind: "audio_energy"; value: number }
  | { kind: "laughter" }
  | { kind: "speech_keyword"; phrase: string }
  /** Histogram distance between keyframes, 0..1. */
  | { kind: "scene_change"; value: number };

export type TriggerKind = Trigger["kind"];

export type CandidateStatus = "promoted" | "discarded" | "pending";

export interface MomentCandidate {
  id: string;
  tripId: string;
  tStart: number;
  tEnd: number;
  triggers: Trigger[];
  /** Weighted sum of triggers. See TRIGGER_WEIGHTS in lib/pipeline.ts. */
  score: number;
  status: CandidateStatus;
  /** Human-readable, shown in the pipeline timeline. Only set when discarded. */
  discardReason?: string;
  detectionIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — moment
// ─────────────────────────────────────────────────────────────────────────────

export interface Keyframe {
  id: string;
  t: number;
  /** Absent until the real capture lands; components fall back to a procedural placeholder. */
  url?: string;
  /** Seeds the procedural placeholder so it is stable across reloads. */
  placeholderSeed: number;
  /** Base hue for the placeholder, so a lakeside frame never looks like a sunset. */
  hue?: number;
  width: number;
  height: number;
}

/** Many Detections of one physical object, collapsed by trackId. */
export interface ObjectSighting {
  label: string;
  trackId: string;
  /** Peak confidence across the track, not the mean — we want the best evidence. */
  confidence: number;
  firstSeenT: number;
  lastSeenT: number;
  /** The box from the highest-confidence frame. */
  bestBbox: BBox;
  keyframeId: string;
  detectionCount: number;
  /** Clickable anchor inside the splat. */
  worldPos?: Vec3;
}

export interface TranscriptSegment {
  id: string;
  t: number;
  durationSec: number;
  speaker: string;
  text: string;
  confidence: number;
}

export type SplatStatus = "ready" | "processing" | "failed";

/**
 * How a real capture is framed when it renders.
 *
 * Purely presentational, and optional: a moment with no reconstruction never
 * needs one, and a capture that happens to land upright doesn't either. It
 * exists because captures arrive in whatever frame the reconstructor used —
 * INRIA-layout PLYs are y-down, an indoor room is a different scale from an
 * outdoor scene — and the alternative is hardcoding one capture's orientation
 * into the viewer, which is what we did before and it only ever fit one scene.
 */
export interface SplatView {
  /** Which way is up for the camera. y-down captures want [0, -1, 0]. Check,
   *  don't assume — file layout does not tell you which way a capture stands. */
  cameraUp?: Vec3;
  cameraPosition?: Vec3;
  cameraLookAt?: Vec3;
  scenePosition?: Vec3;
  /** Degrees, XYZ order. Applied to the splat scene as a quaternion. */
  sceneRotationDeg?: Vec3;
  sceneScale?: number;
  /** 0–255. Drops near-invisible splats; real memory savings on a big capture. */
  alphaRemovalThreshold?: number;
}

export interface SplatRef {
  status: SplatStatus;
  /** .spz / .ply / .splat under /public/mock. Only when status === "ready". */
  url?: string;
  pointCount?: number;
  captureFrameCount?: number;
  bounds?: { min: Vec3; max: Vec3 };
  /** Shown while processing, and as the reason when failed. */
  note?: string;
  /** Framing for the real renderer. Ignored by the synthetic preview. */
  view?: SplatView;
}

export interface MusicPick {
  trackName: string;
  artist: string;
  spotifyUri: string;
  /** The rationale tying the pick to vibe.tags. This is the whole charm of the feature. */
  chosenBecause: string;
}

export interface Vibe {
  mood: string;
  /** 0..1 */
  energy: number;
  tags: string[];
}

export interface Moment {
  id: string;
  tripId: string;
  candidateId: string;
  /** LLM-generated from transcript + objects. */
  title: string;
  summary: string;
  tStart: number;
  tEnd: number;
  /** keyframes[0] is the thumbnail. Never empty. */
  keyframes: Keyframe[];
  place: { label: string; pos: Vec2 };
  people: string[];
  objects: ObjectSighting[];
  transcript: TranscriptSegment[];
  splat: SplatRef;
  music?: MusicPick;
  vibe: Vibe;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trip
// ─────────────────────────────────────────────────────────────────────────────

export interface Trip {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  place: {
    label: string;
    region: string;
    country: string;
    /**
     * Where this trip's local metric frame sits on Earth. Local ground metres are
     * [east, south] — +x east, +z south — so a y-down SVG map is north-up with no
     * transform, and `localToGeo` needs only this one anchor.
     *
     * Today these are authored. Tomorrow the robot's first GPS fix writes it, and
     * nothing else in the contract moves.
     */
    origin: GeoPoint;
  };
  path: TrackPoint[];
  moments: Moment[];
  /** Kept alongside promoted moments so the timeline can show what was rejected. */
  candidates: MomentCandidate[];
  /** Raw stage-1 output. Thousands of rows; the timeline bins them. */
  detections: Detection[];
  audioEvents: AudioEvent[];
}

export interface TripStats {
  durationSec: number;
  distanceM: number;
  momentCount: number;
  candidateCount: number;
  detectionCount: number;
  distinctObjectCount: number;
  splatsReady: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Object index — powers "where is my X?"
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexedSighting extends ObjectSighting {
  momentId: string;
  momentTitle: string;
  placeLabel: string;
  /** Which trip this sighting belongs to — the index spans all of them. */
  tripId: string;
  tripTitle: string;
  /**
   * Absolute wall-clock of `lastSeenT`. Trip-relative seconds are NOT comparable
   * across trips — "seen at 3900s" means nothing without knowing which trip — so
   * cross-trip recency ranking has to use this.
   */
  lastSeenAt: string;
  /** Enough to render the frame it was seen in, without loading the whole moment. */
  thumbnail: { placeholderSeed: number; hue?: number; url?: string };
}

export interface ObjectIndexEntry {
  label: string;
  sightings: IndexedSighting[];
  /**
   * Most recent sighting time — "you last saw it 20 minutes in".
   *
   * Trip-relative, so it is only meaningful alongside `best.tripId`. In a merged
   * cross-trip index this is the offset within whichever trip `best` came from;
   * use `lastSeenAt` for anything that compares across trips.
   */
  lastSeenT: number;
  /** Absolute wall-clock of the most recent sighting. Comparable across trips. */
  lastSeenAt: string;
  /** Highest-confidence sighting; what "show me in 3D" jumps to. */
  best: IndexedSighting;
  /**
   * Pose the robot would drive to. Derived from the sighting's worldPos + path.
   *
   * NOTE the unit mismatch with `TrackPoint.heading`, which is radians from +x:
   * this `heading` is a compass bearing in DEGREES, 0–360, clockwise from +z,
   * because it is rendered directly in the UI. Don't mix the two.
   */
  navTarget?: { pos: Vec2; heading: number; approachFromT: number };
}

export interface ObjectSearchResult {
  entry: ObjectIndexEntry;
  /** 0..1 match strength against the query. */
  matchScore: number;
  matchedOn: "exact" | "alias" | "fuzzy" | "category";
}
