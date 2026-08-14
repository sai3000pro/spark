/**
 * Live reconstruction progress, over Firebase Realtime Database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT SUPABASE REALTIME
 *
 * It could be, and the app already has a Supabase client. The reason it is not
 * is capacity, not capability: both free tiers are small, they are not
 * interchangeable, and this is the one workload that can be moved off Supabase
 * cleanly. RTDB's free tier is 1 GB stored / 10 GB per month / 100 concurrent
 * connections, which is generous for a channel carrying a few hundred bytes
 * every couple of seconds — and every byte it carries is a byte Supabase's
 * shared 5 GB egress does not have to.
 *
 * The trade is that we now have two realtime systems. That is only acceptable
 * because of the rule below, which keeps them from ever disagreeing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RTDB IS A HINT. `splat_jobs` IS THE TRUTH.
 *
 * Nothing here is durable and nothing reads it to make a decision. A progress
 * frame is a courtesy so a waiting user sees motion; the authoritative status is
 * the Postgres row, guarded by RLS and by the compare-and-swap in `advance()`.
 *
 * Concretely, this means:
 *   · every consumer does one authoritative GET on mount BEFORE subscribing,
 *     because a subscription established after the terminal frame never fires;
 *   · a `ready` frame is never trusted on its own — it prompts a re-read;
 *   · losing the RTDB connection entirely degrades to polling, not to a wrong
 *     answer.
 *
 * If those rules are followed, the worst a compromised or stale RTDB can do is
 * make a spinner wrong. If they are not, it becomes a second source of truth
 * and the two will drift.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { ReconStatus } from "../recon/status";

/** One frame on the wire. Kept small — this is billed per byte transferred. */
export interface ProgressFrame {
  jobId: string;
  status: ReconStatus;
  /** 0..1, or null when the provider gives no progress signal (KIRI does not). */
  progress: number | null;
  /** Short human-readable stage note, mirroring splat_jobs.status_detail. */
  detail: string;
  /** Server epoch ms. Used to discard out-of-order frames. */
  at: number;
}

/**
 * Path layout: `/progress/{userId}/{jobId}`.
 *
 * Scoped by user because RTDB security rules are path-based — `auth.uid` must be
 * able to match a path segment for "read only your own progress" to be
 * expressible at all. A flat `/progress/{jobId}` would force every rule to do a
 * lookup, which RTDB rules cannot do.
 */
export const progressPath = (userId: string, jobId: string): string =>
  `progress/${userId}/${jobId}`;

/**
 * Is this string safe to splice into an RTDB path?
 *
 * The channel id arrives from the browser — it is whatever `auth.uid` the
 * client's anonymous sign-in produced, and the server takes the client's word
 * for it, because nothing here is authoritative (see the header). Taking a
 * caller's word is fine; splicing a caller's string into a path is not.
 *
 * RTDB keys may not contain `.`, `$`, `#`, `[`, `]`, `/` or control characters,
 * and `..` in a path segment is not a parent reference in RTDB but it IS in
 * every reader's mental model, which is its own hazard. An unvalidated segment
 * would also turn `publishProgress` into a write-anywhere primitive: pass
 * `../../` and the frame lands outside `/progress` entirely, where the rules in
 * RTDB_RULES do not apply. So the shape is asserted rather than escaped —
 * a Firebase uid is 28 URL-safe characters and a Postgres uuid is 36, so
 * nothing legitimate is excluded by being strict.
 *
 * Shared by the client (which sends it) and the server (which trusts it only
 * this far), which is why it lives in the module both already import.
 */
export function isChannelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/**
 * The security rules this layout requires. Kept in the repo rather than only in
 * the Firebase console, because a console-only rule is invisible in review and
 * silently resets when a project is recreated.
 *
 * Note writes are denied outright: frames are published by the worker through
 * the Admin SDK, which bypasses rules. A browser has no reason to write here,
 * and allowing it would let one user fake another's progress.
 */
export const RTDB_RULES = {
  rules: {
    progress: {
      $userId: {
        ".read": "auth !== null && auth.uid === $userId",
        ".write": false,
        $jobId: {
          // Frames expire on their own so the 1 GB tier is never a garbage
          // collection problem. The worker also deletes on terminal status.
          ".validate":
            "newData.hasChildren(['jobId','status','at'])",
        },
      },
    },
  },
} as const;

/** Terminal states — after one of these, stop subscribing and re-read Postgres. */
export function isTerminal(status: ReconStatus): boolean {
  return status === "ready" || status === "failed" || status === "cancelled";
}

/**
 * Discard a frame that arrived out of order.
 *
 * RTDB delivers in order per-connection, but a reconnect can replay a stale
 * cached value before the current one, which without this check would walk a
 * progress bar backwards or briefly un-finish a finished job.
 */
export function isFresher(next: ProgressFrame, prev: ProgressFrame | null): boolean {
  return prev === null || next.at > prev.at;
}
