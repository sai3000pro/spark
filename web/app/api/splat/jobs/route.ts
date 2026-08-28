/**
 * POST /api/splat/jobs — hand a video over for Gaussian-splat reconstruction.
 *
 * The one endpoint in the app that accepts bytes. It writes the video to
 * `.uploads/`, opens a job, and then hands the clip to `dispatch` — the same
 * call the phone handoff and the "try anyway" route make. See the header of
 * lib/splatJobs.ts for where a finished result has to land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT USED TO STOP AFTER THE WRITE, AND THAT WAS THE WHOLE BUG.
 *
 * This route took the video, minted a job, and told the caller the reconstruction
 * "runs on the GPU box, not here" — while calling nothing and notifying nobody.
 * Nothing was ever sent to the studio or to KIRI. Meanwhile the panel that ticks
 * "also reconstruct a splat" started a live watcher on the returned job id, which
 * has exactly two states — "waiting" and, after thirty minutes, "still working" —
 * and no state at all meaning "nothing was ever dispatched". So a person ticked a
 * box, was shown work in progress, and waited on a queue that did not exist.
 *
 * A dispatch is one call. Not making it was the difference between a pipeline and
 * a filing cabinet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE UPLOAD AND THE DISPATCH ARE TWO DIFFERENT FACTS.
 *
 * The response carries both, and the status code only ever reports the first. The
 * bytes are on disk before `dispatch` is called (store-before-dispatch, see the
 * header of lib/reconstruction/dispatch.ts) and they stay there whatever it
 * answers — so a studio that is not running, a KIRI key that is out of credits,
 * or a clip refused at pre-flight all still return 202 with the job. The caller
 * reads `reconstruction.ok`; anything else would tell someone who just walked
 * around a building for three minutes that their recording did not arrive.
 *
 * The detector pass that builds the WALK does not go through here — that happens
 * in the browser and posts its findings to /api/upload/walk. The two are
 * deliberately independent: the walk is ready in seconds, the reconstruction
 * takes minutes, and neither should block the other.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { dispatch } from "@/lib/reconstruction/dispatch";
import { isReconTarget, type ReconTarget } from "@/lib/reconstruction/targets";
import { createSplatJob, ensureDirs, listSplatJobs, UPLOAD_DIR } from "@/lib/splatJobs";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";
/** Node, not edge: this writes to the filesystem. */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Above this, reconstruction is not the bottleneck — the upload is. */
const MAX_BYTES = 512 * 1024 * 1024;

/**
 * Where the clip goes when the caller did not say, or said something we do not
 * ship. Local, free, and it cannot cost anybody money — the same default as the
 * phone handoff upload route and /api/splat/jobs/[jobId]/dispatch.
 *
 * IT MUST NEVER BE "kiri", and the reason is not symmetry with those routes.
 * KIRI credits are countable, unrepeatable and the user's own, and the only
 * control that reaches this route from the laptop panel is a checkbox reading
 * "also reconstruct a splat · uploads the video" — which says nothing whatsoever
 * about spending money. Falling back to the cloud would turn a typo, an older
 * client, or a form field that simply was not sent into a silent charge nobody
 * agreed to. Spending a credit is a decision, so it only ever happens when the
 * caller names `kiri` outright.
 *
 * An unrecognised value falls here rather than erroring, matching the dispatch
 * route: the caller asked for a reconstruction, and refusing one over a typo
 * would serve nobody — least of all when the video is already on disk.
 */
const DEFAULT_TARGET: ReconTarget = "studio-batch";

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

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

  // Read BEFORE anything is written, so a bad value is settled while this is
  // still only a form. Validated rather than trusted — see DEFAULT_TARGET.
  const asked = form.get("target");
  const requested: ReconTarget = isReconTarget(asked) ? asked : DEFAULT_TARGET;

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

  /*
    Safe on disk. Only now is anything allowed to fail.

    The order is not an implementation detail and must not be tidied into a
    "send it while we have it in memory" — everything below can go wrong (the
    studio may be down, KIRI may reject a 300 MB upload halfway through), and if
    any of that happened before the write, the recording would only be as
    reliable as the least reliable thing we do with it.

    `dispatch` never throws. A failure comes back as an outcome with a sentence
    attached, and the clip is still sitting in .uploads for
    /api/splat/jobs/[jobId]/dispatch to try again with.

    The `.catch` is not distrust of that contract, it is the one place where
    trusting it would cost the recording. An unhandled rejection here becomes a
    500 with no body, so the caller never learns the job id — and the clip then
    sits on disk addressable by nothing, which is exactly the orphan state
    lib/splatJobs.ts's hydrate() had to be written to clean up after. Three
    lines to guarantee the id always comes back is the right price.
  */
  const outcome = await dispatch({
    requested,
    filePath: dest,
    filename: path.basename(dest),
    // So a KIRI submission can be collected later rather than being write-only.
    jobId: job.id,
  }).catch((err: unknown) => {
    console.error("[splat] dispatch threw:", err);
    return null;
  });

  /*
    Shaped like an outcome so the panel has one thing to read. Built by hand
    rather than typed as `DispatchOutcome` on purpose: this is the branch where
    that module misbehaved, and a literal that has to be kept in step with its
    interface would be a compile error the next time the interface grows a
    field — for a case that is already the unexpected one.
  */
  const reconstruction = outcome ?? {
    requested,
    target: null,
    ok: false,
    degraded: false,
    external: null,
    terminal: false,
    note: "The clip is saved, but the dispatcher failed outright. Pick a destination and send it again.",
  };

  /*
    202 either way, and `reconstruction` carries the other half of the story.

    "Accepted" is a true statement about the upload, which is what this status
    code is answering: the video arrived and the job is real. Whether anything
    is currently working on it is a fact about the world — a studio that is not
    running is not a fault in this request — and a 5xx here would tell the panel
    that the clip did not land, which is precisely the thing that never happened.

    `next` and `note` used to describe a python invocation and a manual copy into
    public/mock/splats. Both were true of the repo and neither was ever surfaced
    anywhere in the UI, so the only reader of those strings was a developer with
    a network tab open — while the person waiting on the actual clip was told
    "the reconstruction runs on the GPU box" by an endpoint that had contacted no
    GPU box. They now say what happened and what can still be done about it.
  */
  return NextResponse.json(
    {
      job,
      savedAs: path.relative(process.cwd(), dest),
      persisted: true,
      reconstruction,
      next: reconstruction.ok
        ? [
            `GET /api/splat/jobs/${job.id} — flips to ready when the .ply lands`,
          ]
        : [
            `POST /api/splat/jobs/${job.id}/dispatch — the clip is still here; pick a destination and send it again`,
          ],
      // The server already phrased this for a person; the UI repeats it rather
      // than inventing its own. On a failure the reassurance is appended, the
      // same way the handoff upload route does it, because "it went nowhere" and
      // "it is gone" are the two things a reader will otherwise conflate.
      note: reconstruction.ok
        ? reconstruction.note
        : `${reconstruction.note} (Saved as ${path.basename(dest)}.)`,
    },
    { status: 202, headers: NO_STORE },
  );
}

export function GET() {
  return NextResponse.json({ jobs: listSplatJobs() }, { status: 200, headers: NO_STORE });
}
