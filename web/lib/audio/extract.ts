/**
 * Pulling 16 kHz mono audio out of a video, in the browser.
 *
 * Whisper wants exactly one thing: mono Float32 at 16 kHz. Handing it anything
 * else means the model resamples internally at best, or transcribes gibberish
 * at worst. `tools/video_intel/process_video.py` already normalises to the same
 * format on the Python side, so both paths agree about what audio is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OfflineAudioContext DOES THE RESAMPLING
 *
 * `decodeAudioData` gives whatever the file holds — 48 kHz stereo, usually.
 * Rendering that through an OfflineAudioContext constructed AT 16 kHz makes the
 * browser's own resampler do the work, which is both faster and better than
 * anything worth hand-writing here. Mixing to mono is then an average of the
 * channels rather than taking the left one, because a phone recording with a
 * directional mic can put most of the voice in one channel.
 *
 * The whole clip is decoded into memory. Three minutes at 16 kHz mono Float32
 * is ~11 MB, which is fine; the SOURCE decode is the expensive moment, since a
 * 48 kHz stereo decode of the same clip is ~69 MB before it is rendered down.
 */

export interface ExtractedAudio {
  /** Mono, 16 kHz, −1..1. */
  samples: Float32Array;
  sampleRate: 16000;
  durationSec: number;
}

export const WHISPER_SAMPLE_RATE = 16000;

/** Above this, decoding is slow enough to be worth refusing. KIRI caps at 3 min. */
const MAX_SECONDS = 15 * 60;

export class NoAudioTrackError extends Error {
  constructor() {
    super("That clip has no audio track.");
    this.name = "NoAudioTrackError";
  }
}

/**
 * Decode a video's audio to what Whisper expects.
 *
 * Throws NoAudioTrackError for a silent file so the caller can carry on
 * without a transcript rather than treating it as a failure — plenty of
 * footage has no sound, and it is still a perfectly good walk.
 */
export async function extractAudio(file: Blob): Promise<ExtractedAudio> {
  const bytes = await file.arrayBuffer();

  // A plain AudioContext only to decode: OfflineAudioContext cannot decode at a
  // sample rate it was not constructed with on every browser, and this one is
  // closed immediately.
  const AudioCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) throw new Error("This browser cannot decode audio.");

  const decoder = new AudioCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(bytes);
  } catch {
    // decodeAudioData rejects on a container with no audio stream, and on one
    // whose codec this browser cannot read. Both mean "no transcript", and
    // neither should stop a walk being built.
    throw new NoAudioTrackError();
  } finally {
    void decoder.close();
  }

  if (decoded.numberOfChannels === 0 || decoded.length === 0) throw new NoAudioTrackError();
  if (decoded.duration > MAX_SECONDS) {
    throw new Error(`That clip is ${Math.round(decoded.duration / 60)} minutes — too long to transcribe here.`);
  }

  // Render through a 16 kHz context so the browser resamples for us.
  const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);

  const source = offline.createBufferSource();
  source.buffer = decoded;

  // Average the channels rather than taking the first: a directional mic can
  // put most of a voice in one side, and dropping it would halve the speech.
  if (decoded.numberOfChannels > 1) {
    const merger = offline.createChannelMerger(1);
    const splitter = offline.createChannelSplitter(decoded.numberOfChannels);
    const gain = offline.createGain();
    gain.gain.value = 1 / decoded.numberOfChannels;
    source.connect(splitter);
    for (let c = 0; c < decoded.numberOfChannels; c++) splitter.connect(gain, c);
    gain.connect(merger, 0, 0);
    merger.connect(offline.destination);
  } else {
    source.connect(offline.destination);
  }

  source.start();
  const rendered = await offline.startRendering();

  return {
    samples: rendered.getChannelData(0),
    sampleRate: WHISPER_SAMPLE_RATE,
    durationSec: decoded.duration,
  };
}

/**
 * Is there anything here worth sending to a model?
 *
 * Whisper on silence does not return nothing — it invents, most reliably a
 * subtitle credit it saw thousands of in training. Checking first is cheaper
 * than filtering after, and more honest than pretending the model was quiet.
 */
export function hasAudibleContent(samples: Float32Array, floor = 0.005): boolean {
  // Peak rather than mean: a clip that is silent except for ten seconds of
  // speech has a tiny mean and is very much worth transcribing.
  let peak = 0;
  const step = Math.max(1, Math.floor(samples.length / 20000));
  for (let i = 0; i < samples.length; i += step) {
    const v = samples[i] < 0 ? -samples[i] : samples[i];
    if (v > peak) peak = v;
  }
  return peak > floor;
}
