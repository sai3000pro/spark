/**
 * Where this reader wants reconstructions to go, remembered between visits.
 *
 * Pure and React-free on purpose, exactly like lib/splat/renderer.ts: the
 * validation below is the interesting part, and scripts/verify-pipeline.ts can
 * assert it under tsx only if importing this file does not drag in React or
 * touch the DOM at module scope. The hook lives beside it in ./useReconTarget.
 *
 * WHY A PREFERENCE AT ALL, when /api/reconstruction/targets already probes what
 * is reachable: availability and preference answer different questions. The
 * probe says the studio is up and a KIRI key has credits; it cannot say which
 * of those the person would rather spend. Someone with both a GPU box and a
 * paid key almost always wants the free local one, and being asked every single
 * time is the app failing to learn something it was already told.
 *
 * The stored value is a REQUEST, never a guarantee. `fallbackFor` in ./targets
 * still decides where a clip actually goes, and still degrades local-before-
 * cloud so a remembered "browser" cannot quietly start spending credits.
 */
import { RECON_TARGETS, type ReconTarget } from "./targets";

/**
 * Local and free, and the same default the phone handoff upload route uses.
 * A first-time reader should never have a credit spent on their behalf by a
 * default they did not pick.
 */
export const DEFAULT_RECON_TARGET: ReconTarget = "studio-batch";

const STORAGE_KEY = "spark.recon.target";

/** Narrow an unknown to a target we actually ship. */
export function isKnownTarget(v: unknown): v is ReconTarget {
  return typeof v === "string" && (RECON_TARGETS as string[]).includes(v);
}

/**
 * The stored choice, or the default.
 *
 * Every failure mode returns the default rather than throwing: localStorage
 * throws outright in Safari's private mode and when a site is blocked from
 * storage, and a preference is not worth taking a page down for. A value left
 * by an older build that no longer names a shipped target is also treated as
 * absent — that is what `isKnownTarget` is for.
 */
export function readTargetPreference(): ReconTarget {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isKnownTarget(raw) ? raw : DEFAULT_RECON_TARGET;
  } catch {
    return DEFAULT_RECON_TARGET;
  }
}

/** Best-effort. A preference that cannot be saved is not an error worth raising. */
export function writeTargetPreference(target: ReconTarget): void {
  try {
    localStorage.setItem(STORAGE_KEY, target);
  } catch {
    // Storage blocked or full. The choice still applies for this session.
  }
}
