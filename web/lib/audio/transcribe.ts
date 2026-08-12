/**
 * Whisper, in the tab.
 *
 * Same posture as lib/detector.ts and for the same reason: the frames never
 * leave the machine, and neither does the audio. That is a property the capture
 * flow advertises, and running speech recognition on a server would quietly end
 * it — speech is the most sensitive thing a walk records.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `base` AND NOT SOMETHING BETTER
 *
 * whisper-base is ~145 MB quantised and transcribes a 3-minute clip in roughly
 * a minute on a mid laptop. `small` is three times the download for an accuracy
 * gain that does not change the ANSWER here — the output feeds an eight-second
 * scoring window and a phrase lexicon, not a subtitle file. Somebody reading
 * the transcript wants the gist; the scorer wants to know that a person spoke
 * and roughly when.
 *
 * The model is cached at module scope, so a second clip pays nothing.
 */
import { pipeline, type ProgressCallback } from "@huggingface/transformers";

import type { TranscriptSegment } from "../types";
import { cleanSegments } from "./events";
import { WHISPER_SAMPLE_RATE } from "./extract";

export const WHISPER_MODEL = "onnx-community/whisper-base";

/** Roughly the download, so the UI can say what it is waiting for. */
export const WHISPER_APPROX_MB = 145;

/** Whisper's own limit: it sees 30 s at a time however long the clip is. */
const CHUNK_SEC = 30;

/**
 * Overlap between chunks, so a word split across a boundary is heard whole in
 * one of them. The model's decoder stitches the overlap back out.
 */
const STRIDE_SEC = 5;

type ASR = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string; chunks?: { text?: string; timestamp?: [number, number | null] }[] }>;

let cached: Promise<ASR> | null = null;

export function loadWhisper(onProgress?: ProgressCallback): Promise<ASR> {
  return (cached ??= pipeline("automatic-speech-recognition", WHISPER_MODEL, {
    dtype: "q8",
    progress_callback: onProgress,
  }) as unknown as Promise<ASR>);
}

export interface TranscribeOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/**
 * Audio in, timestamped segments out.
 *
 * Returns [] rather than throwing when the model finds nothing — silence is a
 * valid answer and the caller carries on without a transcript.
 */
export async function transcribeAudio(
  samples: Float32Array,
  options: TranscribeOptions = {},
): Promise<TranscriptSegment[]> {
  const asr = await loadWhisper(options.onProgress);
  if (options.signal?.aborted) throw new DOMException("cancelled", "AbortError");

  const output = await asr(samples, {
    // Segment-level, not word-level. A segment is the unit the scorer's window
    // can actually use, and word timestamps cost noticeably more to decode.
    return_timestamps: true,
    chunk_length_s: CHUNK_SEC,
    stride_length_s: STRIDE_SEC,
  });

  const chunks = output.chunks ?? [];

  // No chunks but some text means the model returned one undivided blob — rare,
  // and useless for scoring since it has no time. Better to keep it as a single
  // segment spanning the clip than to throw the words away.
  if (!chunks.length) {
    const text = (output.text ?? "").trim();
    if (!text) return [];
    return cleanSegments([
      {
        id: "seg_0",
        t: 0,
        durationSec: samples.length / WHISPER_SAMPLE_RATE,
        speaker: "unknown",
        text,
        confidence: 0.5,
      },
    ]);
  }

  const total = samples.length / WHISPER_SAMPLE_RATE;
  const segments: TranscriptSegment[] = [];

  chunks.forEach((chunk, i) => {
    const [start, end] = chunk.timestamp ?? [0, null];
    const t = Number.isFinite(start) ? start : 0;
    // A trailing chunk can come back with a null end — the model ran out of
    // audio mid-phrase. Close it at the clip's end rather than dropping it.
    const stop = end != null && Number.isFinite(end) ? end : total;

    segments.push({
      id: `seg_${i}`,
      t: Number(t.toFixed(2)),
      durationSec: Number(Math.max(0, stop - t).toFixed(2)),
      // Whisper does not diarise. Saying "unknown" is the honest label; naming
      // a speaker would be inventing one.
      speaker: "unknown",
      text: (chunk.text ?? "").trim(),
      // Not a real confidence — the pipeline does not surface per-chunk logits.
      // A constant is at least not a fabricated per-segment number.
      confidence: 0.7,
    });
  });

  return cleanSegments(segments);
}
