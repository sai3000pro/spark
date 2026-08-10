/**
 * POST /api/splat/jobs — hand a video over for Gaussian-splat reconstruction.
 *
 * The one endpoint in the app that accepts bytes. It writes the video to
 * `.uploads/` and opens a job; the reconstruction runs elsewhere. See the header
 * of lib/splatJobs.ts for the full handoff, including where to put the result.
 *
 * The detector pass that builds the WALK does not go through here — that happens
 * in the browser and posts its findings to /api/upload/walk. The two are
 * deliberately independent: the walk is ready in seconds, the reconstruction
 * takes minutes, and neither should block the other.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createSplatJob, ensureDirs, listSplatJobs, UPLOAD_DIR } from "@/lib/splatJobs";

export const dynamic = "force-dynamic";
/** Node, not edge: this writes to the filesystem. */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Above this, reconstruction is not the bottleneck — the upload is. */
const MAX_BYTES = 512 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data with a `video` field" },
      { status: 400, headers: NO_STORE },
    );
  }

  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing `video` file field" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!file.type.startsWith("video/")) {
    return NextResponse.json(
      { error: `expected a video, got ${file.type || "an unknown type"}` },
      { status: 415, headers: NO_STORE },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `that video is ${(file.size / 1_048_576).toFixed(0)} MB; the limit is ${MAX_BYTES / 1_048_576} MB`,
      },
      { status: 413, headers: NO_STORE },
    );
  }

  const tripId = typeof form.get("tripId") === "string" ? (form.get("tripId") as string) : null;
  const job = createSplatJob({ sourceName: file.name, sourceBytes: file.size, tripId });

  ensureDirs();
  // Keep the original extension so ffmpeg downstream needs no guessing.
  const ext = path.extname(file.name) || ".mp4";
  /*
    `turbopackIgnore` because the tracer cannot see what this build already
    guarantees. It flags a dynamic path as "filesystem access that may reach
    anywhere" and responds by tracing the WHOLE project into the server bundle —
    every source file and all of public/ — which is a slow deploy at best and a
    size-limit failure at worst.

    Nothing dynamic escapes here: UPLOAD_DIR is a constant, `path.join(cwd(),
    ".uploads")`, and the only variable part is a filename built from our own
    generated job id plus an extension. The uploaded name is never used as a
    path — `path.extname` takes the extension from it and nothing else — so a
    caller cannot steer this out of the directory with "../".
  */
  const dest = path.join(/* turbopackIgnore: true */ UPLOAD_DIR, `${job.id}${ext}`);
  await writeFile(dest, Buffer.from(await file.arrayBuffer()));

  return NextResponse.json(
    {
      job,
      savedAs: path.relative(process.cwd(), dest),
      persisted: true,
      next: [
        `python -m tools.video_intel.splat_batch  # against ${path.relative(process.cwd(), dest)}`,
        `then drop the decoded result at public/mock/splats/${job.id}.ply`,
      ],
      note: "The reconstruction runs on the GPU box, not here. This endpoint only takes delivery of the video and opens the job.",
    },
    { status: 202, headers: NO_STORE },
  );
}

export function GET() {
  return NextResponse.json({ jobs: listSplatJobs() }, { status: 200, headers: NO_STORE });
}
