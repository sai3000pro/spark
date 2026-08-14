/**
 * Walks a video file and hands back evenly-spaced frames, with their real
 * timestamps.
 *
 * This is the piece the detector bench never had. A still image is a degenerate
 * input for a temporal scorer — components/bench/Bench.tsx has to replay one
 * frame across a synthetic 16-second window to make `scoreCandidates` do
 * anything at all. A video has an actual timeline, so the detections that come
 * out of it carry real `t` values, dwell is real, novelty is real, and the
 * candidates the pipeline finds are genuinely found rather than manufactured.
 *
 * Nothing here uploads. The file is decoded by the browser's own video decoder
 * via an object URL, drawn to a canvas, and the canvas is what the detector
 * sees. The bytes never leave the tab.
 *
 * Seeking rather than playing, deliberately: `play()` runs in real time, so a
 * 4-minute clip would take 4 minutes to sample. Seeking jumps straight to each
 * timestamp, which is both faster and exactly reproducible.
 */

export interface SampledFrame {
  /** Seconds into the video. Becomes `Detection.t` verbatim. */
  t: number;
  /** Stable per video, so a detection id can be traced back to its frame. */
  frameId: string;
  /** What the detector reads. A data URL — Transformers.js accepts it directly. */
  dataUrl: string;
}

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
}

export interface SampleOptions {
  /** Frames per second to pull out. The robot's own stage 1 runs near 10. */
  fps?: number;
  /** Hard ceiling, so a long clip degrades to a coarser sample not a hung tab. */
  maxFrames?: number;
  /** Longest edge of the emitted frame, px. The detectors want ~640 anyway. */
  maxEdge?: number;
  /** Called after each frame so the UI can show real progress. */
  onFrame?: (done: number, total: number) => void;
  /** Abort between frames — sampling a long video is very cancellable. */
  signal?: AbortSignal;
}

const DEFAULTS = { fps: 3, maxFrames: 240, maxEdge: 640 } as const;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY WAIT BELOW IS ON A CLOCK
 *
 * A <video> that cannot be demuxed does NOT always fire `error`. Chrome accepts
 * a blob whose type it will not play, sits at `readyState 0`, and fires neither
 * `loadedmetadata` nor `error` — ever. Measured, not guessed: a 105 MB iPhone
 * clip with a bare `qt  ` brand (ftyp/wide/mdat/moov, structurally perfect,
 * H.264 inside) hangs exactly this way, and relabelling the blob `video/mp4`
 * does not help because the brand, not the MIME, is what the demuxer rejects.
 *
 * The old code awaited `seeked`-or-`error` with no third outcome, so that file
 * parked the whole walk on "reading frames" with no error, no progress and
 * nothing in the console. A timeout is what turns an invisible stall into a
 * sentence someone can act on.
 *
 * Generous on purpose: these are ceilings for "something is wrong", not budgets
 * for slow machines. A 105 MB blob decodes its first frame in well under a
 * second on hardware that can decode it at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const METADATA_TIMEOUT_MS = 20_000;
const SEEK_TIMEOUT_MS = 15_000;

/**
 * Would this browser even try? `""` means a flat no.
 *
 * `canPlayType` is advisory and its "maybe" is worth little, but its EMPTY
 * answer is definite and is the one that matters here: Chrome returns "" for
 * `video/quicktime`, which is precisely the file that then hangs. Catching it
 * before a decoder is involved turns a 20-second wait into an instant answer.
 *
 * A file with no type at all is not judged — the browser will sniff it, and
 * refusing on missing metadata would reject perfectly good drag-and-drop files.
 */
function refuseEarly(file: File): string | null {
  if (!file.type) return null;
  const probe = document.createElement("video");
  if (probe.canPlayType(file.type) !== "") return null;
  return (
    `this browser will not open ${file.type} files` +
    (/quicktime/i.test(file.type)
      ? " — Chrome does not read QuickTime .mov. Convert it to .mp4 (H.264), or open this page in Safari."
      : " — try converting it to .mp4 (H.264).")
  );
}

/** Reads duration and dimensions without decoding the whole file. */
export function probeVideo(file: File): Promise<VideoInfo> {
  return withVideo(file, (video) => ({
    durationSec: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
  }));
}

export async function sampleFrames(
  file: File,
  options: SampleOptions = {},
): Promise<{ frames: SampledFrame[]; info: VideoInfo }> {
  const { fps, maxFrames, maxEdge, onFrame, signal } = { ...DEFAULTS, ...options };

  return withVideo(file, async (video) => {
    const info: VideoInfo = {
      durationSec: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };

    // Ask for `fps`, but never exceed maxFrames — a 10-minute clip becomes a
    // coarser sample rather than 1,800 detector passes.
    const wanted = Math.max(1, Math.floor(info.durationSec * fps));
    const count = Math.min(wanted, maxFrames);
    // Land the samples inside the clip: a frame at exactly `duration` often
    // decodes black, and one at exactly 0 is frequently a fade-in.
    const step = info.durationSec / (count + 1);

    const scale = Math.min(1, maxEdge / Math.max(info.width, info.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(info.width * scale));
    canvas.height = Math.max(1, Math.round(info.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("could not get a 2D context to sample frames into");

    const frames: SampledFrame[] = [];
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new DOMException("sampling aborted", "AbortError");

      const t = Number((step * (i + 1)).toFixed(3));
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      frames.push({
        t,
        frameId: `f${String(i).padStart(4, "0")}`,
        // JPEG, not PNG: a 640px PNG frame is ~1 MB and we may hold 240 of them.
        dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      });
      onFrame?.(i + 1, count);
    }

    return { frames, info };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mounts a detached <video> on the file, runs `fn`, and always tears down.
 *
 * The object URL is revoked in a finally, because a leaked one pins the whole
 * file in memory — and these are videos.
 */
async function withVideo<T>(file: File, fn: (video: HTMLVideoElement) => T | Promise<T>): Promise<T> {
  // Before a decoder is involved at all — see refuseEarly.
  const refusal = refuseEarly(file);
  if (refusal) throw new Error(refusal);

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  // Required for canvas drawImage to not taint, and harmless for a blob URL.
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      // The third outcome the old code did not have. Without it a demuxer that
      // refuses the file silently leaves this promise pending forever.
      const bell = setTimeout(() => {
        settle(() =>
          reject(
            new Error(
              `the browser stopped responding while opening this ${file.type || "video"} — ` +
                "it parsed no duration in 20s and reported no error, which usually means " +
                "it cannot read this container. Converting it to .mp4 (H.264) fixes it.",
            ),
          ),
        );
      }, METADATA_TIMEOUT_MS);

      const settle = (run: () => void) => {
        clearTimeout(bell);
        video.onloadedmetadata = null;
        video.onerror = null;
        run();
      };

      video.onloadedmetadata = () =>
        settle(() => {
          // A stream with no duration is one we cannot seek through.
          if (!Number.isFinite(video.duration) || video.duration <= 0) {
            reject(new Error("that file has no readable duration — is it a complete video?"));
            return;
          }
          resolve();
        });
      video.onerror = () =>
        settle(() => reject(new Error("the browser could not decode that file as a video")));
    });
    return await fn(video);
  } finally {
    video.onloadedmetadata = null;
    video.onseeked = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** One seek, resolved when the frame at `t` is actually decoded and paintable. */
function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // A decoder can stall mid-clip on a damaged GOP without ever firing
    // `error`, the same way it can stall on open. Every wait gets a clock.
    const bell = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `the decoder stalled seeking to ${t.toFixed(2)}s — no frame and no error in 15s`,
          ),
        ),
      );
    }, SEEK_TIMEOUT_MS);

    const settle = (run: () => void) => {
      clearTimeout(bell);
      video.onseeked = null;
      video.onerror = null;
      run();
    };

    video.onseeked = () => settle(resolve);
    video.onerror = () => settle(() => reject(new Error(`could not seek to ${t.toFixed(2)}s`)));

    // Seeking to a time already current fires no `seeked` event at all, so a
    // duplicate request has to resolve itself or the walk hangs forever.
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) {
      settle(resolve);
      return;
    }
    video.currentTime = t;
  });
}
