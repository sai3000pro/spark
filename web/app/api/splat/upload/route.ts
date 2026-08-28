/**
 * POST /api/splat/upload — hand the app a splat that is already finished.
 *
 * The other direction from /api/splat/jobs. That route takes a video and owes
 * you a reconstruction; this one takes the reconstruction itself and owes you
 * nothing but a URL. It is the endpoint that makes the local pipeline usable by
 * someone who is not sitting at this checkout with a terminal open:
 *
 *   1. download the studio executable, run it on a clip
 *   2. it writes walk.ply
 *   3. drop that file here, in the browser
 *   4. it is a capture — viewable, nameable, saveable to an album
 *
 * Step 3 is also what the executable does for you when it is pointed at a
 * running app (`--push`), so the manual upload is the fallback rather than the
 * expected path. Both arrive here.
 *
 * It equally accepts a .ply from anywhere else — KIRI, Polycam, Luma, Postshot,
 * a friend. There is nothing in a Gaussian splat that records what made it, and
 * pretending otherwise would only mean refusing files that work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STREAMED, NOT BUFFERED
 *
 * `request.formData()` reads the whole upload into memory before handing it
 * over, which is survivable for a form field and not for a splat — the two real
 * captures in this repo are 59 MB and 143 MB, and 500 MB is a normal export at
 * high quality. So the body is piped to a temporary file while only the first
 * 64 KB is kept, which is all the header check needs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING BECOMES VISIBLE UNTIL IT IS VALID
 *
 * The bytes land on `.uploading-*.tmp` and are renamed to `<id>.ply` only after
 * the header parses and the size checks out. `getSplatJob` derives readiness
 * from that filename existing, so a half-written or rejected upload appearing
 * there for even a moment is a capture the app would call ready and the viewer
 * would fail to draw. Rename is atomic within a directory; a partial file
 * cannot be observed under the real name.
 *
 * The job record is minted AFTER validation for the same reason: a rejected
 * upload should leave nothing behind, not a permanent job describing a file
 * that was never accepted.
 */
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { NextResponse } from "next/server";

import { MAX_HEADER_BYTES, parsePlyHeader } from "@/lib/splat/plyHeader";
import { createSplatJob, ensureDirs, getSplatJob, plyPathFor, SPLAT_DIR } from "@/lib/splatJobs";

export const dynamic = "force-dynamic";
/** Node, not edge: this writes to the filesystem. */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The ceiling on a single splat.
 *
 * Higher than the 512 MB video limit on /api/splat/jobs, and deliberately so:
 * that limit is about an upload that has to survive a phone's connection, while
 * this one is usually a local file moving over localhost. A 4-million-gaussian
 * export at full spherical-harmonic detail is around 900 MB, and refusing it
 * would refuse the best output the studio can produce.
 */
const MAX_BYTES = 1024 * 1024 * 1024;

/** Below this there is no plausible splat — it is a stray or empty file. */
const MIN_BYTES = 256;

class TooLarge extends Error {}

/**
 * Tee the leading bytes off the stream while it flows to disk.
 *
 * The header has to be read to decide whether to keep the file, and the file is
 * too big to hold in memory to decide it — so the prefix is kept and the rest
 * is forgotten as it passes. Also where the size cap is enforced, because
 * Content-Length is a claim by the sender and the byte count is a fact.
 */
function tee(state: { head: Buffer[]; headLen: number; total: number }): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      state.total += chunk.length;
      if (state.total > MAX_BYTES) {
        cb(new TooLarge());
        return;
      }
      if (state.headLen < MAX_HEADER_BYTES) {
        const want = Math.min(chunk.length, MAX_HEADER_BYTES - state.headLen);
        state.head.push(chunk.subarray(0, want));
        state.headLen += want;
      }
      cb(null, chunk);
    },
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  /*
    Two shapes, one handler.

    A browser sends multipart because that is what a file input produces. The
    studio executable sends the raw body because that is what a CLI can do in
    one line with no dependencies. Refusing either would mean the tool and the
    tab need different endpoints to do the same thing.
  */
  let source: ReadableStream<Uint8Array> | null = null;
  let declaredName = "";
  let tripId: string | null = null;

  if (contentType.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "That upload could not be read as a form." },
        { status: 400, headers: NO_STORE },
      );
    }
    const file = form.get("ply");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "missing `ply` file field" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            `That splat is ${(file.size / 1_048_576).toFixed(0)} MB; ` +
            `the limit is ${MAX_BYTES / 1_048_576} MB.`,
        },
        { status: 413, headers: NO_STORE },
      );
    }
    source = file.stream();
    declaredName = file.name;
    const t = form.get("tripId");
    if (typeof t === "string" && t) tripId = t;
  } else {
    source = request.body;
    // The filename is cosmetic — it becomes `sourceName` for display and never
    // touches the path, which is built from an id this server minted.
    declaredName = request.headers.get("x-splat-filename") ?? "";
    const t = request.headers.get("x-splat-trip");
    if (t) tripId = t;
  }

  if (!source) {
    return NextResponse.json(
      { error: "That request had no body to store." },
      { status: 400, headers: NO_STORE },
    );
  }

  ensureDirs();

  /*
    A temporary name nothing serves and nothing derives a job from.

    In SPLAT_DIR rather than the system temp directory, so the final step is a
    rename WITHIN a directory. A rename across filesystems is a copy plus a
    delete — not atomic, and on a 500 MB file not fast — which would reintroduce
    the window where a half-written file sits under the served name.
  */
  const tmp = path.join(SPLAT_DIR, `.uploading-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  const state = { head: [] as Buffer[], headLen: 0, total: 0 };

  try {
    await pipeline(
      Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]),
      tee(state),
      createWriteStream(tmp),
    );
  } catch (err) {
    await unlink(tmp).catch(() => {});
    if (err instanceof TooLarge) {
      return NextResponse.json(
        { error: `That splat is over the ${MAX_BYTES / 1_048_576} MB limit.` },
        { status: 413, headers: NO_STORE },
      );
    }
    // A dropped connection mid-upload lands here. The temp file is already
    // gone, so there is nothing to resume and nothing to clean up later.
    return NextResponse.json(
      { error: "The upload did not finish. Nothing was saved — try again." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (state.total === 0) {
    await unlink(tmp).catch(() => {});
    return NextResponse.json({ error: "That file is empty." }, { status: 400, headers: NO_STORE });
  }

  /*
    The header check runs BEFORE the size floor, and the order is the message.

    With the floor first, a small ASCII PLY was refused as "too small to be a
    splat" — true, and useless. The file's actual problem is that it is ASCII,
    which is a thing the person can fix by re-exporting; its size is a symptom
    of that, not the fault. Whichever check runs first decides what the user is
    told, so the specific reason has to win over the generic one.

    The size passed here is the COUNTED one, not Content-Length — a sender's
    claim about length is exactly what the truncation check exists to catch.
  */
  const header = parsePlyHeader(Buffer.concat(state.head), state.total);
  if (!header.ok) {
    await unlink(tmp).catch(() => {});
    return NextResponse.json(
      { error: header.reason },
      { status: 415, headers: NO_STORE },
    );
  }

  // Reached only by a file that parsed clean, which at this size means a
  // header describing almost no vertices. Nothing renders from it.
  if (state.total < MIN_BYTES) {
    await unlink(tmp).catch(() => {});
    return NextResponse.json(
      { error: "That file is too small to be a splat." },
      { status: 400, headers: NO_STORE },
    );
  }

  const job = createSplatJob({
    sourceName: declaredName || "uploaded.ply",
    sourceBytes: state.total,
    origin: "ply",
    tripId,
  });

  try {
    await rename(tmp, plyPathFor(job.id));
  } catch {
    await unlink(tmp).catch(() => {});
    // The job now points at a file that is not there. `getSplatJob` reports
    // that as failed with a note saying so, which is the honest outcome — but
    // the caller gets a 500 rather than a URL, because nothing is viewable.
    return NextResponse.json(
      { error: "The splat validated but could not be stored. Check disk space." },
      { status: 500, headers: NO_STORE },
    );
  }

  /*
    Re-read, rather than patching the record we already hold.

    `createSplatJob` returns the job as it looked BEFORE the rename — that is,
    with no .ply on disk yet — so its derived fields describe a moment that has
    already passed. Spreading it and overriding `status` and `url` by hand
    produced a response that said `status: "ready"` next to `note: "The uploaded
    splat is no longer on disk"`, which is what happens when two fields are
    asserted and the third is left to disagree with them.

    Asking again is the fix and it is also the rule this whole module follows:
    readiness comes from looking, never from claiming.
  */
  const stored = getSplatJob(job.id);
  if (!stored) {
    return NextResponse.json(
      { error: "The splat was stored but could not be read back." },
      { status: 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      job: stored,
      gaussians: header.count,
      bytes: state.total,
      /** Null unless something is worth saying. The UI shows it when set. */
      warning: header.warning,
      view: `/splat/${job.id}`,
    },
    { status: 201, headers: NO_STORE },
  );
}
