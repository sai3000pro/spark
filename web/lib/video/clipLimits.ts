/**
 * Would KIRI take this clip? Answered from numbers, before a credit is spent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * KIRI's limits are enforced on THEIR side, after the whole video has been
 * uploaded, and a rejection there is not free: `/3dgs/video` takes the credit
 * on submission and the terminal codes in ../reconstruction/kiri.ts (2004,
 * 2005, 2007, 2009, 2010) are exactly the family of "this video is unusable"
 * answers. So the sequence someone actually lives through is: walk around a
 * building for three minutes, wait out a 300 MB upload on domestic Wi-Fi, and
 * then be told the clip was four seconds too long — one credit lighter, out of
 * ten that can never be topped up for less than $500.
 *
 * Every one of those refusals is predictable from three numbers we can read off
 * the file in about a second. That is the entire argument for this module.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE MISTAKE THIS FILE IS BUILT TO NOT MAKE: WIDTH IS NOT THE LONG SIDE
 *
 * KIRI documents "the video resolution must not exceed 1920x1080". Written as
 * code that is almost irresistibly `width <= 1920 && height <= 1080`, and that
 * check REFUSES EVERY CLIP THIS APP PRODUCES. A phone held upright shoots
 * portrait: 1080x1920 is the same number of pixels arranged the other way up,
 * and a naive test reads its height as 1920 and calls it oversized.
 *
 * It is worse than it looks, because the file does not even agree with itself.
 * Measured on a real capture from app/m/[handoffId]/GuidedRecorder.tsx:
 *
 *     Stream #0:2 Video: h264 ..., 1920x1080, 30.01 fps
 *       Side data:
 *         displaymatrix: rotation of -90.00 degrees
 *
 * The frame is CODED 1920x1080 and DISPLAYED 1080x1920. Ask "what is the
 * width" and there are two defensible answers, one of which changes with a
 * rotation flag a demuxer may or may not have applied for you.
 *
 * So nothing here ever speaks of width and height. It compares the LONG side
 * against 1920 and the SHORT side against 1080, which is a question with one
 * answer no matter how the phone was held or which side of the display matrix
 * the number came from. Orientation cannot make a clip legal or illegal, and a
 * check that thinks it can is a check that rejects portrait video.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFUSE MEANS CERTAIN, WARN MEANS EVERYTHING ELSE
 *
 * A false refusal is worse than a false send. Sending a doubtful clip costs one
 * credit; refusing a good one costs the reconstruction AND the walk that would
 * have produced it, and the person has no way to overrule us. So `refuse` is
 * reserved for the two limits KIRI states in prose and enforces numerically —
 * duration and the resolution box. Everything else that merely smells wrong,
 * including a size limit KIRI does not document, is a `warn` that still goes.
 *
 * This half is deliberately PURE and free of `server-only`: no filesystem, no
 * ffmpeg, no node built-ins. The measuring lives in ./preflight.ts, so these
 * rules can be asserted by a script (see scripts/verify-capture-flow.ts) with
 * no server, no binary and no clip on disk.
 */
import { KIRI_VIDEO_LIMITS } from "../reconstruction/kiri";

/**
 * What we managed to learn about a clip. Every field is nullable and null is a
 * normal answer — see ./preflight.ts on why a missing measurement must never
 * block a dispatch.
 */
export interface ClipFacts {
  durationSec: number | null;
  /** Longest edge in pixels, whichever axis it lives on. Never "width". */
  longSide: number | null;
  /** Shortest edge in pixels. Never "height". */
  shortSide: number | null;
  bytes: number | null;
}

/**
 * ok      nothing here breaks a documented limit
 * warn    risky, and it goes anyway
 * refuse  KIRI will certainly reject this, so do not spend the credit
 * unknown we could not measure it, so we do not get an opinion — see below
 */
export type ClipVerdict = "ok" | "warn" | "refuse" | "unknown";

export interface ClipPreflight {
  verdict: ClipVerdict;
  /** One sentence, already phrased for a person and safe to render verbatim. */
  reason: string;
  /** Every finding, worst first. `reason` is the first of these. */
  findings: string[];
  facts: ClipFacts;
}

/**
 * A clip this close to the cap is not refused, and is not comfortable either.
 *
 * Container duration is not frame duration and both are rounded somewhere, so a
 * clip that measures 2:58 here may present as 3:00.4 to a decoder that counts
 * differently. The recorder aims for 170s for this reason; a file that arrived
 * from the camera roll had nobody enforcing that.
 */
const NEAR_CAP_SEC = 10;

/**
 * Slack on the duration cap, and only on the duration cap.
 *
 * "No longer than 3 minutes" makes exactly 3:00 legal, and a container header
 * reports 180.02 for a clip that is 180.00 of pictures. Refusing that would be
 * refusing a legal clip over a rounding artefact — the one mistake that costs
 * more than sending a doubtful one. A quarter of a second is far too small to
 * let anything KIRI would actually reject through, and the near-cap warning
 * above covers the band either side of it.
 *
 * Pixels get no such grace: they are counted, not measured.
 */
const DURATION_GRACE_SEC = 0.25;

/**
 * Under this, KIRI's "too short / too few frames" family becomes likely.
 *
 * Deliberately a warning and not a refusal: codes 2004 and 2005 exist and are
 * terminal, but KIRI publishes no minimum duration or frame count, so the
 * threshold here is a guess about their behaviour rather than a limit they
 * stated. Guesses do not get to cancel someone's reconstruction.
 */
const SHORT_SEC = 10;

/**
 * Where an upload starts being the risky part of the operation.
 *
 * KIRI documents no size limit, so this can never refuse. It is about the
 * transfer instead: ../reconstruction/kiri.ts aborts a request after ten
 * minutes, and 300 MB over a typical domestic uplink is already several of
 * them. Worth saying out loud before someone watches a progress bar for the
 * length of a coffee break.
 */
const WARN_BYTES = 300 * 1024 * 1024;

/** Wider than any phone shoots — anamorphic, or a stitched pano. */
const WIDE_ASPECT = 2.2;
/** Square-ish. Not what a photogrammetry pipeline expects to be handed. */
const SQUARE_ASPECT = 1.05;

/**
 * The two numbers off a frame, sorted into the only pair that means anything.
 *
 * Every caller that has learned a frame size goes through here, and that is the
 * whole defence against the bug in this file's header. There is no path in the
 * program where a raw width reaches a raw limit: the sort happens once, in a
 * pure function, and both arguments are deliberately unnamed so there is
 * nothing to get the wrong way round.
 *
 * `sidesOf(1920, 1080)` and `sidesOf(1080, 1920)` are the same clip and return
 * the same answer, which is exactly the property portrait video needs.
 */
export function sidesOf(a: number, b: number): { longSide: number; shortSide: number } {
  return { longSide: Math.max(a, b), shortSide: Math.min(a, b) };
}

/**
 * The rules, applied to whatever was measurable.
 *
 * Pure and total: it never throws, never reads a file, and returns a verdict
 * for every possible input including one where nothing at all is known.
 */
export function judgeClipForKiri(facts: ClipFacts): ClipPreflight {
  const refusals: string[] = [];
  const warnings: string[] = [];

  const { maxDurationSec, maxLongSide, maxShortSide } = KIRI_VIDEO_LIMITS;

  // ── duration ───────────────────────────────────────────────────────────────
  if (facts.durationSec !== null) {
    const over = facts.durationSec - maxDurationSec;
    if (over > DURATION_GRACE_SEC) {
      refusals.push(
        `This clip is ${clock(facts.durationSec)} long — KIRI stops at ` +
          `${clock(maxDurationSec)}, so it is ${overBy(over)} over. Trim it and send it again.`,
      );
    } else if (facts.durationSec > maxDurationSec - NEAR_CAP_SEC) {
      warnings.push(
        `This clip is ${clock(facts.durationSec)} long and KIRI's cap is ` +
          `${clock(maxDurationSec)} — close enough that a rounding difference could get it refused.`,
      );
    } else if (facts.durationSec < SHORT_SEC) {
      warnings.push(
        `This clip is only ${clock(facts.durationSec)} long. KIRI rejects footage it ` +
          `considers too short, and short clips rarely hold enough angles to reconstruct.`,
      );
    }
  }

  // ── the resolution box, in either orientation ──────────────────────────────
  if (facts.longSide !== null && facts.shortSide !== null) {
    const longOver = facts.longSide - maxLongSide;
    const shortOver = facts.shortSide - maxShortSide;

    if (longOver > 0 || shortOver > 0) {
      // Named as long/short rather than as WxH, because a rotated clip's coded
      // width is not the width anybody sees and printing it would be a lie
      // dressed as a measurement. See the header.
      const parts: string[] = [];
      if (longOver > 0) parts.push(`its long side is ${longOver}px over`);
      if (shortOver > 0) parts.push(`its short side is ${shortOver}px over`);
      refusals.push(
        `This clip's frame is ${facts.longSide}×${facts.shortSide} — KIRI stops at ` +
          `${maxLongSide}×${maxShortSide} in either orientation, so ${parts.join(" and ")}. ` +
          `Downscale it and send it again.`,
      );
    }

    const aspect = facts.longSide / Math.max(1, facts.shortSide);
    if (aspect > WIDE_ASPECT) {
      warnings.push(
        `That is an unusually wide frame (${aspect.toFixed(2)}:1). KIRI is built around ` +
          `ordinary phone footage and may struggle with it.`,
      );
    } else if (aspect < SQUARE_ASPECT) {
      warnings.push(
        `That frame is nearly square (${aspect.toFixed(2)}:1), which is not a shape a phone ` +
          `camera produces — check it is the clip you meant to send.`,
      );
    }
  } else if (facts.durationSec !== null) {
    // Duration read, frame size not. Say which half is unchecked rather than
    // implying the clip passed a test that never ran.
    warnings.push(
      `The frame size could not be read, so nothing here checked it against KIRI's ` +
        `${maxLongSide}×${maxShortSide} limit.`,
    );
  }

  // ── size, which is about the upload rather than about KIRI ─────────────────
  if (facts.bytes !== null && facts.bytes > WARN_BYTES) {
    warnings.push(
      `This clip is ${megabytes(facts.bytes)} — the upload alone will take a while, and a ` +
        `connection that drops halfway still costs the credit.`,
    );
  }

  if (refusals.length > 0) {
    return {
      verdict: "refuse",
      reason: refusals[0],
      findings: [...refusals, ...warnings],
      facts,
    };
  }

  // Nothing measurable at all. NOT a refusal — see ./preflight.ts.
  if (facts.durationSec === null && facts.longSide === null) {
    return {
      verdict: "unknown",
      reason:
        "This clip could not be measured on this machine, so it goes to KIRI unchecked.",
      findings: warnings,
      facts,
    };
  }

  if (warnings.length > 0) {
    return { verdict: "warn", reason: warnings[0], findings: warnings, facts };
  }

  return {
    verdict: "ok",
    reason: "Within KIRI's limits.",
    findings: [],
    facts,
  };
}

/** "3:04", or "7s" for anything under a minute. */
export function clock(sec: number): string {
  const whole = Math.round(sec);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function overBy(sec: number): string {
  return sec >= 60 ? clock(sec) : `${Math.max(1, Math.round(sec))}s`;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
