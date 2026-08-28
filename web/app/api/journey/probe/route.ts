/**
 * POST /api/journey/probe — read the facts off clips that are already here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS WHEN THE BROWSER ALREADY READS THE SAME TAGS
 *
 * A journey is built from `ClipFacts` — when each clip was filmed, where, how
 * long, on what. There are two readers of those tags and they are not equally
 * good.
 *
 * lib/journey/clientMetadata.ts parses the container IN THE TAB, off a few
 * kilobytes of `File.slice()`. That is the only option on the laptop drop path,
 * where the video deliberately never leaves the browser, and giving up that
 * privacy property to learn a timestamp would be a terrible trade.
 *
 * But clips that came off the phone through the capture handoff are ALREADY ON
 * THIS DISK, sitting in `.uploads` under a splat job id. For those, the trade
 * does not exist: the file is here, ffmpeg is here, and ffmpeg has read the
 * whole header rather than the first few kilobytes of it — it finds
 * `com.apple.quicktime.creationdate` with its UTC offset intact, the ISO 6709
 * location string, the altitude off the same fix, and the container duration,
 * on files where a partial-range parse in a tab finds nothing at all.
 *
 * So this endpoint is: "here are some job ids you already gave me — tell me
 * what their files say". `clipFactsFromFile` fills the SAME `ClipFacts` the
 * browser reader fills, which is the entire point of that type living in
 * lib/journey/clips.ts rather than beside either reader. A journey mixing
 * phone clips and dropped clips has to produce one route, not two that
 * disagree about the same afternoon.
 *
 * Each returned `ClipFacts.id` IS the job id, so the client can turn round and
 * address it in a correction (`{ kind: "order", clipId }`) and hand the same id
 * back as `splatJobId` when it POSTs the journey.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ABSENT IS A NORMAL ANSWER
 *
 * A job id with no file behind it comes back in `missing`, not as an error and
 * not as an empty `ClipFacts`. Those are different facts: "we never had this
 * clip" and "we have it and it told us nothing" want different sentences on
 * screen, and collapsing them would let a probe of six ids that found zero
 * files render as six clips with no metadata.
 *
 * A file that IS here but has had its metadata stripped — which every ordinary
 * messaging-app round trip does — comes back as a real entry in `clips` with
 * nulls in it. That is `emptyFacts`, and it is the honest answer, not a failure.
 */
import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";

import { findUploadFor, getSplatJob } from "@/lib/splatJobs";
import { clipFactsFromFile } from "@/lib/video/probeMetadata";
import type { ClipFacts } from "@/lib/journey/clips";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Every id in this list spawns an ffmpeg process. An unbounded array is
 * therefore a one-line way to fork-bomb the box from a text field, which is a
 * much cheaper attack than it looks. Fifty matches the clip cap on
 * POST /api/journey, so the two endpoints agree about how big a journey is.
 */
const MAX_JOB_IDS = 50;

/**
 * How many probes run at once.
 *
 * Four. Not one, and not fifty.
 *
 * Strictly serial would be wrong: each probe is dominated by process spawn and
 * a header read, so the CPU sits idle through most of it and fifty clips would
 * take fifty round trips for no reason. All at once would be worse: fifty
 * concurrent ffmpeg processes on a dev laptop is fifty process spawns, fifty
 * file handles and fifty 20-second timeouts competing, and the thing they are
 * competing for is the same machine serving the page that asked.
 *
 * Four keeps enough in flight to hide the spawn latency while staying under the
 * core count of the smallest machine this runs on. The number is a comfort
 * limit, not a measurement — if it is ever tuned, tune it against a real pile.
 */
const PROBE_CONCURRENCY = 4;

/**
 * A job id, and nothing that could be a path.
 *
 * WHAT `findUploadFor` ACTUALLY DOES, since this decides whether the whitelist
 * below is redundant: it does NOT join the caller's id onto a directory. It
 * `readdirSync`s `.uploads` and looks for an entry that `startsWith(`${jobId}.`)`,
 * then joins the directory onto the ENTRY NAME it found. A traversal payload
 * would have to be a real filename in that directory, and a filename cannot
 * contain a path separator — so `../../etc/passwd` matches nothing and escapes
 * nowhere. The path built is always a direct child of `.uploads`.
 *
 * So `findUploadFor` is not traversable, and this whitelist is defence in
 * depth rather than a patch. It is here anyway for two reasons: the same shape
 * of check guards `SPLAT_DIR` in app/splat/[jobId]/page.tsx, where the id IS
 * joined onto a directory and the check is load-bearing, and a bare `""` or a
 * lone `"."` would otherwise sail into `readdirSync` and prefix-match real
 * files. Cheap, and it means a future refactor of `findUploadFor` into a
 * `path.join` cannot quietly open a hole here.
 *
 * The stronger gate is the `getSplatJob` check below, which `findUploadFor`'s
 * own comment asks callers to make: the job record is the only proof this id
 * was ever minted on this server, and checking it keeps an unknown id from
 * reaching `readdirSync` at all.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const raw = body.jobIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      { error: "jobIds must be a non-empty array of splat job ids" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (raw.length > MAX_JOB_IDS) {
    return NextResponse.json(
      {
        error: `too many jobIds: ${raw.length} sent, ${MAX_JOB_IDS} is the cap — each one spawns an ffmpeg probe`,
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const bad = raw.findIndex((id) => typeof id !== "string" || !SAFE_ID.test(id));
  if (bad !== -1) {
    return NextResponse.json(
      {
        error: `jobIds[${bad}] is not a job id — expected 1–120 characters of A–Z a–z 0–9 _ -`,
      },
      { status: 400, headers: NO_STORE },
    );
  }

  // Deduped, first occurrence winning. Two reasons, and the second is the one
  // that matters: a repeat would probe the same file twice for the same bytes,
  // and it would come back as two `ClipFacts` sharing an id — which is exactly
  // the ambiguity POST /api/journey rejects, since a correction addressing that
  // id could not say which clip it meant.
  const jobIds = [...new Set(raw as string[])];

  const results = await mapWithLimit(jobIds, PROBE_CONCURRENCY, probeOne);

  const clips: ClipFacts[] = [];
  const missing: string[] = [];
  for (const result of results) {
    if (result.facts) clips.push(result.facts);
    else missing.push(result.id);
  }

  return NextResponse.json(
    {
      clips,
      missing,
      note:
        `Read with ffmpeg off files already on this server. ` +
        `${clips.length} of ${jobIds.length} ids had a clip behind them` +
        (missing.length > 0
          ? `; the other ${missing.length} named no upload this server has — either never uploaded, or deleted since.`
          : `.`) +
        " Null fields mean the container did not say, which is the ordinary case — nothing here is guessed.",
    },
    { status: 200, headers: NO_STORE },
  );
}

interface ProbeResult {
  id: string;
  /** Null when there is no file to read — see `missing` in the header. */
  facts: ClipFacts | null;
}

async function probeOne(id: string): Promise<ProbeResult> {
  // The gate findUploadFor's own comment asks for: the job record is the proof
  // this id was minted here. An id nobody ever uploaded against is `missing`
  // rather than an error — the client is asking a question, not making a claim.
  if (!getSplatJob(id)) return { id, facts: null };

  const found = findUploadFor(id);
  if (!found) return { id, facts: null };

  // The size is the filesystem's, not the caller's. `clipFactsFromFile` takes
  // `bytes` from its caller because a route that found the upload already has
  // it in hand — and here that means one `stat`, on a path we resolved.
  let bytes: number;
  try {
    bytes = (await stat(found.path)).size;
  } catch {
    // Deleted between the readdir and here. It is not a 500; it is a clip we
    // do not have, which is what `missing` is for.
    return { id, facts: null };
  }

  // `id` is the JOB id on purpose: it is how the client addresses this clip in
  // a correction and how it names the reconstruction when it posts the journey.
  // `name` is the stored filename, which is what the person will recognise.
  // Never throws — no ffmpeg, an unreadable container and a stripped metadata
  // block all land on `emptyFacts` plus whatever the filesystem still knows.
  const facts = await clipFactsFromFile(found.path, { id, name: found.filename, bytes });
  return { id, facts };
}

/**
 * `Promise.all` with a ceiling.
 *
 * A fixed pool of workers pulling from a shared cursor, rather than slicing the
 * list into batches: batching runs at the speed of the slowest member of each
 * batch, and one clip that hits the 20-second probe timeout would stall three
 * healthy ones behind it. A worker that finishes takes the next id immediately.
 *
 * Results land at the caller's index, so the output order is the input order no
 * matter which worker got there first.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
