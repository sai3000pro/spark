/**
 * Turning a transcript and a waveform into things the scorer can use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *
 * `scoreCandidates` has always accepted `audioEvents` and `keywordHits`, and an
 * uploaded walk has always been handed `[]` for both. Three of its trigger
 * kinds therefore could not fire at all — `audio_energy`, `laughter` and
 * `speech_keyword`, the last two carrying the heaviest weights in the table
 * after novelty (0.34 and 0.24). That is the real reason an uploaded walk finds
 * fewer moments than an authored one: it was competing with two hands tied.
 *
 * lib/uploadedTrips.ts says so in its own header — "No audio pass yet, so there
 * is none — rather than invent one. The audio triggers therefore never fire,
 * which is the honest result." This is that pass.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED, NOT GUESSED
 *
 * Energy is RMS over the actual samples in the segment's window, normalised
 * against the loudest window in the clip. That makes it a comparison WITHIN one
 * recording, which is the only honest kind: absolute loudness depends on the
 * microphone, the gain, and how far away the phone was.
 *
 * No DOM, no model, no `window` — this is arithmetic over arrays, so it is
 * exercised in scripts/verify-pipeline.ts rather than eyeballed in a browser.
 */
import type { KeywordHit } from "../pipeline";
import type { AudioEvent, TranscriptSegment } from "../types";

/**
 * Phrases that mark someone drawing attention to something.
 *
 * A hand-written lexicon, and it is worth being clear about what it is not: it
 * is not learned, not exhaustive, and not language-agnostic. It encodes one
 * observation — that people narrate the thing worth keeping, usually while
 * pointing at it — and it fires on the narration.
 *
 * Kept short on purpose. A long list matches everything, and a trigger that
 * fires on every window is the same as one that never fires.
 */
export const ATTENTION_PHRASES: readonly string[] = [
  "look at",
  "check out",
  "oh my",
  "so cool",
  "so pretty",
  "so beautiful",
  "beautiful",
  "amazing",
  "incredible",
  "gorgeous",
  "wow",
  "whoa",
  "i love",
  "remember this",
  "over there",
  "right here",
  "that's the",
  "this is the",
];

/**
 * How Whisper writes down a laugh.
 *
 * NOT a laughter classifier — it is reading the annotation Whisper already
 * emits for non-speech sounds. It will miss quiet laughter and it will not fire
 * on a language the model annotates differently. A real classifier is a
 * separate model and a separate decision; this costs nothing and catches the
 * obvious case, so it is worth having as long as nobody mistakes it for the
 * other thing.
 */
const LAUGHTER_TOKENS = /\[\s*laugh\w*\s*\]|\(\s*laugh\w*\s*\)|\bhaha+\b|\bhehe+\b/i;

/** Root-mean-square amplitude over a window, in 0..1 before normalisation. */
export function rmsOver(
  samples: Float32Array,
  sampleRate: number,
  t: number,
  durationSec: number,
): number {
  if (!samples.length || sampleRate <= 0 || durationSec <= 0) return 0;
  const from = Math.max(0, Math.floor(t * sampleRate));
  const to = Math.min(samples.length, Math.ceil((t + durationSec) * sampleRate));
  if (to <= from) return 0;

  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

/**
 * Speech and laughter, one event per transcript segment.
 *
 * Energy is normalised against the LOUDEST segment rather than against full
 * scale, so a quietly-recorded walk still has a loud moment — the trigger is
 * "louder than the rest of this clip", which is what a raised voice actually
 * is. A clip with one segment therefore normalises to 1, which is correct:
 * there is nothing to be louder than.
 */
export function audioEventsFrom(
  segments: TranscriptSegment[],
  samples: Float32Array,
  sampleRate: number,
): AudioEvent[] {
  if (!segments.length) return [];

  const raw = segments.map((s) => rmsOver(samples, sampleRate, s.t, s.durationSec));
  const loudest = Math.max(...raw, 0);

  const events: AudioEvent[] = [];
  segments.forEach((segment, i) => {
    const energy = loudest > 0 ? Math.min(1, raw[i] / loudest) : 0;

    events.push({
      t: segment.t,
      durationSec: segment.durationSec,
      kind: "speech",
      energy: Number(energy.toFixed(3)),
    });

    if (LAUGHTER_TOKENS.test(segment.text)) {
      events.push({
        t: segment.t,
        durationSec: segment.durationSec,
        kind: "laughter",
        energy: Number(energy.toFixed(3)),
      });
    }
  });

  return events;
}

/**
 * Where someone said something that marks attention.
 *
 * The hit is timestamped to the SEGMENT, not to the word, because a segment is
 * a few seconds and the scorer's window is eight — locating a phrase to the
 * word would be precision the consumer cannot use.
 *
 * At most one hit per segment. A segment reading "wow, look at that, so cool"
 * is one person being excited once, and counting it three times would let a
 * single sentence outscore a whole minute of a walk.
 */
export function keywordHitsFrom(segments: TranscriptSegment[]): KeywordHit[] {
  const hits: KeywordHit[] = [];

  for (const segment of segments) {
    const text = segment.text.toLowerCase();
    const phrase = ATTENTION_PHRASES.find((p) => text.includes(p));
    if (phrase) hits.push({ t: segment.t, phrase });
  }

  return hits;
}

/**
 * Drop the noise Whisper produces from silence.
 *
 * A model asked to transcribe a quiet stretch will hallucinate — most famously
 * a subtitle credit, because it saw thousands of them in training. Those become
 * fake speech events at real timestamps, which is worse than no audio pass at
 * all: the scorer would promote a window because somebody's dataset had a
 * caption in it.
 */
const HALLUCINATIONS = [
  /thanks? for watching/i,
  /subscribe/i,
  /subtitles? by/i,
  /amara\.org/i,
  /www\./i,
  /^\s*you\s*$/i,
  /^\s*bye\s*$/i,
  /^[\s.,!?\-–—]*$/,
];

export function cleanSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((s) => {
    const text = s.text.trim();
    if (!text) return false;
    if (HALLUCINATIONS.some((re) => re.test(text))) return false;
    // A "segment" shorter than a syllable is a timestamp artefact.
    return s.durationSec >= 0.2;
  });
}
