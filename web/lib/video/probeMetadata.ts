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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE SAME TAGS AGAIN, AS A JOURNEY'S FACTS
 *
 * ../journey/clips.ts wants more of the header than the three tags above: the
 * UTC offset as a number, the altitude off the fix, the clip's length. It also
 * has a second reader — ../journey/clientMetadata.ts parses the container in the
 * BROWSER, because the drop path deliberately never uploads the video.
 *
 * Both fill the SAME `ClipFacts`, and that is the whole point: a clip that came
 * off the phone through the handoff and a clip dragged onto the laptop have to
 * produce the same route, or the two paths disagree about the same footage.
 * Here, on a file that is already on this disk, ffmpeg is strictly the better
 * instrument — it has read the whole header rather than the first few kilobytes
 * of it — so `clipFactsFromFile` below is the preferred answer whenever it is
 * available, and the browser parser is the one that runs when it is not.
 *
 * The rule above does not soften for any of it. A tag that is not there is null
 * in `ClipFacts` too, and `recordedAt` NEVER falls back to the filesystem mtime
 * — that is a separate field for the reason its own comment gives.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import { emptyFacts, type ClipFacts } from "../journey/clips";
import { parseISO6709 } from "./iso6709";

export { parseISO6709 } from "./iso6709";

export interface VideoMetadata {
  /** ISO 8601 WITH the original UTC offset, so the walk reads in local time. */
  recordedAt: string | null;
  /**
   * Minutes east of UTC, when the file stated an offset. Null when it did not.
   *
   * Carried as a number beside `recordedAt` so a display layer can render local
   * time without re-parsing the string — see `ClipFacts.utcOffsetMin`.
   */
  utcOffsetMin: number | null;
  /** Where the camera was, when the file says so. */
  location: { lat: number; lng: number } | null;
  /** Metres, off the same fix as `location`. Null far more often than not. */
  altitudeM: number | null;
  /** "Apple iPhone 11" — provenance, shown rather than inferred. */
  device: string | null;
  /** Seconds, from the container's `Duration:` line. */
  durationSec: number | null;
}

const NOTHING: VideoMetadata = {
  recordedAt: null,
  utcOffsetMin: null,
  location: null,
  altitudeM: null,
  device: null,
  durationSec: null,
};

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
  return metadataFrom(text);
}

/**
 * Everything this module knows how to read, out of one header block.
 *
 * Split out from `probeVideoMetadata` so `clipFactsFromFile` can share the
 * single spawn rather than probing the same file a second time for the same
 * bytes — the reason `readVideoHeader` is one call and not two in the first
 * place.
 */
function metadataFrom(text: string): VideoMetadata {
  // Apple's `creationdate` is the only stamp that carries an offset, so the
  // offset is read from THAT string and not from whatever won the `??` — a
  // `creation_time` fallback is UTC by definition and stating "+00:00" for it
  // would be reporting a timezone nobody was in.
  const creationdate = tag(text, "com.apple.quicktime.creationdate");
  const fix = fixFrom(text);

  return {
    recordedAt: creationdate ?? isoFromCreationTime(text),
    utcOffsetMin: creationdate ? utcOffsetMinFrom(creationdate) : null,
    location: fix.location,
    altitudeM: fix.altitudeM,
    device: deviceFrom(text),
    durationSec: durationFrom(text),
  };
}

/**
 * The contract's `ClipFacts` for a file that is already on this disk.
 *
 * The counterpart to ../journey/clientMetadata.ts, and the better of the two
 * when it can run — see the header. Never throws: no ffmpeg on this machine, an
 * unreadable container, a probe that timed out and a file with its metadata
 * block stripped all land on the same honest answer, which is `emptyFacts` with
 * whatever the filesystem could still say.
 *
 * `bytes` and `name` are the caller's, because the caller already knows them —
 * a route that found the upload has both in hand and re-stating them here would
 * be a second `stat` for numbers nobody doubted.
 */
export async function clipFactsFromFile(
  filePath: string,
  input: { id: string; name: string; bytes: number; fileModifiedAt?: string | null },
): Promise<ClipFacts> {
  const facts = emptyFacts(input.id, input.name, input.bytes);
  // mtime is the one field that survives a stripped container, so it is filled
  // before anything can fail. It is NEVER copied into `recordedAt`.
  facts.fileModifiedAt = input.fileModifiedAt ?? (await mtimeOf(filePath));

  const text = await readVideoHeader(filePath);
  if (!text) return facts;

  const meta = metadataFrom(text);
  facts.recordedAt = meta.recordedAt;
  facts.utcOffsetMin = meta.utcOffsetMin;
  facts.location = meta.location;
  facts.altitudeM = meta.altitudeM;
  facts.device = meta.device;
  facts.durationSec = meta.durationSec;
  return facts;
}

/** The filesystem's last-modified time, ISO 8601, or null if it is gone. */
async function mtimeOf(filePath: string): Promise<string | null> {
  try {
    const ms = (await stat(filePath)).mtimeMs;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    // Deleted between the lookup and here. "Unknown", like everything else.
    return null;
  }
}

function tag(text: string, key: string): string | null {
  // Keys sit in an indented `key : value` table; the value runs to end of line.
  const m = new RegExp(`${key.replace(/\./g, "\\.")}\\s*:\\s*(.+)`).exec(text);
  return m ? m[1].trim() || null : null;
}

/**
 * The whole fix — position and, when the string carried one, height.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ALTITUDE IS PARSED HERE AND THE COORDINATE IS NOT
 *
 * Both numbers come out of the same ISO 6709 string, so on the face of it they
 * belong in the same parser. ./iso6709.ts returns lat/lng only, and the split is
 * left where it is on purpose: that module is deliberately free of `server-only`
 * and of every Node import so scripts/verify-pipeline.ts can assert it under
 * tsx, and it is imported by callers that want a coordinate and have no use for
 * a third number. Widening its return type would change the shape every one of
 * them destructures, to serve one field that is null on almost every real clip.
 *
 * So: the coordinate keeps its tested parser and altitude is read off the same
 * raw string here. It is only ever read when `parseISO6709` succeeded, because
 * that success is the evidence the string was the format we thought it was — a
 * third signed number scraped out of something that failed the lat/lng range
 * check is not an altitude, it is a coincidence.
 */
function fixFrom(text: string): {
  location: { lat: number; lng: number } | null;
  altitudeM: number | null;
} {
  // Apple writes both `location` and `location.ISO6709`, identically formatted.
  const raw =
    tag(text, "com.apple.quicktime.location.ISO6709") ??
    tag(text, "com.apple.quicktime.location") ??
    tag(text, "location");
  if (!raw) return { location: null, altitudeM: null };

  const location = parseISO6709(raw);
  return { location, altitudeM: location ? altitudeFrom(raw) : null };
}

/**
 * The third signed number in `+43.6406-079.4019+076.320/`, in metres.
 *
 * Optional in the format and absent from most fixes. Bounded because a value
 * outside the range a camera can physically occupy means the string was not
 * what we took it for, and a wrong altitude is the same class of mistake as a
 * wrong coordinate — see the header.
 */
function altitudeFrom(raw: string): number | null {
  const m =
    /([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,6}(?:\.\d+)?)/.exec(raw.trim());
  if (!m) return null;
  const alt = Number(m[3]);
  if (!Number.isFinite(alt) || Math.abs(alt) > 100_000) return null;
  return alt;
}

/**
 * `-0400` or `-04:00` off the end of a creationdate, as minutes east of UTC.
 *
 * Null when the stamp ended in anything else, INCLUDING a bare `Z`. That is not
 * an oversight: this field exists so a walk can be shown in the time it was
 * filmed, and "UTC" is a statement about the clock rather than about where the
 * person was standing — the same reason `creation_time` gets no offset. Zero
 * here always means a file that really did say `+0000`.
 */
function utcOffsetMinFrom(stamp: string): number | null {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(stamp.trim());
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  // Real offsets run −12:00 to +14:00; anything past that is a number that
  // happened to sit at the end of the line.
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return m[1] === "-" ? -total : total;
}

/**
 * `  Duration: 00:03:04.12, start: 0.000000, bitrate: 15662 kb/s`
 *
 * ./preflight.ts parses this same line with its own private copy, which is the
 * duplication this codebase complains about elsewhere — and it is deliberate
 * only because there is no way to remove it from this side. That function is
 * not exported, and preflight already imports `readVideoHeader` from here, so
 * importing it back would close an import cycle between the two modules. When
 * one of them is next opened for its own reasons, the fix is to export
 * preflight's and delete this. Until then the two must be kept identical:
 * `Duration: N/A` is null in both, and so is a zero.
 */
function durationFrom(text: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
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
