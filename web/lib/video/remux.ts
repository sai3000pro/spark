import "server-only";

/**
 * Make a stored clip something every browser will open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * A phone hands over whatever its camera writes. An iPhone writes QuickTime:
 * `ftyp` brand `qt  `, `moov` at the END of the file, Apple `mebx` metadata
 * tracks alongside the video. That is a perfectly valid recording — the one
 * that started this was H.264, 35.9s, 2153 samples, self-contained data
 * references, clean EOF — and browser support for it is a coin toss. Safari
 * reads QuickTime natively; Chrome answers `canPlayType("video/quicktime")`
 * with the empty string, which is a flat no.
 *
 * The laptop then has to read that clip back and decode it in a tab, because
 * the detector runs in the browser and that is the whole "frames never leave
 * your machine" property. So a container the browser will not open does not
 * degrade the product, it stops it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * `-c copy` — the encoded video and audio are LIFTED, not re-encoded. Nothing
 * is recompressed, no quality is lost, and a 105 MB clip finishes in about a
 * second and a half because it is a demux and a remux, not a transcode. The
 * output is byte-for-byte the same pictures in a different envelope.
 *
 * `-movflags +faststart` — moves `moov` to the front. A browser reading a
 * non-faststart file over HTTP has to fetch the tail before it can decode the
 * head; putting the index first is what makes a range-served clip start
 * immediately rather than after a full download.
 *
 * It does NOT transcode as a fallback. If `-c copy` cannot express the source
 * in MP4, that is a minutes-long CPU job on a machine that may be a laptop on
 * battery, and doing it silently inside a GET is the wrong answer. The failure
 * is reported instead, and the original is still there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER THROWS, AND NEVER TOUCHES THE ORIGINAL
 *
 * Same discipline as lib/reconstruction/dispatch.ts: the recording is the thing
 * that cannot be lost. The remux writes a SEPARATE file and the source is only
 * ever read. If ffmpeg is missing, times out, or fails, the caller gets a
 * reason and falls back to serving the original — which some browsers open
 * perfectly well.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

/**
 * Containers every current browser opens. Anything else gets lifted into MP4.
 *
 * Deliberately a short allowlist rather than a blocklist of known-bad ones:
 * the set of containers a phone might produce is open-ended, and the cost of
 * remuxing something that would have played anyway is one lossless copy.
 */
const BROWSER_SAFE = new Set([".mp4", ".m4v", ".webm"]);

/** Suffix marking our own output, so it is never mistaken for the original. */
export const BROWSER_COPY_SUFFIX = ".browser.mp4";

/**
 * Generous, and still a ceiling. A `-c copy` remux is I/O bound: the 105 MB
 * clip that motivated this took 1.6s. Sixty seconds means something is wrong,
 * not that the file is big.
 */
const REMUX_TIMEOUT_MS = 60_000;

/**
 * The ffmpeg binary, verified to exist rather than taken on trust.
 *
 * `ffmpeg-static` derives its export from its own `__dirname`, which a bundler
 * rewrites — under Next this came back as `\ROOT\node_modules\ffmpeg-static\
 * ffmpeg.exe` and every remux failed with ENOENT while the import itself looked
 * perfectly healthy. `serverExternalPackages` in next.config.ts is the real fix;
 * this is the check that would have caught it in one request instead of an hour,
 * plus the obvious fallback for when the export is wrong anyway.
 *
 * Resolved once. The answer cannot change while the process is alive.
 */
let cachedBin: string | null | undefined;

function ffmpegBinary(): string | null {
  if (cachedBin !== undefined) return cachedBin;

  const candidates = [
    ffmpegPath,
    // Where npm actually put it, independent of anything the bundler did.
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);

  cachedBin = candidates.find((c) => existsSync(c)) ?? null;
  return cachedBin;
}

export interface RemuxOutcome {
  /** The file a browser should be handed. Always exists. */
  servePath: string;
  /** True when `servePath` is a remuxed copy rather than the original. */
  converted: boolean;
  /** Why no conversion happened. Null when it did, or when none was needed. */
  skipped: string | null;
}

export function needsRemux(filename: string): boolean {
  return !BROWSER_SAFE.has(path.extname(filename).toLowerCase());
}

/**
 * The browser-playable form of `source`, converting once and reusing it after.
 *
 * The cached copy sits beside the original as `<name>.browser.mp4`, so it is
 * swept by the same retention pass that clears `.uploads` and there is no
 * second lifetime to reason about.
 */
export async function ensureBrowserPlayable(source: string): Promise<RemuxOutcome> {
  if (!needsRemux(source)) {
    return { servePath: source, converted: false, skipped: null };
  }

  const dest = source + BROWSER_COPY_SUFFIX;

  // Reuse, but only a COMPLETE one. A remux killed halfway — server restart,
  // timeout — leaves a short file that would then be served forever as though
  // it were the whole recording. Size zero is the cheap, honest tell.
  if (existsSync(dest) && statSync(dest).size > 0) {
    return { servePath: dest, converted: true, skipped: null };
  }

  const bin = ffmpegBinary();
  if (!bin) {
    return {
      servePath: source,
      converted: false,
      skipped: "no ffmpeg binary on this machine — serving the original container",
    };
  }

  const result = await runFfmpeg(bin, source, dest);
  if (!result.ok) {
    // Never leave a partial file where the reuse check above would trust it.
    try {
      if (existsSync(dest)) unlinkSync(dest);
    } catch {
      // Best effort. The size check is the real guard.
    }
    return { servePath: source, converted: false, skipped: result.why };
  }

  return { servePath: dest, converted: true, skipped: null };
}

function runFfmpeg(
  bin: string,
  source: string,
  dest: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      [
        "-y",
        "-v", "error",
        "-i", source,
        // First video and first audio track only. The `mebx` timed-metadata
        // track an iPhone writes has no MP4 equivalent and makes the mux fail;
        // `?` on the audio map keeps a silent clip from being an error.
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c", "copy",
        "-movflags", "+faststart",
        dest,
      ],
      { windowsHide: true },
    );

    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      // Bounded: a failing ffmpeg can be extremely talkative and none of it is
      // worth holding megabytes for.
      if (stderr.length < 4000) stderr += c.toString();
    });

    const bell = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, why: `remux timed out after ${REMUX_TIMEOUT_MS / 1000}s` });
    }, REMUX_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(bell);
      resolve({ ok: false, why: `could not run ffmpeg: ${err.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(bell);
      if (code === 0 && existsSync(dest) && statSync(dest).size > 0) {
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        why: `ffmpeg exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ""}`,
      });
    });
  });
}
