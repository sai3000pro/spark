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

import { noteCreditSpent, withKiriKey } from "./keys";
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
}

export async function dispatch(input: {
  requested: ReconTarget;
  filePath: string;
  filename: string;
}): Promise<DispatchOutcome> {
  const { requested, filePath, filename } = input;

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

  if (target === "kiri") return dispatchToKiri({ requested, degraded, filePath, filename });

  // The browser target has nothing for the server to do, and saying otherwise
  // would be a lie the UI then repeats. The machine that trains is the one
  // holding the tab; this side's whole job was to store the clip so that
  // machine can read it back through /api/splat/jobs/[jobId]/video.
  if (target === "browser") {
    return {
      requested,
      target,
      ok: true,
      degraded,
      external: null,
      terminal: false,
      note: "Saved. Reconstruction runs in your browser — keep the tab open.",
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
}): Promise<DispatchOutcome> {
  const { requested, degraded, filePath, filename } = input;

  const base = {
    requested,
    target: "kiri" as const,
    degraded,
  };

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
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
    submitVideo(key, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), filename),
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

  return {
    ...base,
    ok: true,
    external: serializeOf(result.data),
    terminal: false,
    note: "Sent to KIRI. Reconstruction takes a few minutes.",
  };
}
