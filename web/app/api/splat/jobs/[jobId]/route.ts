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
import { getSplatJob } from "@/lib/splatJobs";
import { attachSplat } from "@/lib/uploadedTrips";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, ctx: RouteContext<"/api/splat/jobs/[jobId]">) {
  const { jobId } = await ctx.params;
  const job = getSplatJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "no such job" }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json({ job }, { status: 200, headers: NO_STORE });
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

  const attached = attachSplat(job.tripId, job.url);
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
