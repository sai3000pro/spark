/**
 * The phone delivers a POSED capture here: frames, plus where the camera was.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE ROUTE FROM handoff/[handoffId]/upload
 *
 * That route takes a video, and a video is a thing stage 1 has to cut into
 * frames and stage 2 has to solve poses for — 2.5 minutes of COLMAP for 119
 * frames, and an outright failure on a wall with no texture. This route takes
 * frames that ALREADY HAVE POSES, from ARCore by way of WebXR, and what it
 * writes is a finished stage-2 artefact. Stage 2 does not run slower on this
 * path; it does not run at all.
 *
 * They could not share a handler even if they wanted to, because the thing
 * being uploaded is a different thing: one clip versus N images and N poses
 * that must stay paired with each other or the dataset is worse than nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PHONE SENDS MATRICES AND NOT A COLMAP MODEL
 *
 * Derive, don't sync. The wire carries the raw platform values — `XRView`'s
 * camera-to-world matrix and projection matrix, verbatim, column-major — and
 * BOTH ends run the same tested conversion in lib/webxr/. If the phone sent
 * `images.txt` instead, the format would have two authors and a fix to the
 * basis flip would land on one of them.
 *
 * It also means the record on disk is inspectable: `webxr.json` keeps every
 * matrix as it arrived, so a reconstruction that comes out wrong can be
 * re-derived with a corrected conversion instead of re-filmed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT LANDS ON DISK, AND WHY EXACTLY THAT
 *
 *     <root>/<sessionId>/
 *         images/frame_00001.jpg ...
 *         sparse/0/cameras.txt      PINHOLE, one record per image
 *         sparse/0/images.txt       world->camera, COLMAP/OpenCV convention
 *         sparse/0/points3D.txt     header only — a browser has no depth sensor
 *         webxr.json                provenance: every raw matrix, and the UA
 *
 * That is precisely the layout `tools/spark_studio/poses.py::PrecomputedSolver`
 * consumes, and precisely what `tools/arkit_capture/export_colmap.py` writes for
 * an iPhone. `frame_%05d.jpg` rather than `%06d.jpg` because `pipeline.py`'s
 * stage-1 skip globs `frame_*.jpg` — see the filename note in lib/webxr/colmap.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS TAKES BYTES THROUGH A REQUEST HANDLER, WHICH IS TEMPORARY
 *
 * Same caveat as the video upload route, for the same reason and with the same
 * ceiling: it works on the dev server over LAN HTTP, which is the arrangement
 * this whole flow exists to prove, and it does not work behind a 4.5 MB edge
 * body cap. `maxFrames` in lib/webxr/capture.ts is what bounds it.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { noteUploadFinished, noteUploadStarted, verifyClaim } from "@/lib/handoff";
import { frameFileName, sparseModel, type PosedFrame } from "@/lib/webxr/colmap";
// From lib/webxr/record, NOT lib/webxr/capture. The capture module is
// "use client", and Next turns every export of a "use client" module into a
// client reference this handler is forbidden to call - it fails at RUNTIME with
// "Attempted to call intrinsicsForRecord() from the server", having typechecked
// perfectly. See the header of lib/webxr/record.ts.
import { intrinsicsForRecord, type CapturedFrameRecord } from "@/lib/webxr/record";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where posed datasets land.
 *
 * Overridable because it is NOT ours to choose: the studio reconstructs from
 * it, and the studio may be started with any working directory. Same reasoning
 * as `--sessions` in tools/spark_studio/cli.py, where the two processes must
 * agree on a path or the frames arrive somewhere nothing reads.
 */
const CAPTURE_ROOT =
  process.env.SPARK_POSED_CAPTURE_DIR ?? path.join(process.cwd(), ".captures");

/**
 * 400 frames at ~1280 px is a generous walk around a subject and roughly 100 MB
 * of JPEG. Beyond that the request is more likely a bug than a capture.
 */
const MAX_FRAMES = 400;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/**
 * A session id becomes a directory name. Same alphabet as `_SAFE_SESSION` in
 * tools/live_capture_server/protocol.py and tools/spark_studio/live.py, because
 * these ids are shared across all three and a name legal in one must be legal
 * in the others. The id is minted here rather than accepted from the phone, and
 * this pattern is the belt to that pair of braces.
 */
const SAFE_SESSION = /^[A-Za-z0-9_-]{1,128}$/;

interface Ctx {
  params: Promise<{ handoffId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { handoffId } = await params;

  // Checked before a single byte is read, for the same reason as the video
  // route: a body field cannot authorise the upload it is buried inside.
  const token = request.headers.get("x-handoff-token") ?? "";
  if (!verifyClaim(handoffId, token)) {
    return NextResponse.json({ error: "not-claimed-or-bad-token" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 415 });
  }

  const manifestRaw = form.get("manifest");
  if (typeof manifestRaw !== "string") {
    return NextResponse.json({ error: "missing manifest" }, { status: 400 });
  }

  let records: CapturedFrameRecord[];
  let userAgent: string;
  try {
    const parsed = JSON.parse(manifestRaw) as {
      frames?: unknown;
      userAgent?: unknown;
    };
    if (!Array.isArray(parsed.frames)) throw new Error("frames must be an array");
    records = parsed.frames as CapturedFrameRecord[];
    userAgent = typeof parsed.userAgent === "string" ? parsed.userAgent.slice(0, 300) : "";
  } catch (err) {
    return NextResponse.json(
      { error: "bad manifest", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "no frames" }, { status: 400 });
  }
  if (records.length > MAX_FRAMES) {
    return NextResponse.json(
      { error: "too-many-frames", maxFrames: MAX_FRAMES },
      { status: 413 },
    );
  }

  // The WHOLE sparse model is built before anything is written, and that is not
  // an optimisation.
  //
  // Every conversion that can throw runs here: a non-rigid matrix, a projection
  // with no focal terms, a non-finite number that would serialise as "NaN". If
  // any of them fired later, half a dataset would already be on disk — and a
  // half-written dataset is worse than none, because `_has_poses` in pipeline.py
  // would read it as a successful stage 2 forever after.
  //
  // Found by testing rather than reasoning: `sparseModel` used to be called in
  // the write block, so a non-rigid pose came back as a 500 with no explanation
  // instead of a 422 naming the frame.
  let posed: PosedFrame[];
  let model: ReturnType<typeof sparseModel>;
  try {
    posed = records.map((record, i) => {
      const index = i + 1;
      if (!Array.isArray(record.cameraToWorld) || record.cameraToWorld.length !== 16) {
        throw new Error(`frame ${index}: cameraToWorld must be 16 numbers`);
      }
      if (!Array.isArray(record.projection) || record.projection.length !== 16) {
        throw new Error(`frame ${index}: projection must be 16 numbers`);
      }
      return {
        index,
        cameraToWorld: record.cameraToWorld,
        // The same function the phone would use, run here. See the header.
        intrinsics: intrinsicsForRecord(record),
        timestampMs: record.timestampMs,
      };
    });
    model = sparseModel(posed);
  } catch (err) {
    return NextResponse.json(
      { error: "unusable-poses", detail: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }

  // Every frame must have its image and every image its frame. A dataset where
  // image 47 is missing but images.txt still names it is not a smaller dataset,
  // it is a broken one: COLMAP readers treat the absent file as a fatal error.
  const blobs: Blob[] = [];
  let totalBytes = 0;
  for (let i = 0; i < posed.length; i++) {
    const part = form.get(`frame_${i + 1}`);
    if (!(part instanceof Blob)) {
      return NextResponse.json(
        { error: "missing-frame-image", index: i + 1 },
        { status: 400 },
      );
    }
    totalBytes += part.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: "too-large", maxBytes: MAX_TOTAL_BYTES },
        { status: 413 },
      );
    }
    blobs.push(part);
  }

  const sessionId = mintSessionId();
  if (!SAFE_SESSION.test(sessionId)) {
    // Unreachable unless mintSessionId changes. Kept because what is on the
    // other side of this line is `path.join` with a directory name.
    return NextResponse.json({ error: "bad session id" }, { status: 500 });
  }
  const root = path.join(CAPTURE_ROOT, sessionId);

  noteUploadStarted(handoffId, `webxr capture (${posed.length} posed frames)`, totalBytes);

  try {
    await mkdir(path.join(root, "images"), { recursive: true });
    await mkdir(path.join(root, "sparse", "0"), { recursive: true });

    for (let i = 0; i < posed.length; i++) {
      const bytes = Buffer.from(await blobs[i].arrayBuffer());
      await writeFile(path.join(root, "images", frameFileName(posed[i].index)), bytes);
    }

    // The model is written LAST, after every image is on disk. `_has_poses` in
    // pipeline.py is what decides stage 2 can be skipped, and it decides by
    // reading these files — so they must never exist before the images they
    // describe do, or an interrupted upload becomes a run that trains on a
    // dataset with holes in it.
    for (const [name, text] of Object.entries(model)) {
      await writeFile(path.join(root, "sparse", "0", name), text, "utf8");
    }

    await writeFile(
      path.join(root, "webxr.json"),
      JSON.stringify(
        {
          session: sessionId,
          handoff: handoffId,
          source: "webxr",
          userAgent,
          receivedAt: new Date().toISOString(),
          frames: records.map((r, i) => ({ ...r, index: i + 1 })),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    // A half-written dataset is worse than none: it would read as a successful
    // stage 2 forever. Take it away rather than leave it looking finished.
    await rm(root, { recursive: true, force: true }).catch(() => {});
    console.error("[posed] write failed:", err);
    return NextResponse.json({ error: "write-failed" }, { status: 500 });
  }

  noteUploadFinished(handoffId, totalBytes, sessionId);

  return NextResponse.json(
    {
      ok: true,
      sessionId,
      frames: posed.length,
      bytes: totalBytes,
      dataset: root,
      /**
       * Handed back rather than run. Reconstruction needs a GPU and Brush, and
       * this process has neither and no business starting a two-hour job on
       * someone else's machine from a phone request. Naming the command is the
       * same courtesy `lib/reconstruction/targets.ts` extends when the studio
       * is not running: a fact the reader can act on.
       */
      reconstructWith: `python -m spark_studio "${root}" -o "${path.join(root, "splat.ply")}"`,
      note:
        `Stored ${posed.length} posed frames. Camera positions came from the phone, ` +
        `so the slow camera-solving stage is skipped entirely.`,
    },
    { status: 201 },
  );
}

/**
 * Server-minted, never taken from the phone.
 *
 * `wx_` so a directory listing says where it came from; the rest is a timestamp
 * (sorts chronologically, which is how anyone actually looks for one of these)
 * plus randomness for uniqueness within the same millisecond.
 */
function mintSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `wx_${stamp}_${rand}`;
}
