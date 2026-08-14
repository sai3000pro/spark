import "server-only";

/**
 * The bridge: a splat job, as seen by everyone else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * `publishProgress` and `notify` in ./admin.ts have been correct and unreachable
 * — nothing in the app called either of them. The reason is structural rather
 * than an oversight: this app has no worker. Status is DERIVED, not ticked
 * (lib/splatJobs.ts), and the only moment the server ever learns something new
 * about a reconstruction is inside `GET /api/splat/jobs/<id>`, where
 * `collectFromKiri` asks KIRI and possibly writes a .ply. There is no other
 * event to hang a publish on, because there are no events.
 *
 * So the publish hangs off the read. This module is what that read calls.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY FAN OUT AT ALL IF SOMEBODY IS ALREADY POLLING
 *
 * A fair question — the poller learns the answer from its own response and
 * needs no help. The frame is for everyone else:
 *
 *   · The laptop watches; the phone that recorded the clip is in a pocket. One
 *     poll feeds both, and the phone spends no battery and no requests.
 *   · Four tabs on the same job used to be four independent 5-second polls, each
 *     of which can trigger a whole splat download. Now one polls and three
 *     listen. The KIRI collection path is not idempotent-by-accident, it is
 *     idempotent-by-file-existence, but four concurrent downloads of the same
 *     ~7 MB artifact is still four downloads.
 *   · A frame is a few hundred bytes on RTDB's 10 GB/month, against Supabase's
 *     shared 5 GB — which is the entire argument in supabase/migrations/008 and
 *     the reason Firebase is in this stack.
 *
 * What it is NOT is a source of truth. ./progress.ts is emphatic about this and
 * this module upholds it by publishing only what it just read from disk, never
 * by predicting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE COSTS ANYTHING WHEN FIREBASE IS ABSENT
 *
 * Both `publishProgress` and `notify` short-circuit on a missing service account
 * before doing any work, so with no Firebase configured this adds one function
 * call and two null checks to a status read. No await on a network, no latency,
 * nothing in the log. That matters because this sits directly in the path of the
 * poll that a person is watching a spinner over.
 */
import { notify, publishProgress, reconstructionDone } from "./admin";
import { isChannelId } from "./progress";
import { tokensToNotify, revokePushTokens } from "../push/registry";
import { isTerminalStatus, type ReconStatus } from "../recon/status";
import type { SplatJob } from "../splatJobs";

/**
 * The coarse job status, widened to the pipeline's vocabulary.
 *
 * lib/splatJobs.ts speaks in four states derived from the filesystem;
 * lib/recon/status.ts is the nine-state enum that `ProgressFrame` and the
 * Postgres `recon_status` share. `processing` becomes `reconstructing` because
 * that is what it means for a job that has been handed to KIRI, and it is the
 * only one of the six in-flight states this store can distinguish. When jobs
 * move to Postgres the real status travels and this map goes away.
 */
const AS_RECON_STATUS: Record<SplatJob["status"], ReconStatus> = {
  queued: "queued",
  processing: "reconstructing",
  ready: "ready",
  failed: "failed",
};

/**
 * The status each job was last seen in, so a push can be sent on the TRANSITION
 * rather than on the state.
 *
 * This distinction is the whole reason the map exists, and getting it wrong is
 * loud. Status here is re-derived from the filesystem on every single poll
 * (lib/splatJobs.ts) — a finished job reports `ready` forever. So a rule of
 * "push when ready" would fire again on every poll, and a rule of "push when
 * ready, once per process" would still fire for a capture that finished
 * yesterday the first time anyone opened the page after a restart. Being told
 * at 9am that a reconstruction you watched finish last night is ready is the
 * exact thing that gets notifications switched off.
 *
 * A transition cannot be faked: it requires this process to have seen the job
 * unfinished and then finished. A job that is already `ready` the first time we
 * lay eyes on it is recorded silently, because it is not news.
 *
 * In memory and per-process. Not persisted deliberately — the durable
 * alternative is a "notified" flag that has to be written before the send, and
 * a crash between the two loses the notification permanently. Missing one in
 * the narrow window where a job finishes DURING a restart is the cheaper
 * failure, and it is the only case this drops.
 */
const LAST_SEEN = new Map<string, ReconStatus>();

export interface FanOutOptions {
  /**
   * The reader's RTDB channel, from `getChannelId()` in ./client.ts.
   *
   * Absent for any caller that is not a browser with Firebase configured — a
   * curl, the phone before sign-in resolves, the demo — and absence simply means
   * no frame is published. It is validated rather than trusted: see
   * `isChannelId`.
   */
  channel?: string | null;
  /** The user this job belongs to, when there is one. Null under no auth. */
  userId?: string | null;
  /** KIRI's own sentence for this poll, when it had one. */
  detail?: string | null;
}

/**
 * Publish one frame for this job, and push once if it has just finished.
 *
 * Never throws and never rejects. Called from inside a status read, which must
 * not turn into a 500 because a fan-out channel was unreachable.
 */
export async function fanOutJobStatus(job: SplatJob, options: FanOutOptions = {}): Promise<void> {
  try {
    const status = AS_RECON_STATUS[job.status];

    if (isChannelId(options.channel)) {
      await publishProgress(options.channel, {
        jobId: job.id,
        status,
        /*
          Null, always, and honestly. KIRI reports a state and not a percentage
          (lib/reconstruction/kiri.ts), so any number here would be invented —
          and an invented progress bar that sits at 60% for four minutes is a
          worse experience than an indeterminate one, because it makes a promise
          about time that nothing is keeping.
        */
        progress: null,
        detail: options.detail ?? job.note,
      });
    }

    const previous = LAST_SEEN.get(job.id);
    LAST_SEEN.set(job.id, status);

    // Not finished, never seen before, or finished as far back as we can
    // remember. None of those are an event; see the note on LAST_SEEN.
    if (!isTerminalStatus(status)) return;
    if (previous === undefined || isTerminalStatus(previous)) return;

    const tokens = await tokensToNotify(options.userId ?? null);
    if (tokens.length === 0) {
      /*
        Nobody asked to be told. Put the old status back so this still counts as
        a pending transition: the reader may grant permission while this very
        job is finishing, and having spent the one-shot against an empty token
        list would mean the first reconstruction after opting in is the one that
        never notifies them.
      */
      LAST_SEEN.set(job.id, previous);
      return;
    }

    const copy = reconstructionDone(status, job.sourceName);
    const { deadTokens } = await notify({
      ...copy,
      // A walk to open if there is one, otherwise the screen that lists clips
      // still to finish — which is where a splat with no walk yet is actionable.
      url: job.tripId ? `/walk?trip=${job.tripId}` : "/live",
      tokens,
      jobId: job.id,
    });

    // FCM only reveals a dead token by refusing it, so this is the one moment
    // pruning is possible. See the note on `notify`.
    if (deadTokens.length > 0) await revokePushTokens(deadTokens);
  } catch (err) {
    console.warn("[firebase] fan-out failed (non-fatal):", err);
  }
}
