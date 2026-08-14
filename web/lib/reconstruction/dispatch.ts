/**
 * Send a stored clip somewhere to be reconstructed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE POINT: STORE FIRST, DISPATCH SECOND, ALWAYS.
 *
 * Everything this module can do is allowed to fail. The studio may not be
 * running. KIRI may be out of credits, may reject the video, may time out
 * halfway through a 300 MB upload. If any of that could lose the recording,
 * then the recording is only as reliable as the least reliable thing we do with
 * it — and someone who just walked around a building for three minutes cannot
 * be asked to do it again because a cloud API returned a 500 with `"ok": true`.
 *
 * So the caller writes the file to disk and only then calls this, and this
 * NEVER throws: a failed dispatch is a normal outcome with a sentence attached,
 * and the clip is still there to try again with.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { noteCreditSpent, withKiriKey } from "./keys";
import { noteKiriSubmission } from "../splatJobs";
import { preflightForKiri, type ClipPreflight } from "../video/preflight";
import { ensureBrowserPlayable } from "../video/remux";
import { serializeOf, submitVideo } from "./kiri";
import {
  describeTargets,
  fallbackFor,
  probeStudio,
  type ReconTarget,
} from "./targets";
import { hasKiriKey, kiriCredits } from "./keys";

export interface DispatchOutcome {
  /** What the user asked for. */
  requested: ReconTarget;
  /** Where it actually went. Null means nowhere — the clip is stored and idle. */
  target: ReconTarget | null;
  ok: boolean;
  /** True when we sent it somewhere other than what was asked. */
  degraded: boolean;
  /** KIRI's own handle, when it accepted the job. */
  external: string | null;
  /** Whether a retry could ever succeed. See kiri.ts's terminal codes. */
  terminal: boolean;
  note: string;
  /**
   * What was measured off the clip before it was sent, when it was going to
   * KIRI. Absent for every other destination — these are KIRI's limits, not
   * facts about video in general, and a studio dispatch is not judged by them.
   */
  preflight?: ClipPreflight;
}

export async function dispatch(input: {
  requested: ReconTarget;
  filePath: string;
  filename: string;
  /**
   * The job these bytes belong to. Optional only so older callers still
   * compile; without it a KIRI submission cannot be collected later, because
   * nothing records the handle KIRI hands back. See lib/reconstruction/collect.ts.
   */
  jobId?: string;
}): Promise<DispatchOutcome> {
  const { requested, filePath, filename, jobId } = input;

  const options = describeTargets({
    studio: await probeStudio(),
    hasKiriKey: hasKiriKey(),
    kiriCredits: kiriCredits(),
  });

  const target = fallbackFor(requested, options);
  const degraded = target !== null && target !== requested;

  if (target === null) {
    const why = options.find((o) => o.id === requested)?.blockedBecause;
    return {
      requested,
      target: null,
      ok: false,
      degraded: false,
      external: null,
      terminal: false,
      note:
        `${why ?? "That destination is not reachable."} ` +
        "The clip is saved — pick a destination once one is available.",
    };
  }

  if (target === "kiri") {
    return dispatchToKiri({ requested, degraded, filePath, filename, jobId });
  }

  // The browser target has nothing for the server to do, and saying otherwise
  // would be a lie the UI then repeats. The machine that trains is the one
  // holding the tab; this side's whole job was to store the clip so that
  // machine can read it back through /api/splat/jobs/[jobId]/video.
  //
  // Unreachable in practice, and kept as a backstop rather than deleted. This
  // call site passes no `gpu`, so `describeTargets` already refuses the browser
  // option here — and `BROWSER_TRAINER_AVAILABLE` refuses it everywhere else
  // until the WASM trainer is vendored. If some future path does arrive here,
  // the note must not promise training that nothing will perform: what actually
  // happened is that the clip was stored, so that is what it says.
  if (target === "browser") {
    return {
      requested,
      target,
      ok: true,
      degraded,
      external: null,
      terminal: false,
      note: "Saved. Nothing is training yet — pick the studio or KIRI to reconstruct it.",
    };
  }

  // The studio paths do not push: the clip is on disk under .uploads and the
  // job is registered, which is exactly what the studio's own pipeline and the
  // manual dev path both consume. `getSplatJob` derives readiness from the
  // finished .ply appearing, so nothing here has to be told when it lands.
  return {
    requested,
    target,
    ok: true,
    degraded,
    external: null,
    terminal: false,
    note:
      target === "studio-live"
        ? "Streaming to the studio on your laptop — the splat builds as it goes."
        : "Queued for the studio on your laptop.",
  };
}

async function dispatchToKiri(input: {
  requested: ReconTarget;
  degraded: boolean;
  filePath: string;
  filename: string;
  /** Which job to record KIRI's handle against, so it can be collected later. */
  jobId?: string;
}): Promise<DispatchOutcome> {
  const { requested, degraded, filePath, filename, jobId } = input;

  /*
    ─────────────────────────────────────────────────────────────────────────
    PRE-FLIGHT. THE LAST MOMENT AT WHICH THIS IS STILL FREE.

    Everything below this block costs a credit the instant KIRI accepts the
    upload, and KIRI's limits are enforced on their side AFTER the whole file
    has crossed the network. A clip four seconds over the cap therefore used to
    cost one of ten unrepeatable credits, several minutes of upload, and a
    rejection message that arrived long after the person had put their phone
    away. Duration and frame size are readable here in about a second.

    Only `refuse` stops anything, and `refuse` only ever fires on the two limits
    KIRI documents in prose — see lib/video/clipLimits.ts. A clip that is merely
    unusual, or that could not be measured at all because this machine has no
    ffmpeg, goes exactly as it would have before. The verdict is carried on the
    outcome either way so the UI can repeat it rather than invent one.

    The clip is untouched by all of this. It was stored before dispatch was ever
    called, it is still on disk after a refusal, and /api/splat/jobs/[jobId]/
    dispatch can send it to the studio instead — which has no such limits.
    ─────────────────────────────────────────────────────────────────────────
  */
  const preflight = await preflightForKiri(filePath);

  // Carried on EVERY outcome from here down, refusal and success alike: what we
  // measured is the same either way, and an outcome that reports it only when
  // it stopped something is one the UI cannot use to explain what it did send.
  const base = {
    requested,
    target: "kiri" as const,
    degraded,
    preflight,
  };

  if (preflight.verdict === "refuse") {
    return {
      ...base,
      ok: false,
      external: null,
      // Terminal in exactly the sense kiri.ts means it: no other key and no
      // amount of waiting changes a clip's length. Retrying this one spends a
      // second credit to hear the same sentence.
      terminal: true,
      note:
        `${preflight.reason} Nothing was sent and no credit was spent — the clip is ` +
        `saved, and the studio on your laptop has no such limit.`,
    };
  }

  /*
    Send the MP4, not whatever the phone happened to record.

    This used to read the original file and hand it over as
    `new Blob([...], { type: "video/mp4" })` with the source filename — so an
    iPhone capture went to KIRI as a QuickTime stream, labelled `video/mp4`,
    under a `.mov` name. Three descriptions of the same bytes, two of them
    wrong. That is a poor thing to be uncertain about on a call that spends a
    credit and cannot be undone.

    `ensureBrowserPlayable` already produced a faststart MP4 for the detector to
    read, so this is almost always a cache hit — and where it is not, a lossless
    `-c copy` is a second and a half. If the remux fails it falls back to the
    original, and the content type below is derived from whatever we actually
    ended up with rather than asserted.
  */
  const playable = await ensureBrowserPlayable(filePath);
  const sendPath = playable.servePath;
  const sendExt = path.extname(sendPath).toLowerCase();
  const sendName = playable.converted
    ? `${path.basename(filename, path.extname(filename))}.mp4`
    : filename;
  const sendType = sendExt === ".mov" ? "video/quicktime" : sendExt === ".webm" ? "video/webm" : "video/mp4";

  let bytes: Buffer;
  try {
    bytes = await readFile(sendPath);
  } catch {
    return {
      ...base,
      ok: false,
      external: null,
      terminal: false,
      note: "The clip was saved but could not be read back to send. Try again.",
    };
  }

  const result = await withKiriKey((key) =>
    // A Blob view over the buffer we already have: KIRI wants multipart, and
    // streaming it would mean holding the request open on our side for the same
    // duration anyway.
    submitVideo(key, new Blob([new Uint8Array(bytes)], { type: sendType }), sendName),
  );

  if (!result) {
    return {
      ...base,
      ok: false,
      external: null,
      terminal: false,
      note: "No KIRI key is set. The clip is saved — add a key on the laptop and send it then.",
    };
  }

  if (!result.ok) {
    return {
      ...base,
      ok: false,
      external: null,
      terminal: result.terminal,
      note: result.terminal
        ? `${result.message} Every account would reject this clip, so there is nothing to retry — but it is still saved.`
        : `${result.message} The clip is saved and can be sent again.`,
    };
  }

  // A credit is gone the moment KIRI accepts, whatever happens next. Counting it
  // here keeps the UI from offering a route that will now fail.
  noteCreditSpent();

  // Record the handle against the job IMMEDIATELY. From here the credit is
  // already spent, so losing this string means paying for a reconstruction
  // nobody can ever download.
  const serialize = serializeOf(result.data);
  if (jobId && serialize) noteKiriSubmission(jobId, serialize);

  return {
    ...base,
    ok: true,
    external: serialize,
    terminal: false,
    // A warning is said out loud even though it changed nothing, because the
    // clip that gets rejected in four minutes' time is usually the one this
    // sentence was about — and having been told beforehand is the difference
    // between a puzzling failure and an understood one.
    note:
      preflight.verdict === "warn" || preflight.verdict === "unknown"
        ? `Sent to KIRI. ${preflight.reason} Reconstruction takes a few minutes.`
        : "Sent to KIRI. Reconstruction takes a few minutes.",
  };
}
