import "server-only";

/**
 * Bring a finished KIRI reconstruction home, as a .ply on disk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE MISSING HALF
 *
 * Dispatch could send a clip to KIRI and record the handle it came back with,
 * and that was the end of it: nothing polled the job, nothing downloaded the
 * result, and the only documented way to get a splat into the app was to copy a
 * file into public/mock/splats by hand. A credit was spent and the reader saw
 * nothing. This closes it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES A FILE AND NOTHING ELSE
 *
 * lib/splatJobs.ts derives `ready` from the existence of
 * `public/mock/splats/<jobId>.ply` — never from a flag anyone has to remember
 * to set. So landing the file IS the state change: the job flips to ready, its
 * url appears, and POST /api/splat/jobs/<jobId> can attach it to the walk, all
 * with no other code involved. Same reason a hand-copied file has always
 * worked, now reached automatically.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POLLED, NOT SCHEDULED
 *
 * Called from the GET that a client is already making to ask "is it ready
 * yet?". No cron, no worker, no timer to leak — the same lazy discipline as
 * `sweepUploads`. A job nobody is watching simply waits, and KIRI holds the
 * result until its download window closes (KIRI_STATUS.expired), which the
 * status mapping reports honestly rather than calling a failure.
 *
 * Never throws. This runs inside a status read, and a status read that 500s
 * because a CDN was slow is worse than one that says "still working".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fetchSplatPly, getStatus, KIRI_STATUS } from "./kiri";
import { withKiriKey } from "./keys";
import { getSplatJob, SPLAT_DIR } from "../splatJobs";

export interface CollectOutcome {
  /** True when a .ply landed on disk during THIS call. */
  landed: boolean;
  /** What happened, phrased for a person. Null when there was nothing to do. */
  note: string | null;
}

const NOTHING: CollectOutcome = { landed: false, note: null };

/**
 * Ask KIRI about this job and, if it is finished, write the splat.
 *
 * Cheap and safe to call on every status poll: it returns immediately when the
 * job never went to KIRI, or when the .ply is already here.
 */
export async function collectFromKiri(jobId: string): Promise<CollectOutcome> {
  const job = getSplatJob(jobId);
  if (!job) return NOTHING;

  // Already home. Never re-download a splat we are already serving.
  if (job.status === "ready") return NOTHING;

  // Never went to KIRI — this is a studio job, or one waiting on a hand copy.
  if (!job.kiriSerialize) return NOTHING;

  const serialize = job.kiriSerialize;

  const status = await withKiriKey((key) => getStatus(key, serialize));
  if (!status) {
    return { landed: false, note: "No KIRI key is set, so its progress cannot be read." };
  }
  if (!status.ok) {
    return { landed: false, note: status.message };
  }

  const code = status.data?.status;
  if (code !== KIRI_STATUS.successful) {
    // Not an error — queued, uploading and processing all land here, and so
    // does `failed`, whose wording comes from the same table.
    return { landed: false, note: null };
  }

  const ply = await withKiriKey((key) => fetchSplatPly(key, serialize));
  if (!ply) {
    return { landed: false, note: "No KIRI key is set, so the result cannot be downloaded." };
  }
  if (!ply.ok) {
    return { landed: false, note: ply.message };
  }

  try {
    mkdirSync(SPLAT_DIR, { recursive: true });
    // Written under the JOB's id, not the name inside the archive: everything
    // downstream addresses splats as `<jobId>.ply`, and KIRI's internal naming
    // is undocumented and not ours to depend on.
    writeFileSync(path.join(SPLAT_DIR, `${jobId}.ply`), ply.bytes);
  } catch (err) {
    return {
      landed: false,
      note: `KIRI finished, but the splat could not be written: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  return {
    landed: true,
    note: `Collected from KIRI — ${(ply.bytes.byteLength / 1_048_576).toFixed(1)} MB, from ${ply.name}.`,
  };
}
