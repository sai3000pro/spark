/**
 * POST /api/splat/jobs/[jobId]/dispatch — reconstruct a clip that is already here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND CHANCE IS A ROUTE AND NOT A RE-UPLOAD
 *
 * The clip is already on disk. The phone handoff and /api/splat/jobs both write
 * it before anything else is allowed to fail — see the header of
 * lib/reconstruction/dispatch.ts — so by the time anyone wants to try again,
 * the bytes are sitting in `.uploads/<jobId>.<ext>` and asking for them a
 * second time would be asking someone to re-walk a building because a cloud
 * API returned a 500.
 *
 * So this takes a target and nothing else. It is the "try anyway" path: the
 * scorer decided the footage held no moment worth keeping, or the first
 * dispatch went nowhere because the studio was down, and the person looking at
 * that answer disagrees and wants the reconstruction regardless. Both are
 * legitimate — a walk with no promoted moment can still be a place worth
 * standing in, and the scorer's thresholds are tuned for clips with audio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS DELIBERATELY REPEATABLE
 *
 * Nothing here marks the job as dispatched, so pressing the button twice sends
 * it twice. That is the right trade for now: the failure this exists to recover
 * from is "it went nowhere", and a guard that refused a second attempt would
 * re-create exactly the dead end it is meant to open. KIRI's own submission is
 * the only side effect that costs anything, and `dispatch` already declines
 * when there are no credits.
 *
 * Guarded by knowing the job id, which is the same posture as
 * /api/splat/jobs/[jobId]/video and gets fixed by the same change: once
 * journeys have owners (Phase 1.3/1.4) this reads the session and scopes to
 * `owns_journey`.
 */
import { NextResponse } from "next/server";

import { dispatch } from "@/lib/reconstruction/dispatch";
import { isReconTarget, type ReconTarget } from "@/lib/reconstruction/targets";
import { findUploadFor, getSplatJob } from "@/lib/splatJobs";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";
/** Node, not edge: dispatch reads the clip off the filesystem. */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The one that cannot cost anybody money, same as the handoff upload route.
 * An unrecognised target falls here rather than erroring: the caller asked for
 * a reconstruction, and refusing over a typo would serve nobody.
 */
const DEFAULT_TARGET: ReconTarget = "studio-batch";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  const { jobId } = await params;

  // Through the job record first — it is the only thing that proves this id was
  // minted here, and it stops a traversal attempt before it reaches the disk.
  if (!getSplatJob(jobId)) {
    return NextResponse.json(
      { error: "no such job" },
      { status: 404, headers: NO_STORE },
    );
  }

  const found = findUploadFor(jobId);
  if (!found) {
    // A real and expected state, not a bug: uploads are swept after
    // UPLOAD_RETENTION_MS. Say which one it is so the UI can stop offering it.
    return NextResponse.json(
      {
        error: "the clip for this job is no longer on disk — it may have been swept",
        gone: true,
      },
      { status: 410, headers: NO_STORE },
    );
  }

  // A body is optional. No body means "wherever you can", which is what the
  // fallback chain in lib/reconstruction/targets.ts already encodes.
  const body = (await request.json().catch(() => null)) as { target?: unknown } | null;
  const requested: ReconTarget = isReconTarget(body?.target) ? body.target : DEFAULT_TARGET;

  // Never throws. A failure is an outcome with a sentence attached, and the
  // clip is still on disk to try again with.
  const outcome = await dispatch({
    requested,
    filePath: found.path,
    filename: found.filename,
    jobId,
  });

  // 200 even when the dispatch failed. The request was understood and acted on;
  // "the studio is not running" is an answer about the world, not about this
  // call, and a 5xx here would make a working route look broken. The caller
  // reads `outcome.ok`.
  return NextResponse.json({ jobId, outcome }, { status: 200, headers: NO_STORE });
}
