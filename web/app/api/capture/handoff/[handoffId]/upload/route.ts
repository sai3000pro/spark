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
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { NextResponse } from "next/server";

import { noteUploadFinished, noteUploadStarted, verifyClaim } from "@/lib/handoff";
import { videoExtFor } from "@/lib/storage/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Above KIRI's 3-minute cap a clip is rejected anyway; this is a sanity bound. */
const MAX_BYTES = 512 * 1024 * 1024;

const UPLOAD_DIR = path.join(process.cwd(), ".uploads");

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
  const jobId = `splat_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

  noteUploadStarted(handoffId, name, declared);

  await mkdir(UPLOAD_DIR, { recursive: true });
  const dest = path.join(UPLOAD_DIR, `${jobId}.${ext}`);

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

  noteUploadFinished(handoffId, written, jobId);

  return NextResponse.json(
    {
      ok: true,
      jobId,
      bytes: written,
      note:
        "Stored locally under .uploads. Reconstruction is a separate errand — " +
        "see lib/reconstruction when the provider layer lands.",
    },
    { status: 201 },
  );
}
