/**
 * The detection → candidate → moment pipeline.
 *
 * This is REAL logic, not a stub. It runs over mock detections tonight and over
 * the robot's actual output tomorrow — the only thing that changes is who calls
 * `scoreCandidates`. Keep it pure and free of React/Next imports.
 *
 * Design intent: stage 2 must be cheap enough to run continuously on-device, so
 * it only looks at detection metadata, odometry speed, and audio envelopes —
 * never pixels. Anything needing pixels or an LLM happens in stage 3, which only
 * runs for windows that survived stage 2.
 */
import { pickBestView } from "./detect/viewQuality";
import type {
  AudioEvent,
  Detection,
  Keyframe,
  Moment,
  MomentCandidate,
  MusicPick,
  ObjectSighting,
  Trigger,
  TrackPoint,
  TranscriptSegment,
  Trip,
  TripStats,
  SplatRef,
  Vec2,
  Vec3,
  Vibe,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Tunables — expect to tweak these live during the hackathon.
// ─────────────────────────────────────────────────────────────────────────────

export const TRIGGER_WEIGHTS: Record<Trigger["kind"], number> = {
  novel_object: 0.3,
  face_count: 0.22,
  dwell: 0.26,
  audio_energy: 0.2,
  laughter: 0.34,
  speech_keyword: 0.24,
  scene_change: 0.14,
};

export const PIPELINE_CONFIG = {
  /** Sliding window length, seconds. */
  windowSec: 8,
  /** Window stride, seconds. */
  strideSec: 3,
  /** A window must reach this to become part of a candidate. */
  windowThreshold: 0.3,
  /** A merged candidate must reach this to be promoted to a full Moment. */
  promoteThreshold: 0.62,
  /** Shorter than this and there is not enough parallax to build a splat. */
  minCandidateSec: 12,
  /** Speed below this counts as the robot having stopped. */
  dwellSpeedMps: 0.28,
  /** Windows this close together get merged into one candidate. */
  mergeGapSec: 10,
  keyframesPerMoment: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — scoreCandidates
// ─────────────────────────────────────────────────────────────────────────────

export interface KeywordHit {
  t: number;
  phrase: string;
}

export interface ScoreInput {
  tripId: string;
  durationSec: number;
  detections: Detection[];
  audioEvents?: AudioEvent[];
  path?: TrackPoint[];
  /** Keyword spotter output. Cheap on-device, runs on the audio stream. */
  keywordHits?: KeywordHit[];
}

export function scoreTriggers(triggers: Trigger[]): number {
  let score = 0;
  for (const tr of triggers) {
    const w = TRIGGER_WEIGHTS[tr.kind];
    switch (tr.kind) {
      case "face_count":
        // Two people is a moment; six is a crowd, not six times a moment.
        score += w * Math.min(1, Math.log2(1 + tr.value) / 2);
        break;
      case "dwell":
        score += w * Math.min(1, tr.seconds / 25);
        break;
      case "audio_energy":
        score += w * tr.value;
        break;
      case "scene_change":
        score += w * tr.value;
        break;
      default:
        score += w;
    }
  }
  return Math.min(1, score);
}

export function scoreCandidates(input: ScoreInput): MomentCandidate[] {
  const { tripId, durationSec, detections } = input;
  const audioEvents = input.audioEvents ?? [];
  const path = input.path ?? [];
  const keywordHits = input.keywordHits ?? [];
  const { windowSec, strideSec, windowThreshold, mergeGapSec } = PIPELINE_CONFIG;

  const sorted = [...detections].sort((a, b) => a.t - b.t);

  // First time each label appears anywhere in the trip → the novelty signal.
  const firstSeenByLabel = new Map<string, number>();
  for (const d of sorted) {
    if (!firstSeenByLabel.has(d.label)) firstSeenByLabel.set(d.label, d.t);
  }

  interface Win {
    tStart: number;
    tEnd: number;
    triggers: Trigger[];
    score: number;
    detectionIds: string[];
  }

  const windows: Win[] = [];
  let prevLabels: Set<string> = new Set();

  for (let ws = 0; ws + windowSec <= durationSec + strideSec; ws += strideSec) {
    const we = ws + windowSec;
    const inWin = sorted.filter((d) => d.t >= ws && d.t < we);
    const labels = new Set(inWin.map((d) => d.label));
    const triggers: Trigger[] = [];

    for (const label of labels) {
      const firstSeen = firstSeenByLabel.get(label)!;
      if (firstSeen >= ws && firstSeen < we) triggers.push({ kind: "novel_object", label });
    }

    const faceTracks = new Set(
      inWin.filter((d) => d.label === "person" && d.confidence > 0.5).map((d) => d.trackId ?? d.id),
    );
    if (faceTracks.size >= 2) triggers.push({ kind: "face_count", value: faceTracks.size });

    const dwellSec = dwellSecondsIn(path, ws, we);
    if (dwellSec >= 4) triggers.push({ kind: "dwell", seconds: Number(dwellSec.toFixed(1)) });

    const speech = audioEvents.filter(
      (a) => a.kind === "speech" && a.t < we && a.t + a.durationSec > ws,
    );
    if (speech.length) {
      const energy = Math.max(...speech.map((a) => a.energy));
      if (energy > 0.35) triggers.push({ kind: "audio_energy", value: Number(energy.toFixed(2)) });
    }

    if (audioEvents.some((a) => a.kind === "laughter" && a.t < we && a.t + a.durationSec > ws)) {
      triggers.push({ kind: "laughter" });
    }

    for (const hit of keywordHits) {
      if (hit.t >= ws && hit.t < we) triggers.push({ kind: "speech_keyword", phrase: hit.phrase });
    }

    // Scene change derived from label-set churn — no pixels needed, which is the
    // whole point of keeping stage 2 cheap.
    if (prevLabels.size && labels.size) {
      const churn = 1 - jaccard(prevLabels, labels);
      if (churn > 0.45) triggers.push({ kind: "scene_change", value: Number(churn.toFixed(2)) });
    }
    if (labels.size) prevLabels = labels;

    const score = scoreTriggers(triggers);
    if (score >= windowThreshold) {
      windows.push({
        tStart: ws,
        tEnd: we,
        triggers,
        score,
        detectionIds: inWin.map((d) => d.id),
      });
    }
  }

  // Merge overlapping / adjacent windows into candidate spans.
  const merged: Win[] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.tStart - last.tEnd <= mergeGapSec) {
      last.tEnd = Math.max(last.tEnd, w.tEnd);
      last.triggers.push(...w.triggers);
      last.detectionIds.push(...w.detectionIds);
    } else {
      merged.push({ ...w, triggers: [...w.triggers], detectionIds: [...w.detectionIds] });
    }
  }

  return merged.map((w, i) => {
    const triggers = dedupeTriggers(w.triggers);
    const score = scoreTriggers(triggers);
    const durationSecSpan = w.tEnd - w.tStart;
    const candidate: MomentCandidate = {
      id: `cand_${tripId}_${i.toString().padStart(3, "0")}`,
      tripId,
      tStart: Number(w.tStart.toFixed(1)),
      tEnd: Number(w.tEnd.toFixed(1)),
      triggers,
      score: Number(score.toFixed(3)),
      status: "pending",
      detectionIds: Array.from(new Set(w.detectionIds)),
    };

    const reason = discardReasonFor(candidate, durationSecSpan);
    if (reason) {
      candidate.status = "discarded";
      candidate.discardReason = reason;
    }
    return candidate;
  });
}

/**
 * Why a candidate did not become a moment. Surfaced in the timeline — being able
 * to explain a rejection is more convincing than only showing successes.
 */
function discardReasonFor(c: MomentCandidate, spanSec: number): string | undefined {
  const { promoteThreshold, minCandidateSec } = PIPELINE_CONFIG;
  if (spanSec < minCandidateSec) {
    return `only ${spanSec.toFixed(0)}s of signal — too short to reconstruct a splat`;
  }
  if (c.score < promoteThreshold) {
    return `score ${c.score.toFixed(2)} under ${promoteThreshold} threshold`;
  }
  const kinds = new Set(c.triggers.map((t) => t.kind));
  const visualOnly = !kinds.has("laughter") && !kinds.has("audio_energy") && !kinds.has("speech_keyword");
  if (visualOnly && !kinds.has("dwell")) {
    return "visual signal only, robot never stopped — likely just passing through";
  }
  return undefined;
}

function dwellSecondsIn(path: TrackPoint[], tStart: number, tEnd: number): number {
  if (!path.length) return 0;
  const pts = path.filter((p) => p.t >= tStart && p.t <= tEnd);
  if (pts.length < 2) return 0;
  let dwell = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].speed < PIPELINE_CONFIG.dwellSpeedMps) dwell += pts[i].t - pts[i - 1].t;
  }
  return dwell;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** Collapse repeats from overlapping windows, keeping the strongest of each kind. */
function dedupeTriggers(triggers: Trigger[]): Trigger[] {
  const novel = new Map<string, Trigger>();
  const keyword = new Map<string, Trigger>();
  let faces: Extract<Trigger, { kind: "face_count" }> | undefined;
  let dwell: Extract<Trigger, { kind: "dwell" }> | undefined;
  let energy: Extract<Trigger, { kind: "audio_energy" }> | undefined;
  let scene: Extract<Trigger, { kind: "scene_change" }> | undefined;
  let laughter = false;

  for (const t of triggers) {
    switch (t.kind) {
      case "novel_object":
        novel.set(t.label, t);
        break;
      case "speech_keyword":
        keyword.set(t.phrase, t);
        break;
      case "face_count":
        if (!faces || t.value > faces.value) faces = t;
        break;
      case "dwell":
        // Overlapping windows each report their own dwell; take the longest
        // rather than summing, or a long stop would score absurdly high.
        if (!dwell || t.seconds > dwell.seconds) dwell = t;
        break;
      case "audio_energy":
        if (!energy || t.value > energy.value) energy = t;
        break;
      case "scene_change":
        if (!scene || t.value > scene.value) scene = t;
        break;
      case "laughter":
        laughter = true;
        break;
    }
  }

  const out: Trigger[] = [...novel.values()];
  if (faces) out.push(faces);
  if (dwell) out.push(dwell);
  if (energy) out.push(energy);
  if (laughter) out.push({ kind: "laughter" });
  out.push(...keyword.values());
  if (scene) out.push(scene);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — promoteToMoment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The parts of a Moment a model writes, not the pipeline: title, summary, place
 * label, transcript, music pick, vibe. Tomorrow this comes back from an LLM call
 * over the moment's frames + audio; tonight it is authored in lib/mock.
 */
export interface MomentContent {
  id: string;
  title: string;
  summary: string;
  place: { label: string; pos: Vec2 };
  people: string[];
  transcript: TranscriptSegment[];
  splat: SplatRef;
  music?: MusicPick;
  vibe: Vibe;
  /** Hue for procedural keyframe placeholders. */
  hue?: number;
}

export function promoteToMoment(
  candidate: MomentCandidate,
  detections: Detection[],
  content: MomentContent,
  /** Odometry, so best-view scoring can tell a still frame from a blurred one. */
  path: TrackPoint[] = [],
): Moment {
  const inSpan = detections.filter((d) => d.t >= candidate.tStart && d.t <= candidate.tEnd);
  const keyframes = buildKeyframes(content.id, candidate.tStart, candidate.tEnd, content.hue);
  const objects = collapseToSightings(inSpan, keyframes, path);

  return {
    id: content.id,
    tripId: candidate.tripId,
    candidateId: candidate.id,
    title: content.title,
    summary: content.summary,
    tStart: candidate.tStart,
    tEnd: candidate.tEnd,
    keyframes,
    place: content.place,
    people: content.people,
    objects,
    transcript: content.transcript,
    splat: content.splat,
    music: content.music,
    vibe: content.vibe,
  };
}

/**
 * Many Detections → one ObjectSighting per trackId.
 *
 * TWO DIFFERENT "BESTS", and conflating them was a bug.
 *
 *   · `confidence` stays PEAK confidence across the track. It answers "how sure
 *     are we this is a bottle at all", and it is what ranks one sighting against
 *     another in the object index.
 *   · `bestBbox` / `keyframeId` now come from the best-LOOKING frame, scored by
 *     lib/detect/viewQuality.ts. They answer "which look at it do we show, and
 *     which pose would reproduce it", and confidence is a poor proxy for that —
 *     detectors peak on huge, close, badly-framed objects.
 *
 * Passing `path` enables the motion-blur term; without it that term stays
 * neutral and everything else still scores.
 */
export function collapseToSightings(
  detections: Detection[],
  keyframes: Keyframe[],
  path: TrackPoint[] = [],
): ObjectSighting[] {
  const byTrack = new Map<string, Detection[]>();
  for (const d of detections) {
    const key = d.trackId ?? d.id;
    const arr = byTrack.get(key);
    if (arr) arr.push(d);
    else byTrack.set(key, [d]);
  }

  const sightings: ObjectSighting[] = [];
  for (const [trackId, dets] of byTrack) {
    // Ignore flickers — a two-frame track is usually a false positive.
    if (dets.length < 3) continue;

    const peak = dets.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const bestView = pickBestView(dets, { path })!;
    const best = bestView.detection;
    const withWorld = dets.filter((d) => d.worldPos);
    const worldPos: Vec3 | undefined = withWorld.length
      ? (withWorld
          .reduce<Vec3>(
            (acc, d) => [
              acc[0] + d.worldPos![0] / withWorld.length,
              acc[1] + d.worldPos![1] / withWorld.length,
              acc[2] + d.worldPos![2] / withWorld.length,
            ],
            [0, 0, 0],
          )
          .map((v) => Number(v.toFixed(3))) as Vec3)
      : undefined;

    sightings.push({
      label: peak.label,
      trackId,
      confidence: peak.confidence,
      firstSeenT: Math.min(...dets.map((d) => d.t)),
      lastSeenT: Math.max(...dets.map((d) => d.t)),
      bestBbox: best.bbox,
      viewScore: Number(bestView.view.score.toFixed(3)),
      bestT: best.t,
      keyframeId: nearestKeyframe(keyframes, best.t).id,
      detectionCount: dets.length,
      worldPos,
    });
  }

  return sightings.sort((a, b) => b.confidence - a.confidence);
}

function buildKeyframes(momentId: string, tStart: number, tEnd: number, hue?: number): Keyframe[] {
  const n = PIPELINE_CONFIG.keyframesPerMoment;
  return Array.from({ length: n }, (_, i) => {
    const t = tStart + ((i + 0.5) / n) * (tEnd - tStart);
    return {
      id: `${momentId}_kf${i}`,
      t: Number(t.toFixed(1)),
      placeholderSeed: hashString(`${momentId}_${i}`) % 100000,
      hue,
      width: 640,
      height: 400,
    } satisfies Keyframe;
  });
}

function nearestKeyframe(keyframes: Keyframe[], t: number): Keyframe {
  return keyframes.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
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
// Trip-level derivations
// ─────────────────────────────────────────────────────────────────────────────

export function computeTripStats(trip: Trip, distanceM: number): TripStats {
  const distinct = new Set<string>();
  for (const m of trip.moments) for (const o of m.objects) distinct.add(o.label);

  return {
    durationSec:
      (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000,
    distanceM: Math.round(distanceM),
    momentCount: trip.moments.length,
    candidateCount: trip.candidates.length,
    detectionCount: trip.detections.length,
    distinctObjectCount: distinct.size,
    splatsReady: trip.moments.filter((m) => m.splat.status === "ready").length,
  };
}

/**
 * Bin raw detections for the timeline. Called on the server so the thousands of
 * raw Detection rows never cross into the client bundle — only the bins do.
 */
export interface DetectionBin {
  t: number;
  count: number;
  /** Per-label-family counts, for the stacked tick color. */
  byFamily: Record<string, number>;
}

export function binDetections(
  detections: Detection[],
  durationSec: number,
  binCount = 240,
  familyOf: (label: string) => string = (l) => l,
): DetectionBin[] {
  const binSec = durationSec / binCount;
  const bins: DetectionBin[] = Array.from({ length: binCount }, (_, i) => ({
    t: Number((i * binSec).toFixed(1)),
    count: 0,
    byFamily: {},
  }));

  for (const d of detections) {
    const i = Math.min(binCount - 1, Math.max(0, Math.floor(d.t / binSec)));
    bins[i].count++;
    const fam = familyOf(d.label);
    bins[i].byFamily[fam] = (bins[i].byFamily[fam] ?? 0) + 1;
  }
  return bins;
}
