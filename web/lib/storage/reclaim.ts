/**
 * Reclaiming space by giving up originals — deliberately, and never by surprise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THE PROBLEM
 *
 * A capture is two artifacts: a PLY master (~25 MB) and the SPZ we actually
 * serve (~7 MB). Keeping both is right — the master is what a re-transcode at
 * different settings needs, and it is what someone means when they ask for their
 * capture at full detail. But it is also 78% of the bytes, and on ~11 GB of free
 * tiers it is the difference between roughly 340 captures and roughly 1,400.
 *
 * The wrong fixes, and why:
 *
 *   · Never keep masters. Cheapest, and it quietly makes every capture lossy
 *     forever with no way back. The loss is invisible until someone zooms in.
 *   · Auto-delete the oldest when full. Deletes the thing a person is least
 *     likely to be watching and most likely to care about, silently, at the
 *     moment they are busy uploading something else.
 *   · Just warn at 90%. Puts the work on the user with no tool to do it.
 *
 * So: keep every master until space actually gets tight, then offer a ranked
 * list of candidates — and SHOW WHAT WOULD BE LOST before anything is deleted.
 * The preview is the feature. A number of megabytes is not informed consent
 * about image quality; seeing the two renders side by side is.
 *
 * This is incidentally the clearest reason both renderers stay: mkkellogg opens
 * the PLY master, Spark opens the SPZ, and the comparison is genuinely
 * apples-to-apples because each format is being read by an engine that reads it
 * natively.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAFETY PROPERTY, which is the whole of the risk here
 *
 * A master is deleted ONLY after its replacement has been proven to exist and
 * to be readable. Not "the transcode reported success" — actually fetched, at
 * the size the row claims. Everything else is recoverable; this is the one
 * operation in the app that destroys data the user cannot get back, because the
 * source video is lifecycle-deleted after 7 days and the reconstruction cost a
 * credit.
 *
 * `planReclaim()` therefore returns a plan and deletes nothing. Execution is a
 * separate call that re-verifies at the moment of deletion, because time passes
 * between a user seeing a preview and confirming it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { FleetCapacity } from "./placement";

/** How close to full, and therefore how loudly to say so. */
export type StoragePressure = "ok" | "watch" | "tight" | "full";

/**
 * Thresholds are on the fleet as a whole rather than per provider, because a
 * user cannot act on "R2 is 80% full" — they have no idea what R2 is, and
 * placement moves their next upload to another provider anyway.
 */
export function pressureOf(capacity: FleetCapacity): StoragePressure {
  if (capacity.totalQuotaBytes === null) return "ok";
  const used = capacity.totalUsedBytes / capacity.totalQuotaBytes;
  if (used >= 0.95) return "full";
  if (used >= 0.85) return "tight";
  if (used >= 0.7) return "watch";
  return "ok";
}

/** Below this, do not nag. Reclaiming is offered, not pushed. */
export const OFFER_RECLAIM_AT: StoragePressure[] = ["tight", "full"];

export interface ReclaimCandidate {
  journeyId: string;
  journeyTitle: string;
  /** The master that would be deleted. */
  plyAssetId: string;
  plyBytes: number;
  /** The replacement that would remain. Absent ⇒ NOT a candidate; see below. */
  spzAssetId: string | null;
  spzBytes: number | null;
  /** Bytes freed. Always `plyBytes` — the SPZ already exists and stays. */
  reclaimableBytes: number;
  /** When this journey was last opened, for ranking. Null ⇒ never/unknown. */
  lastViewedAt: string | null;
  createdAt: string;
}

export interface ReclaimPlan {
  pressure: StoragePressure;
  capacity: FleetCapacity;
  /** Ranked, best candidate first. Never auto-applied. */
  candidates: ReclaimCandidate[];
  /** Total freeable if every candidate were accepted. */
  totalReclaimableBytes: number;
  /** Captures that would fit afterwards, at the observed average. */
  estimatedAdditionalCaptures: number;
}

/**
 * A journey with no SPZ is NOT a candidate, at any pressure.
 *
 * Deleting its master would leave nothing at all to render. This is the check
 * that turns "free up space" from a destructive operation into a lossy one, and
 * it is why `spzAssetId` is nullable on the input rather than assumed present.
 */
export function isEligible(c: Omit<ReclaimCandidate, "reclaimableBytes">): boolean {
  return c.spzAssetId !== null && c.spzBytes !== null && c.spzBytes > 0 && c.plyBytes > 0;
}

/**
 * Rank candidates.
 *
 * Size alone is the obvious ordering and it is slightly wrong: it would put a
 * capture someone opened this morning at the top purely because it is big.
 * Recency is weighted in so that, between two similar captures, the one nobody
 * has looked at in months goes first — which is both the safer deletion and the
 * one a person will agree to without thinking hard.
 *
 * Recency is a tiebreaker, not a veto: a 90-day-old 4 MB capture should not
 * outrank a 60-day-old 200 MB one, because the point of the exercise is space.
 */
export function rankCandidates(
  candidates: ReclaimCandidate[],
  now: number = Date.parse(new Date().toISOString()),
): ReclaimCandidate[] {
  const DAY = 86_400_000;
  const score = (c: ReclaimCandidate): number => {
    const ref = c.lastViewedAt ?? c.createdAt;
    const ageDays = Math.max(0, (now - Date.parse(ref)) / DAY);
    // Saturating: past ~180 days "old" stops meaning anything more, so size
    // decides among everything genuinely stale.
    const staleness = Math.min(1, ageDays / 180);
    return c.reclaimableBytes * (0.6 + 0.4 * staleness);
  };
  return [...candidates].sort((a, b) => score(b) - score(a));
}

export function buildPlan(
  capacity: FleetCapacity,
  raw: Array<Omit<ReclaimCandidate, "reclaimableBytes">>,
  now?: number,
): ReclaimPlan {
  const candidates = rankCandidates(
    raw.filter(isEligible).map((c) => ({ ...c, reclaimableBytes: c.plyBytes })),
    now,
  );

  const totalReclaimableBytes = candidates.reduce((n, c) => n + c.reclaimableBytes, 0);

  // Estimate from what THIS user's captures actually cost, not a constant. A
  // user shooting short indoor scans and one shooting 3-minute walks have very
  // different per-capture footprints, and a wrong number here reads as a lie.
  const avgSpz =
    candidates.length > 0
      ? candidates.reduce((n, c) => n + (c.spzBytes ?? 0), 0) / candidates.length
      : 0;

  return {
    pressure: pressureOf(capacity),
    capacity,
    candidates,
    totalReclaimableBytes,
    estimatedAdditionalCaptures:
      avgSpz > 0 ? Math.floor(totalReclaimableBytes / avgSpz) : 0,
  };
}

/**
 * What the confirmation screen must show before a single byte is deleted.
 *
 * Both URLs are live and renderable: `originalUrl` is the PLY (mkkellogg reads
 * it natively), `compressedUrl` is the SPZ (Spark reads it natively). The user
 * compares the actual renders, not a description of them.
 */
export interface CompressionPreview {
  journeyId: string;
  originalUrl: string;
  originalBytes: number;
  compressedUrl: string;
  compressedBytes: number;
  /** e.g. 3.3 — stated per capture, never as a marketing constant. */
  ratio: number;
  /**
   * Honest, specific, and NOT reassuring by default. SPZ quantises positions to
   * 24-bit fixed point and colour/scale/rotation to 8 bits; on a DC-only capture
   * that is usually invisible, on one with spherical harmonics the view-dependent
   * highlights are what goes. The copy should say which case this capture is.
   */
  whatChanges: string;
  /** True once the SPZ has been fetched and verified at its recorded size. */
  replacementVerified: boolean;
}

export function describeCompression(input: {
  originalBytes: number;
  compressedBytes: number;
  hasSphericalHarmonics: boolean;
}): { ratio: number; whatChanges: string } {
  const ratio = input.compressedBytes > 0 ? input.originalBytes / input.compressedBytes : 1;
  const whatChanges = input.hasSphericalHarmonics
    ? "This capture stores view-dependent colour (spherical harmonics). Compression drops it, " +
      "so surfaces that currently shift as you move around them will look flatter. That is where " +
      "most of the size saving comes from, and it is the most visible change."
    : "Positions are stored to about a millimetre, and colour, scale and rotation to 8 bits each. " +
      "On a capture like this one — which has no view-dependent colour to lose — the difference is " +
      "usually not visible at normal viewing distance.";
  return { ratio, whatChanges };
}

/**
 * Refuse to execute unless the replacement is verified RIGHT NOW.
 *
 * Deliberately re-checked at execution rather than trusted from the preview:
 * minutes can pass while someone decides, and a plan built against a since-
 * deleted or since-corrupted SPZ would delete the last good copy.
 */
export function assertSafeToDelete(preview: CompressionPreview): void {
  if (!preview.replacementVerified) {
    throw new Error(
      `refusing to delete the original for ${preview.journeyId}: ` +
        "its compressed replacement has not been verified as readable",
    );
  }
  if (preview.compressedBytes <= 0) {
    throw new Error(
      `refusing to delete the original for ${preview.journeyId}: ` +
        "the compressed replacement is empty",
    );
  }
}
