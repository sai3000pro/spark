/**
 * The phone delivers its video here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE TAKES BYTES, AND THAT IS TEMPORARY.
 *
 * A 3-minute 1080p phone clip is 150–400 MB. Streaming that through a request
 * handler works on a dev server and does NOT work on Vercel, whose request-body
 * cap is 4.5 MB at the infrastructure level. The production shape is a signed
 * ticket plus a direct browser→storage upload — lib/storage/ already implements
 * the provider side of it, and `createResumableUpload` is the seam.
 *
 * It is written this way FIRST because the point of this slice is to prove the
 * phone→laptop loop end to end on hardware that exists, over plain LAN HTTP,
 * with no cloud account configured. Swapping the transport later does not change
 * the flow; not knowing whether the flow works would have changed everything.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { NextResponse } from "next/server";

import { noteUploadFinished, noteUploadStarted, verifyClaim } from "@/lib/handoff";
import { dispatch } from "@/lib/reconstruction/dispatch";
import { isReconTarget, type ReconTarget } from "@/lib/reconstruction/targets";
import { createSplatJob, UPLOAD_DIR } from "@/lib/splatJobs";
import { videoExtFor } from "@/lib/storage/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Above KIRI's 3-minute cap a clip is rejected anyway; this is a sanity bound. */
const MAX_BYTES = 512 * 1024 * 1024;

/** Where it goes if the phone did not say. Local, free, and never spends a credit. */
const DEFAULT_TARGET: ReconTarget = "studio-batch";

interface Ctx {
  params: Promise<{ handoffId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { handoffId } = await params;

  // The token rides a header rather than the multipart body: it must be checked
  // BEFORE a single byte is read, and a body field cannot be reached without
  // first consuming the upload it is supposed to authorise.
  const token = request.headers.get("x-handoff-token") ?? "";
  if (!verifyClaim(handoffId, token)) {
    return NextResponse.json(
      { error: "not-claimed-or-bad-token" },
      { status: 403 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return NextResponse.json(
      { error: "too-large", maxBytes: MAX_BYTES },
      { status: 413 },
    );
  }

  const ext = videoExtFor(contentType);
  if (!ext) {
    return NextResponse.json(
      { error: "unsupported-type", got: contentType, want: ["video/mp4", "video/quicktime", "video/webm"] },
      { status: 415 },
    );
  }

  if (!request.body) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }

  // The raw stream, not multipart: the phone sends the file as the body, so
  // nothing has to buffer it to parse a boundary. The original filename comes
  // from a header and is used ONLY as a display string — the path below is built
  // from a server-minted id and a whitelisted extension, so nothing the phone
  // says can shape it.
  const name = (request.headers.get("x-file-name") ?? "capture").slice(0, 120);

  // Where the phone asked for this to be reconstructed. A header rather than a
  // query string so it never lands in an access log next to the upload, and
  // validated rather than trusted — an unknown value falls back to the local
  // route, which is the one that cannot cost anybody money.
  const asked = request.headers.get("x-reconstruct-target");
  const requested: ReconTarget = isReconTarget(asked) ? asked : DEFAULT_TARGET;

  // A REAL job, not a label. This route used to mint an id string and register
  // nothing, so the "jobId" it handed back referred to no record anywhere and
  // /api/splat/jobs/[jobId] would 404 it forever.
  const job = createSplatJob({ sourceName: name, sourceBytes: declared });

  noteUploadStarted(handoffId, name, declared);

  await mkdir(UPLOAD_DIR, { recursive: true });
  const dest = path.join(UPLOAD_DIR, `${job.id}.${ext}`);

  let written = 0;
  try {
    const source = Readable.fromWeb(request.body as never);
    source.on("data", (chunk: Buffer) => {
      written += chunk.length;
    });
    await pipeline(source, createWriteStream(dest));
  } catch (err) {
    console.error("[handoff] upload failed:", err);
    return NextResponse.json({ error: "write-failed" }, { status: 500 });
  }

  if (written === 0) {
    return NextResponse.json({ error: "received 0 bytes" }, { status: 400 });
  }

  // Safe on disk. Only now is anything allowed to fail — see the header of
  // lib/reconstruction/dispatch.ts. The handoff is marked received BEFORE the
  // dispatch, so a phone that walks out of Wi-Fi during a KIRI upload still
  // sees its clip land, and the laptop still shows it arrived.
  noteUploadFinished(handoffId, written, job.id);

  const outcome = await dispatch({
    requested,
    filePath: dest,
    filename: `${job.id}.${ext}`,
  });

  return NextResponse.json(
    {
      ok: true,
      jobId: job.id,
      bytes: written,
      stored: true,
      reconstruction: outcome,
      note: outcome.ok
        ? outcome.note
        : `${outcome.note} (Saved as ${job.id}.${ext}.)`,
    },
    { status: 201 },
  );
}
