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
 * It equally accepts a splat from anywhere else — KIRI, Polycam, Luma,
 * Postshot, a friend. There is nothing in a Gaussian splat that records what
 * made it, and pretending otherwise would only mean refusing files that work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIVE FORMATS, NOT ONE
 *
 * This took `.ply` and nothing else, which was a limit of the gate rather than
 * of the app: lib/splat/renderer.ts has always documented that Spark opens ply,
 * spz, splat, ksplat and pcsogs, and that mkkellogg opens ply, splat and
 * ksplat. So a Luma `.splat`, or an `.spz` a third the size of the PLY it came
 * from, was refused with a sentence explaining it was not a PLY — true, and
 * useless to someone holding a file this app can draw.
 *
 * Now: ply, spz, splat, ksplat. Identified by their bytes rather than by their
 * name, in lib/splat/formats.ts, which also writes down what each format lets
 * us verify and what it does not — they are not equally checkable and it says
 * so. The stored file keeps the real extension and `getSplatJob` finds it by
 * looking for any of them, so a capture stored as `.spz` is found, served and
 * reported ready with nothing to keep in sync.
 *
 * PCSOGS is left out. It is a directory of PNGs plus a JSON manifest, or a zip
 * of one, and "store this upload under one name" is not a shape it fits — that
 * is a different endpoint, not a wider whitelist here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STREAMED, NOT BUFFERED — ON THE RAW PATH
 *
 * The two real captures in this repo are 59 MB and 143 MB, and 500 MB is a
 * normal export at high quality. So the raw body is piped to a temporary file
 * while only the first 64 KB is kept, which is all the header check needs.
 *
 * The multipart path does NOT get that, and the comment here used to imply it
 * did. `request.formData()` decodes the whole body before returning, so a
 * browser upload is held by the runtime first and only then streamed to disk.
 * That is the price of accepting what a file input produces; the size ceiling
 * is checked against `file.size` the moment the form is readable, which is the
 * earliest this path can refuse anything. Fixing it properly means parsing
 * multipart by hand, which is a different piece of work from this one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING BECOMES VISIBLE UNTIL IT IS VALID
 *
 * The bytes land on `.uploading-*.tmp` and are renamed to `<id>.<ext>` only
 * after the format is identified and the size checks out. `getSplatJob` derives
 * readiness from that filename existing, so a half-written or rejected upload
 * appearing there for even a moment is a capture the app would call ready and
 * the viewer would fail to draw. Rename is atomic within a directory; a partial
 * file cannot be observed under the real name.
 *
 * The job record is minted AFTER validation for the same reason: a rejected
 * upload should leave nothing behind, not a permanent job describing a file
 * that was never accepted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT IS NOT UNLIMITED
 *
 * A gigabyte a time, unauthenticated, into a statically-served directory, with
 * nothing saying how many times. See ./limits.ts, which holds the byte budget,
 * the rate limit, the concurrency cap and the seam where authentication goes —
 * and which explains why an auth layer is deliberately NOT written here.
 */
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { NextResponse } from "next/server";

import { canStoreUploads, storageReality } from "@/lib/deployment";
import { detectSplatFormat, MAX_HEADER_BYTES } from "@/lib/splat/formats";
import { createSplatJob, ensureDirs, getSplatJob, splatPathFor } from "@/lib/splatJobs";

import {
  MAX_UPLOAD_BYTES,
  MIN_UPLOAD_BYTES,
  openUploadSlot,
  SPLAT_STORE_BUDGET_BYTES,
  tempUploadPath,
  type UploadSlot,
} from "./limits";

export const dynamic = "force-dynamic";
/** Node, not edge: this writes to the filesystem. */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Thrown out of the tee so the pipeline unwinds and the temp file is removed. */
class TooLarge extends Error {}
class NoSpace extends Error {}

/**
 * Tee the leading bytes off the stream while it flows to disk.
 *
 * The header has to be read to decide whether to keep the file, and the file is
 * too big to hold in memory to decide it — so the prefix is kept and the rest
 * is forgotten as it passes. Also where both size limits are enforced, because
 * Content-Length is a claim by the sender and the byte count is a fact: the
 * per-file ceiling, and the shared disk budget, which the slot answers for
 * because it knows what every other upload in flight has written.
 */
function tee(state: { head: Buffer[]; headLen: number; total: number }, slot: UploadSlot): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      state.total += chunk.length;
      const verdict = slot.accept(state.total);
      if (verdict === "too-large") {
        cb(new TooLarge());
        return;
      }
      if (verdict === "no-space") {
        cb(new NoSpace());
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
  /*
    Admission before a single byte is read.

    Concurrency, rate limit and disk budget all answer from state this process
    already has or from one directory scan, so a refused upload costs the sender
    a connection and costs this machine nothing. Checking after the transfer
    would mean accepting a gigabyte in order to say no to it.
  */
  /*
    Can this deployment keep a splat at all?

    Asked FIRST, before a byte is read, because the alternative is what used to
    happen on a read-only host: `ensureDirs()` throws EROFS from inside the
    handler and the caller gets a 500 about a path. Someone who just waited out
    a 200 MB upload deserves a sentence about the deployment, not a stack trace.

    `durable`, not merely `writable` — see canStoreUploads(). Taking the bytes
    onto a disk that evaporates before anyone can open the result is worse than
    refusing them, because the upload was spent and the answer was "ready".
  */
  if (!canStoreUploads()) {
    return NextResponse.json(
      { error: storageReality().reason },
      { status: 503, headers: { ...NO_STORE, "Retry-After": "3600" } },
    );
  }

  const slot = openUploadSlot(request);
  if (!slot.ok) {
    return NextResponse.json(
      { error: slot.error },
      {
        status: slot.status,
        headers:
          slot.status === 503 || slot.status === 429
            ? { ...NO_STORE, "Retry-After": "60" }
            : NO_STORE,
      },
    );
  }

  try {
    return await handle(request, slot);
  } finally {
    // Always. A leaked slot counts against MAX_CONCURRENT_UPLOADS forever, and
    // four of those jam the endpoint for the life of the process.
    slot.close();
  }
}

async function handle(request: Request, slot: UploadSlot) {
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
    /*
      `splat` is the name now, and `ply` still works.

      The field was called `ply` when a PLY was the only thing that could be
      sent, and renaming it outright would break anything already written
      against this endpoint — including copies of the studio executable already
      on people's machines. Accepting both costs one line and keeps a field name
      from being the reason a valid .spz is refused.
    */
    const file = form.get("splat") ?? form.get("ply");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "missing `splat` file field" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error:
            `That splat is ${(file.size / 1_048_576).toFixed(0)} MB; ` +
            `the limit is ${MAX_UPLOAD_BYTES / 1_048_576} MB.`,
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
    // touches the path, which is built from an id this server minted and an
    // extension chosen by the format detector rather than by the sender.
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

  // A temporary name nothing serves and nothing derives a job from. See
  // `tempUploadPath` for why it is a UUID and why it lives in this directory.
  const tmp = tempUploadPath();
  const state = { head: [] as Buffer[], headLen: 0, total: 0 };

  try {
    await pipeline(
      Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]),
      tee(state, slot),
      createWriteStream(tmp),
    );
  } catch (err) {
    await unlink(tmp).catch(() => {});
    if (err instanceof TooLarge) {
      return NextResponse.json(
        { error: `That splat is over the ${MAX_UPLOAD_BYTES / 1_048_576} MB limit.` },
        { status: 413, headers: NO_STORE },
      );
    }
    if (err instanceof NoSpace) {
      // Not the same refusal as the one at admission: this upload was let in,
      // and it is the file's own size — or another upload racing it — that ran
      // the store out. Say that, rather than "the store is already full".
      return NextResponse.json(
        {
          error:
            `That splat does not fit: this app keeps at most ` +
            `${SPLAT_STORE_BUDGET_BYTES / 1_073_741_824} GB of uploaded captures and it is now full. ` +
            "Delete one you no longer want and send this again.",
        },
        { status: 507, headers: NO_STORE },
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
    The format check runs BEFORE the size floor, and the order is the message.

    With the floor first, a small ASCII PLY was refused as "too small to be a
    splat" — true, and useless. The file's actual problem is that it is ASCII,
    which is a thing the person can fix by re-exporting; its size is a symptom
    of that, not the fault. Whichever check runs first decides what the user is
    told, so the specific reason has to win over the generic one.

    The size passed here is the COUNTED one, not Content-Length — a sender's
    claim about length is exactly what the truncation check exists to catch.
  */
  const detected = detectSplatFormat(Buffer.concat(state.head), state.total);
  if (!detected.ok) {
    await unlink(tmp).catch(() => {});
    return NextResponse.json({ error: detected.reason }, { status: 415, headers: NO_STORE });
  }

  // Reached only by a file that parsed clean, which at this size means a header
  // describing almost no gaussians. Nothing renders from it.
  if (state.total < MIN_UPLOAD_BYTES) {
    await unlink(tmp).catch(() => {});
    return NextResponse.json(
      { error: "That file is too small to be a splat." },
      { status: 400, headers: NO_STORE },
    );
  }

  const job = createSplatJob({
    sourceName: declaredName || `uploaded.${detected.format}`,
    sourceBytes: state.total,
    origin: "upload",
    tripId,
    // Kept, because for spz, ksplat and rad this is the only time anyone counts
    // them — see the field's note in lib/splatJobs.ts.
    splatCount: detected.count,
  });

  try {
    // The extension comes from the DETECTOR, never from `declaredName`. A file
    // somebody called `walk.ply` that is really an SPZ is stored as `.spz`, so
    // the renderer picks the right decoder from the URL it is handed.
    await rename(tmp, splatPathFor(job.id, `.${detected.format}`));
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
    with nothing on disk yet — so its derived fields describe a moment that has
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
      format: detected.format,
      /**
       * Null when the format will not say — a `.ksplat` with more sections than
       * the kept prefix reaches. Null rather than 0, because 0 would be read as
       * an empty capture and this is "not counted".
       */
      gaussians: detected.count,
      bytes: state.total,
      /**
       * Whether lib/video/plyBounds.ts can derive a camera from this file.
       *
       * False for every format but an all-float PLY, and reported rather than
       * left to be discovered: the viewer frames a non-PLY capture with its
       * default camera, and a caller that knows that up front can say so
       * instead of showing "the header did not parse" about a good file.
       */
      measurable: detected.measurable,
      /** Null unless something is worth saying. The UI shows it when set. */
      warning: detected.warning,
      view: `/splat/${job.id}`,
    },
    { status: 201, headers: NO_STORE },
  );
}
