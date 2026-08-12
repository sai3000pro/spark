/**
 * GET /api/splat/jobs/[jobId]/video — hand a stored clip back to the laptop.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * A clip recorded on the phone lands on the server, but the thing that turns a
 * video into a walk — the detector — runs in a browser tab. So the laptop has
 * to read the clip back to process it. That looks like a round trip for
 * nothing until you notice the alternative: running detection server-side,
 * which means onnxruntime-node, a model on the server, and the end of the
 * "frames never leave your machine" property that the whole capture flow is
 * built on. A LAN round trip is the cheaper price.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT GUARDS IT, AND WHAT DOES NOT
 *
 * Knowing the job id is the whole authorisation, and job ids are minted from a
 * timestamp — see createSplatJob — so they are guessable by anyone who can
 * guess a millisecond. That is the same posture as the rest of the app today,
 * which has no accounts at all, and it is fixed by the same change: once
 * journeys have owners (Phase 1.3/1.4), this reads the session and scopes to
 * `owns_journey`. Until then this route is LAN-appropriate and no more, which
 * is also true of the dev server it runs on.
 *
 * Range requests are supported because `<video>` elements ask for them, and a
 * 200-only response makes seeking either fail or buffer the whole file.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getSplatJob, UPLOAD_DIR } from "@/lib/splatJobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { jobId } = await params;

  // Through the job record rather than straight to the filesystem: it is the
  // only thing that proves this id was ever minted here, and it keeps a
  // traversal attempt from reaching readdir at all.
  if (!getSplatJob(jobId)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // The extension was chosen from a whitelist at upload time and is not
  // recorded on the job, so it is recovered by looking rather than by trusting
  // anything in the request.
  let name: string | undefined;
  try {
    const entries = await readdir(UPLOAD_DIR);
    name = entries.find((e) => e.startsWith(`${jobId}.`));
  } catch {
    return NextResponse.json({ error: "no-uploads" }, { status: 404 });
  }
  if (!name) return NextResponse.json({ error: "no-video" }, { status: 404 });

  const ext = path.extname(name).toLowerCase();
  const type = TYPES[ext];
  if (!type) return NextResponse.json({ error: "unsupported-type" }, { status: 415 });

  const file = path.join(UPLOAD_DIR, name);
  const size = (await stat(file)).size;

  const range = request.headers.get("range");
  const common = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    // Never cached: a job id is reused by nothing, but a stale 206 in a proxy
    // would be indistinguishable from a truncated upload.
    "Cache-Control": "no-store",
  };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (Number.isFinite(start) && start <= end && start < size) {
        const stream = Readable.toWeb(
          createReadStream(file, { start, end }),
        ) as unknown as ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: {
            ...common,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: { ...common, "Content-Length": String(size) },
  });
}
