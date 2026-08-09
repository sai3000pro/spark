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
import { existsSync, mkdirSync, statSync } from "node:fs";
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
  return getSplatJob(id)!;
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
