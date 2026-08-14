import "server-only";

/**
 * What a video file already knows about itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BOTHER
 *
 * lib/uploadedTrips.ts is blunt about what an uploaded walk cannot know: "There
 * is no odometry and no GPS." That was true of the PIXELS and was quietly
 * assumed of the file, which is a different claim — a phone stamps the recording
 * with when it happened, where it happened, and what shot it. Reading three tags
 * is cheaper than every workaround built to live without them.
 *
 * Two things were being invented in their absence, and both are now avoidable:
 *
 *   · `startedAt` was `new Date()`, so a clip filmed on Saturday became a walk
 *     that happened the moment you uploaded it, and the album sorted it wrong.
 *   · `origin` fell back to a HARDCODED `{43.6415, -79.4046}` — a specific
 *     street corner in Toronto — so every upload from anywhere on earth pinned
 *     to the same spot on the globe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ABSENT IS A NORMAL ANSWER, AND IT IS NOT AN ERROR
 *
 * Every field here is nullable and often null. Location in particular is only
 * present when the camera had location services on, and is stripped by several
 * ordinary sharing paths — the clip that motivated this module has make, model,
 * software and creationdate but no location at all.
 *
 * So this NEVER guesses. A missing tag comes back null and the caller keeps
 * whatever honest fallback it already had; a wrong coordinate is far worse than
 * no coordinate, because the globe renders it with exactly the same confidence.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import { parseISO6709 } from "./iso6709";

export { parseISO6709 } from "./iso6709";

export interface VideoMetadata {
  /** ISO 8601 WITH the original UTC offset, so the walk reads in local time. */
  recordedAt: string | null;
  /** Where the camera was, when the file says so. */
  location: { lat: number; lng: number } | null;
  /** "Apple iPhone 11" — provenance, shown rather than inferred. */
  device: string | null;
}

const NOTHING: VideoMetadata = { recordedAt: null, location: null, device: null };

/** Metadata only — ffmpeg exits as soon as it has read the header. */
const PROBE_TIMEOUT_MS = 20_000;

let cachedBin: string | null | undefined;

/**
 * Same verified-path resolution as lib/video/remux.ts — see the note there.
 *
 * Exported so ./preflight.ts can tell "there is no ffmpeg on this machine"
 * apart from "ffmpeg ran and said nothing useful". Those are the same outcome
 * for this module and different sentences for that one.
 */
export function ffmpegBinary(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  const candidates = [
    ffmpegPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  cachedBin = candidates.find((c) => existsSync(c)) ?? null;
  return cachedBin;
}

/**
 * Read the container's metadata block. Never throws.
 *
 * ffmpeg with no output file prints the header to stderr and exits non-zero
 * ("At least one output file must be specified") — that exit code is expected
 * and is NOT a failure, so the output is parsed regardless of it.
 */
export async function probeVideoMetadata(filePath: string): Promise<VideoMetadata> {
  const text = await readVideoHeader(filePath);
  if (!text) return NOTHING;

  return {
    recordedAt: tag(text, "com.apple.quicktime.creationdate") ?? isoFromCreationTime(text),
    location: locationFrom(text),
    device: deviceFrom(text),
  };
}

function tag(text: string, key: string): string | null {
  // Keys sit in an indented `key : value` table; the value runs to end of line.
  const m = new RegExp(`${key.replace(/\./g, "\\.")}\\s*:\\s*(.+)`).exec(text);
  return m ? m[1].trim() || null : null;
}

function locationFrom(text: string): { lat: number; lng: number } | null {
  // Apple writes both `location` and `location.ISO6709`, identically formatted.
  const raw =
    tag(text, "com.apple.quicktime.location.ISO6709") ??
    tag(text, "com.apple.quicktime.location") ??
    tag(text, "location");
  return raw ? parseISO6709(raw) : null;
}

function deviceFrom(text: string): string | null {
  const make = tag(text, "com.apple.quicktime.make");
  const model = tag(text, "com.apple.quicktime.model");
  if (make && model) return model.startsWith(make) ? model : `${make} ${model}`;
  return model ?? make;
}

/**
 * The container-level `creation_time`, as a last resort.
 *
 * Always UTC and therefore missing the offset that makes a walk read in the
 * time it was actually filmed — which is why `creationdate` is preferred above.
 * Better than `new Date()` all the same: the day is right.
 */
function isoFromCreationTime(text: string): string | null {
  const raw = tag(text, "creation_time");
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Everything ffmpeg prints about a file it was given nowhere to write.
 *
 * The raw stderr block: the metadata table this module parses, and also the
 * `Duration:` line and the `Stream ... Video:` line that ./preflight.ts reads.
 * Exported as ONE call rather than two probes, because spawning ffmpeg twice to
 * read two halves of the same header would double the cost of the one thing
 * that has to happen while a phone waits on a spinner.
 *
 * Null when there is no binary, when it could not be started, or when it timed
 * out. Every caller treats that as "unknown", never as "bad file".
 */
export async function readVideoHeader(filePath: string): Promise<string | null> {
  const bin = ffmpegBinary();
  if (!bin) return null;
  return run(bin, filePath);
}

function run(bin: string, filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-hide_banner", "-i", filePath], { windowsHide: true });

    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      // The header is small and near the start; a cap stops a pathological file
      // from being read into memory in its entirety.
      if (stderr.length < 64_000) stderr += c.toString();
    });

    const bell = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, PROBE_TIMEOUT_MS);

    child.on("error", () => {
      clearTimeout(bell);
      resolve(null);
    });
    // Resolve on close whatever the code — see the note above about ffmpeg
    // exiting non-zero when it has nowhere to write.
    child.on("close", () => {
      clearTimeout(bell);
      resolve(stderr || null);
    });
  });
}
