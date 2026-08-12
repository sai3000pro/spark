/**
 * Video in, walk out — the one implementation of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT A COMPONENT
 *
 * This pipeline used to live inside VideoWalkPanel's `run()`, which was fine
 * while a dropped file was the only way a video could arrive. It is not any
 * more: a clip recorded on the phone lands on the server, and it has to become
 * a walk by exactly the same route, or the two paths produce different answers
 * from the same footage and nobody can say which is right.
 *
 * So the funnel lives here and both callers drive it:
 *
 *   components/live/VideoWalkPanel   a file dropped on the laptop
 *   components/live/CapturedWalk     a clip that arrived from the phone
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT RUNS WHERE, AND WHY IT STAYS THAT WAY
 *
 * Detection runs IN THE TAB. That is not a limitation being worked around — it
 * is what lets the panel say "the frames never leave this machine" and mean it,
 * and it is why no GPU box or API key is needed to get a walk out of a video.
 * The reconstruction is a separate, slower errand that may involve a server;
 * the walk never waits for it. See lib/reconstruction/dispatch.ts.
 *
 * Scoring runs on the SERVER, through the same `scoreCandidates` the authored
 * demo walks use — /api/upload/walk. Nothing about the finding is staged.
 */
import { loadDetector, type ProgressInfo } from "@/lib/detector";
import { probeVideo, sampleFrames } from "@/lib/video/sampleFrames";
import { trackDetections, type FrameDetections } from "@/lib/video/trackFrames";

/** Detector confidence floor. Below this a frame is mostly furniture hallucination. */
export const THRESHOLD = 0.5;

/** The scorer's window is 8 s; a shorter clip cannot contain one. */
export const MIN_DURATION_SEC = 4;

export type WalkPhase = "loading-model" | "sampling" | "detecting" | "building";

export interface WalkProgress {
  phase: WalkPhase;
  /** Model download progress, during `loading-model`. */
  download?: ProgressInfo | null;
  /** Frames done / total, during `sampling` and `detecting`. */
  step?: { done: number; total: number };
}

export interface BuiltWalk {
  tripId: string;
  href: string;
  detections: number;
  candidates: number;
  discarded: number;
  moments: number;
}

export interface BuildWalkInput {
  video: File;
  modelId: string;
  /** Attaches the reconstruction to the walk, when one is already in flight. */
  splatJobId?: string | null;
  signal?: AbortSignal;
  onProgress?: (p: WalkProgress) => void;
}

/**
 * Throws on anything that stops a walk being built, including an AbortError the
 * caller passed in. Callers distinguish the two — cancelling is not a failure.
 */
export async function buildWalkFromVideo(input: BuildWalkInput): Promise<BuiltWalk> {
  const { video, modelId, splatJobId = null, signal, onProgress } = input;
  const report = (p: WalkProgress) => onProgress?.(p);

  const info = await probeVideo(video);
  if (info.durationSec < MIN_DURATION_SEC) {
    throw new Error(
      `that clip is ${info.durationSec.toFixed(1)}s — too short for the scorer's 8s window to see anything`,
    );
  }

  // 1 · the model. Cached at module scope, so a second video is instant.
  report({ phase: "loading-model", download: null });
  const detector = await loadDetector(modelId, (d) =>
    report({ phase: "loading-model", download: d }),
  );

  // 2 · the frames. Sampled by seeking, so a 4-minute clip does not take
  //     4 minutes.
  report({ phase: "sampling", step: { done: 0, total: 0 } });
  const { frames } = await sampleFrames(video, {
    signal,
    onFrame: (done, total) => report({ phase: "sampling", step: { done, total } }),
  });

  // 3 · the detector, frame by frame. The slow part, and the only part that is
  //     actually doing perception.
  report({ phase: "detecting", step: { done: 0, total: frames.length } });
  const perFrame: FrameDetections[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
    // One pass per frame — the video already gives the detector many looks at
    // each object, so the still-frame TTA presets would only slow it.
    const run = await detector.detect(frames[i].dataUrl, {
      threshold: THRESHOLD,
      quality: "fast",
    });
    perFrame.push({ t: frames[i].t, frameId: frames[i].frameId, raw: run.detections });
    report({ phase: "detecting", step: { done: i + 1, total: frames.length } });
  }

  // 4 · link boxes into tracks, so a person standing still is one sighting
  //     rather than ninety.
  const detections = trackDetections(perFrame, { tripId: "trip_upload_pending" });
  if (!detections.length) {
    throw new Error(
      "the detector found nothing above 50% in any frame — try footage with people or objects clearly in shot",
    );
  }

  // 5 · the pipeline, on the server, on real detections.
  report({ phase: "building" });
  const res = await fetch("/api/upload/walk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      detections,
      durationSec: info.durationSec,
      sourceName: video.name,
      splatJobId,
    }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `the walk could not be built (${res.status})`);
  }

  const built = (await res.json()) as {
    tripId: string;
    href: string;
    found: { detections: number; candidates: number; discarded: number; moments: number };
  };

  return {
    tripId: built.tripId,
    href: built.href,
    detections: built.found.detections,
    candidates: built.found.candidates,
    discarded: built.found.discarded,
    moments: built.found.moments,
  };
}

/** "Reading frames · 40 of 96" — the same words wherever the pipeline runs. */
export function describeProgress(p: WalkProgress): string {
  switch (p.phase) {
    case "loading-model":
      return p.download?.progress
        ? `Loading the detector · ${Math.round(p.download.progress)}%`
        : "Loading the detector";
    case "sampling":
      return p.step?.total
        ? `Reading frames · ${p.step.done} of ${p.step.total}`
        : "Reading frames";
    case "detecting":
      return p.step?.total
        ? `Looking at frames · ${p.step.done} of ${p.step.total}`
        : "Looking at frames";
    case "building":
      return "Scoring the moments";
  }
}
