import "server-only";

/**
 * Measure a clip on disk, and say whether KIRI will take it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHECK THAT HAS TO HAPPEN BEFORE THE CREDIT
 *
 * lib/reconstruction/dispatch.ts's header says the order is the point: store
 * first, dispatch second. This is the step between them. By the time
 * `submitVideo` returns, a credit is gone — KIRI takes it on submission, not on
 * success — so any limit we could have checked locally and did not is a limit
 * the user pays a dollar to be told about, after uploading 300 MB to hear it.
 *
 * Three numbers, one ffmpeg header read, about a second. See ./clipLimits.ts
 * for the rules themselves and for why they are expressed as LONG SIDE and
 * SHORT SIDE rather than width and height (short version: a portrait clip is
 * 1080x1920, every clip this app records is portrait, and `h <= 1080` refuses
 * all of them).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MISSING TOOL MUST NEVER COST SOMEBODY A RECONSTRUCTION
 *
 * ffmpeg-static ships a binary, and it is still absent more often than you would
 * think: a pruned deployment, an unpacked platform-specific optionalDependency,
 * a bundler rewriting `__dirname` (which really happened here — see the note in
 * ./remux.ts). Every one of those means "we cannot measure this clip", and NONE
 * of them means "this clip is bad".
 *
 * So there is no failure path out of this module. No binary, an unreadable
 * container, a timeout, an unparseable header — all of it lands on
 * `verdict: "unknown"`, which the dispatcher treats as permission to proceed.
 * A pre-flight check that grounds the aircraft when its own instrument is
 * broken is worse than no check at all: it converts a rare cloud rejection into
 * a total local outage, and the user has no way to overrule it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ONLY EVER READS
 *
 * The clip is never moved, rewritten or deleted here, whatever the verdict. A
 * refused clip stays exactly where it was and can be dispatched again to the
 * studio, or to KIRI after a trim — refusing a destination is not the same as
 * discarding a recording, and this module must never confuse the two.
 *
 * These limits are KIRI's ALONE. The studio targets and the browser trainer
 * have their own constraints, or none, and applying a cloud vendor's rules to a
 * local GPU would refuse work that machine would have done perfectly well.
 * Nothing in here is called for any target other than `kiri`.
 */
import { statSync } from "node:fs";

import { judgeClipForKiri, sidesOf, type ClipFacts, type ClipPreflight } from "./clipLimits";
import { ffmpegBinary, readVideoHeader } from "./probeMetadata";

export type { ClipFacts, ClipPreflight, ClipVerdict } from "./clipLimits";

/** Nothing known. A valid answer, and the one we degrade to. */
const NOTHING: ClipFacts = {
  durationSec: null,
  longSide: null,
  shortSide: null,
  bytes: null,
};

/**
 * What the file says about itself. Never throws.
 *
 * Size comes from the filesystem, which is always available, so a clip whose
 * pictures are unreadable can still raise the "this is enormous" warning.
 */
export async function measureClip(filePath: string): Promise<ClipFacts> {
  const facts: ClipFacts = { ...NOTHING };

  try {
    facts.bytes = statSync(filePath).size;
  } catch {
    // Gone, or not readable. The dispatcher hits the same wall a moment later
    // with a much better message than anything this module could produce.
  }

  const header = await readVideoHeader(filePath);
  if (!header) return facts;

  facts.durationSec = durationFrom(header);
  const frame = frameFrom(header);
  if (frame) {
    // Through `sidesOf`, never by hand. The two numbers ffmpeg printed are in
    // coded order, which a display matrix can invert — see ./clipLimits.ts.
    const { longSide, shortSide } = sidesOf(frame.a, frame.b);
    facts.longSide = longSide;
    facts.shortSide = shortSide;
  }

  return facts;
}

/**
 * Measure, then judge. This is the whole public surface.
 *
 * The ORIGINAL file is measured, not the faststart copy dispatch.ts sends. That
 * is deliberate and it is safe: the remux is `-c copy`, a demux and a remux of
 * the identical encoded frames, so duration and frame size come out the other
 * side unchanged. Measuring first means a clip that is certain to be rejected
 * never pays for the remux either.
 */
export async function preflightForKiri(filePath: string): Promise<ClipPreflight> {
  const verdict = judgeClipForKiri(await measureClip(filePath));

  if (verdict.verdict === "unknown" && !ffmpegBinary()) {
    // Same verdict, better sentence: "we have no ffmpeg here" is a fact about
    // this machine that someone can act on, where "could not be measured"
    // sounds like an accusation against the clip.
    return {
      ...verdict,
      reason:
        "There is no ffmpeg on this machine, so nothing checked this clip against " +
        "KIRI's limits before sending it.",
    };
  }

  return verdict;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing ffmpeg's header block. Both readers below are written to find their
// line rather than to count lines, because the layout is not fixed: an iPhone
// clip carries two audio tracks and two `mebx` data tracks, so its video is
// `Stream #0:2` — anything keyed on stream 0 reads an audio track's properties
// and comes back with nothing.

/** `  Duration: 00:03:04.12, start: 0.000000, bitrate: 15662 kb/s` */
function durationFrom(header: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(header);
  if (!m) return null; // Includes `Duration: N/A`, which is a stream with no length.
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * The coded frame size, as the two numbers either side of the `x`.
 *
 * Returned unlabelled as `a`/`b` on purpose. This is the point in the program
 * where the temptation to write `width` and `height` is strongest and where it
 * would do the most damage: the same picture is `1920x1080` with a -90° display
 * matrix on one phone and `1080x1920` with none on another, and the caller
 * sorts them into long and short precisely so that no rotation flag can change
 * the answer.
 *
 * `attached pic` streams — cover art muxed in as a one-frame video — are
 * skipped, because a 3000x3000 thumbnail is not the recording and would refuse
 * a perfectly legal clip on the strength of its album art.
 */
function frameFrom(header: string): { a: number; b: number } | null {
  for (const line of header.split(/\r?\n/)) {
    if (!/:\s*Video:/.test(line)) continue;
    if (/attached pic/i.test(line)) continue;
    // Bounded to 2–5 digits and required to sit between separators, so a codec
    // profile or a pixel format cannot masquerade as a resolution.
    const m = /[,\s](\d{2,5})x(\d{2,5})(?:[\s,]|$)/.exec(line);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 0 && b > 0) return { a, b };
  }
  return null;
}
