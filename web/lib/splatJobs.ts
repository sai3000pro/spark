/**
 * Reconstruction jobs: a video went in, a .ply is expected out.
 *
 * The reconstruction itself is NOT here and cannot be. It is COLMAP →
 * Brush, run by tools/video_intel/splat_batch.py against a GPU box with
 * ComfyUI installed — minutes of work, none of it expressible in a request
 * handler. What this module owns is the seam: where the video is put, what the
 * job is called, and how the app learns that the result has landed.
 *
 * STATUS IS DERIVED FROM THE FILESYSTEM, never ticked. A job is `ready` exactly
 * when its .ply exists on disk under public/mock/splats — so the loop closes for
 * real the moment the pipeline drops a file there, with nothing to poll, no
 * timer to leak, and correct answers on a cold read hours later. Same
 * derive-don't-sync discipline as getActiveTrip().
 *
 * The handoff, end to end:
 *
 *   1. POST /api/splat/jobs with the video  → written to .uploads/<jobId>.mp4
 *   2. you run, on the machine with the GPU:
 *        python -m tools.video_intel.splat_batch --specs <spec.json>
 *   3. drop the decoded result at:
 *        web/public/mock/splats/<jobId>.ply
 *   4. GET /api/splat/jobs/<jobId> flips to ready and hands back the url
 *
 * Step 3 is a copy, not an integration, and that is deliberate — the alternative
 * is this app holding credentials for a box it does not own.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

export type SplatJobStatus = "queued" | "processing" | "ready" | "failed";

export interface SplatJob {
  id: string;
  createdAt: string;
  sourceName: string;
  /** Bytes of the uploaded video, so the UI can be honest about the wait. */
  sourceBytes: number;
  /** The walk this reconstruction belongs to, once one has been built. */
  tripId: string | null;
  status: SplatJobStatus;
  /** Set only when status is "ready". Served straight to the splat viewer. */
  url: string | null;
  note: string;
}

/** Uploaded videos. Gitignored — these are large and they are not ours to keep. */
export const UPLOAD_DIR = path.join(process.cwd(), ".uploads");

/** Where a finished reconstruction has to be dropped to close the loop. */
export const SPLAT_DIR = path.join(process.cwd(), "public", "mock", "splats");

const KEY = Symbol.for("spark.splatJobs.store");

interface Store {
  jobs: Map<string, Omit<SplatJob, "status" | "url">>;
}

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const fresh: Store = { jobs: new Map() };
  g[KEY] = fresh;
  return fresh;
}

export function createSplatJob(input: {
  sourceName: string;
  sourceBytes: number;
  tripId?: string | null;
}): SplatJob {
  const now = new Date();
  const id = `splat_${now.getTime().toString(36)}`;
  store().jobs.set(id, {
    id,
    createdAt: now.toISOString(),
    sourceName: input.sourceName,
    sourceBytes: input.sourceBytes,
    tripId: input.tripId ?? null,
    note: "",
  });
  sweepUploads();
  return getSplatJob(id)!;
}

/**
 * How long a source video is kept.
 *
 * Seven days, matching the lifecycle rule the storage plan sets on the uploads
 * bucket. The source is the largest artefact in the system by a wide margin — a
 * 3-minute 1080p clip is 150–400 MB against a ~7 MB delivered splat — and it is
 * read exactly twice: once by the detector, once by the reconstructor. Keeping
 * it forever means a demo laptop fills up with footage nobody will watch again.
 *
 * This is NOT the reclaim policy in lib/storage/reclaim.ts, and the difference
 * matters: that one gives up a PLY master a user might still want, so it ranks
 * candidates, previews the loss and demands the replacement be verified first.
 * A source video is working material — everything downstream has already been
 * extracted from it — so it can go on a timer.
 */
export const UPLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Drop source videos past their retention window.
 *
 * Bounded and lazy, on the same principle as lib/handoff.ts's sweep: no cron,
 * no timer to leak, and the work happens when something is already happening.
 * Deliberately does NOT consult the job record — a video whose job was lost to
 * a restart is exactly the kind of orphan that would otherwise never be
 * collected, and age alone is the honest test.
 */
export function sweepUploads(now = Date.now()): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(UPLOAD_DIR);
  } catch {
    // Nothing has been uploaded yet. Not an error.
    return 0;
  }

  for (const name of entries) {
    const file = path.join(UPLOAD_DIR, name);
    try {
      if (now - statSync(file).mtimeMs < UPLOAD_RETENTION_MS) continue;
      unlinkSync(file);
      removed++;
    } catch {
      // Being written right now, or already gone. Either way, leave it.
    }
  }
  if (removed > 0) console.log(`[splatJobs] swept ${removed} expired upload(s)`);
  return removed;
}

/** Late-binds the walk, since the walk id is only known after the pipeline runs. */
export function linkJobToTrip(jobId: string, tripId: string): boolean {
  const job = store().jobs.get(jobId);
  if (!job) return false;
  job.tripId = tripId;
  return true;
}

export function getSplatJob(id: string): SplatJob | null {
  const job = store().jobs.get(id);
  if (!job) return null;

  const file = path.join(SPLAT_DIR, `${id}.ply`);
  const ready = existsSync(file);

  return {
    ...job,
    status: ready ? "ready" : "processing",
    url: ready ? `/mock/splats/${id}.ply` : null,
    note: ready
      ? `Reconstructed. ${(statSync(file).size / 1_048_576).toFixed(1)} MB on disk.`
      : `Waiting on the reconstruction. Drop it at public/mock/splats/${id}.ply to close the loop.`,
  };
}

export function listSplatJobs(): SplatJob[] {
  return [...store().jobs.keys()]
    .map((id) => getSplatJob(id)!)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Both directories, created on demand — neither is committed. */
export function ensureDirs(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  mkdirSync(SPLAT_DIR, { recursive: true });
}
