/**
 * GET /api/splat/jobs/:jobId — has the reconstruction landed yet?
 *
 * The status is not stored anywhere; it is read off the filesystem on every
 * call (lib/splatJobs.ts). So the answer is correct after a restart, after an
 * hour idle, and the instant someone copies a .ply into place — no worker, no
 * timer, nothing to get out of sync.
 *
 * POST to the same path attaches a ready reconstruction to its walk: every
 * moment in that walk flips from `processing` to `ready` and the splat viewer
 * starts rendering it with no other change anywhere.
 */
import { NextResponse } from "next/server";
import path from "node:path";

import { getCurrentUser } from "@/lib/auth/session";
import { fanOutJobStatus } from "@/lib/firebase/fanout";
import { collectFromKiri } from "@/lib/reconstruction/collect";
import { measurePly } from "@/lib/video/plyBounds";
import { getSplatJob, SPLAT_DIR } from "@/lib/splatJobs";
import { attachSplat } from "@/lib/uploadedTrips";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, ctx: RouteContext<"/api/splat/jobs/[jobId]">) {
  const { jobId } = await ctx.params;
  if (!getSplatJob(jobId)) {
    return NextResponse.json({ error: "no such job" }, { status: 404, headers: NO_STORE });
  }

  /*
    Collect a finished KIRI reconstruction, if there is one waiting.

    Polled from the read someone is already making rather than from a worker,
    for the same reason the status itself is derived rather than stored: no
    cron, no timer to leak, and a correct answer on a cold read hours later.

    It is a no-op unless this job actually went to KIRI and its splat is not
    here yet, and it never throws — a slow CDN must not turn "is it ready?"
    into a 500. When it does land a file, `getSplatJob` below sees it and the
    job flips to ready with nothing else involved.
  */
  const collected = await collectFromKiri(jobId);

  // Re-read AFTER collecting, so a splat that landed during this very call is
  // reported ready now rather than on the next poll.
  const job = getSplatJob(jobId)!;

  /*
    Tell everyone who is not this caller.

    This read is the ONLY moment the server learns anything about a
    reconstruction — there is no worker and no event, by design — so it is the
    only place a progress frame can come from. See lib/firebase/fanout.ts for
    what that buys: the phone that recorded the clip, and the three other tabs
    on this job, get the answer without each running their own poll and their
    own splat download.

    `?channel=` is the reader's own RTDB path segment, sent by the watcher once
    its anonymous sign-in resolves. Absent — no Firebase, a curl, the first poll
    before sign-in returns — nothing is published and everything still works,
    because the response below has always been the authoritative answer.

    Awaited rather than fired and forgotten: with no service account this is two
    null checks and returns immediately, and on a serverless host an unawaited
    promise is a promise that gets killed with the response.
  */
  await fanOutJobStatus(job, {
    channel: new URL(request.url).searchParams.get("channel"),
    userId: (await getCurrentUser())?.id ?? null,
    detail: collected.note,
  });

  return NextResponse.json(
    { job, ...(collected.note ? { kiri: collected.note } : {}) },
    { status: 200, headers: NO_STORE },
  );
}

export async function POST(_request: Request, ctx: RouteContext<"/api/splat/jobs/[jobId]">) {
  const { jobId } = await ctx.params;
  const job = getSplatJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "no such job" }, { status: 404, headers: NO_STORE });
  }
  if (job.status !== "ready" || !job.url) {
    return NextResponse.json(
      { error: "that reconstruction has not landed yet", job },
      { status: 409, headers: NO_STORE },
    );
  }
  if (!job.tripId) {
    return NextResponse.json(
      { error: "that job has no walk to attach to", job },
      { status: 409, headers: NO_STORE },
    );
  }

  /*
    Measured, not defaulted. A reconstruction arrives with its own scale and
    origin — KIRI normalises into a ±50 box, five times the extent of the
    hand-framed capture this viewer was tuned against — so without a camera
    derived from the file the splat loads, draws, and looks like nothing at all.
    See lib/video/plyBounds.ts.
  */
  const measured = measurePly(path.join(SPLAT_DIR, `${jobId}.ply`));
  const attached = attachSplat(job.tripId, job.url, measured?.pointCount, measured?.view);
  return NextResponse.json(
    {
      job,
      attached,
      note: attached
        ? "Every moment in that walk now points at the reconstruction."
        : "The walk is gone — the server restarted since it was built.",
    },
    { status: attached ? 200 : 409, headers: NO_STORE },
  );
}
