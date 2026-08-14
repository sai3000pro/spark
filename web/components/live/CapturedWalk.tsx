"use client";

/**
 * The clip arrived from the phone. Turn it into a walk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STEP THAT WAS MISSING
 *
 * Everything up to here worked: scan the QR, record with coverage guidance,
 * pick a destination, and the video lands on the laptop with a real job behind
 * it. And then nothing happened. The clip sat in `.uploads` and the flow simply
 * stopped — no detections, no moments, no album, nothing on the globe. A
 * capture that produces a file is not a memory.
 *
 * This is the join. It reads the stored clip back and runs it through
 * lib/video/buildWalk.ts, the SAME funnel a dropped file goes through, so
 * footage from the phone and footage from the laptop cannot disagree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT ASKS FIRST
 *
 * The detector is a ~77 MB download and then real work on every sampled frame.
 * Starting that unbidden on a laptop that just finished receiving a 200 MB
 * upload — possibly on battery, possibly while the phone is still streaming —
 * is the kind of helpfulness nobody asked for. The clip is already safe; the
 * moments can wait for a tap.
 *
 * The reconstruction is not waited for either. It left on its own errand at
 * upload time (lib/reconstruction/dispatch.ts) and lands minutes later; every
 * moment reads `processing` until it does. Same two-errand shape as
 * VideoWalkPanel, for the same reason.
 */
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SaveToAlbum } from "@/components/album/SaveToAlbum";
import { SetPlace } from "@/components/live/SetPlace";
import { ReconstructionWatch } from "@/components/live/ReconstructionWatch";
import { TryAnyway } from "@/components/live/TryAnyway";
import { DETECTOR_MODELS } from "@/lib/detector";
import { WHISPER_APPROX_MB } from "@/lib/audio/transcribe";
import {
  buildWalkFromVideo,
  describeProgress,
  type BuiltWalk,
  type WalkProgress,
} from "@/lib/video/buildWalk";

type State =
  | { k: "idle" }
  | { k: "fetching" }
  | { k: "working"; progress: WalkProgress }
  | { k: "done"; walk: BuiltWalk }
  | { k: "error"; message: string };

export function CapturedWalk({
  jobId,
  sourceName,
}: {
  jobId: string;
  sourceName: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ k: "idle" });
  // Same option the dropped-file panel offers, and off for the same reason: a
  // second model and a second pass over the clip. Offered here too because a
  // phone clip is the one most likely to have someone talking in it.
  const [transcribe, setTranscribe] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ k: "fetching" });

    try {
      // Read the clip back as a File so the funnel below cannot tell where it
      // came from — probeVideo and sampleFrames both want a real file object.
      const res = await fetch(`/api/splat/jobs/${jobId}/video`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "The clip is no longer on this machine."
            : `Could not read the clip back (${res.status}).`,
        );
      }
      const blob = await res.blob();
      const name = sourceName ?? `${jobId}.mp4`;
      const file = new File([blob], name, { type: blob.type || "video/mp4" });

      const walk = await buildWalkFromVideo({
        video: file,
        modelId: DETECTOR_MODELS[0].id,
        // The reconstruction opened at upload time — hand the walk its id so
        // the moments know what they are waiting for.
        splatJobId: jobId,
        transcribe,
        signal: controller.signal,
        onProgress: (progress) => setState({ k: "working", progress }),
      });

      setState({ k: "done", walk });
      // The library and the globe are server-rendered, and a new walk changes
      // both. Same refresh the live-trip poller does on a transition.
      router.refresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setState({ k: "idle" });
        return;
      }
      setState({ k: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      abortRef.current = null;
    }
  }, [jobId, sourceName, transcribe, router]);

  if (state.k === "done") {
    const { walk } = state;
    return (
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-[13px] leading-relaxed text-ink">
          {walk.moments > 0
            ? `${walk.moments} moment${walk.moments === 1 ? "" : "s"} worth keeping.`
            : "Nothing scored high enough to keep."}
        </p>
        <p className="fnote text-[10px] leading-relaxed text-ink-faint">
          [ {walk.detections.toLocaleString()} detections · {walk.candidates} candidates ·{" "}
          {walk.discarded} discarded ]
        </p>
        {/* The scorer's reason, not just the count. "1 discarded" is the one
            number that tells you nothing about what to do next; the sentence
            behind it separates "too short to reconstruct" from "scored under
            the bar", which want different footage and a different knob. */}
        {walk.discardReasons.map((r) => (
          <p key={r} className="fnote text-[9.5px] leading-relaxed text-ink-faint">
            [ why · {r} ]
          </p>
        ))}
        {walk.moments > 0 && (
          <Link
            href={walk.href}
            className="pill-brass self-start px-3 py-1.5 text-[12.5px]"
          >
            Open the walk
          </Link>
        )}
        {/* Only worth filing if something came of it. An empty walk in an album
            is a promise the album cannot keep. */}
        {walk.moments > 0 && <SaveToAlbum journeyId={walk.tripId} />}

        {/* The clip's own metadata is the better source and is often empty —
            location services off, or stripped in sharing. This is the fallback
            that is still true: somebody who was there, saying so. */}
        <SetPlace tripId={walk.tripId} />

        {/* The phone's clip already has a job, and the destination picker may
            have dispatched it at upload time — so watch it regardless of
            whether the button below is ever pressed. */}
        <ReconstructionWatch jobId={jobId} href={walk.href} />

        {/* The clip is already on this server — the phone wrote it to
            .uploads/<jobId> before the walk was ever built — so this sends
            bytes that are sitting here rather than asking for the video again.
            Offered whatever the scorer decided: a walk with no promoted moment
            is exactly the case where "no minute stood out" gets mistaken for
            "not worth reconstructing", and they are different claims. */}
        <TryAnyway
          resolveJobId={async () => jobId}
          prompt={
            walk.moments > 0
              ? "reconstruct this place too"
              : "the scorer kept nothing · build the place anyway"
          }
        />
      </div>
    );
  }

  if (state.k === "error") {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-[13px] leading-relaxed text-clay">{state.message}</p>
        <button
          type="button"
          onClick={() => void run()}
          className="fnote self-start rounded-[3px] border border-ink/20 px-2.5 py-1 text-[10px] text-ink-soft"
        >
          [ try again ]
        </button>
      </div>
    );
  }

  if (state.k === "fetching" || state.k === "working") {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <p className="fnote flex items-center gap-2 text-[10px] text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-lagoon" />
          [{" "}
          {state.k === "fetching"
            ? "reading the clip back"
            : describeProgress(state.progress).toLowerCase()}{" "}
          ]
        </p>
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          className="fnote self-start text-[10px] text-ink-faint underline underline-offset-2"
        >
          [ stop ]
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void run()}
        className="pill-brass self-start px-3 py-1.5 text-[12.5px]"
      >
        Find the moments
      </button>
      <label
        className={`fnote flex cursor-pointer items-center gap-2 text-[10px] ${
          transcribe ? "text-lagoon" : "text-ink-faint"
        }`}
        title="Whisper runs in this tab, like the detector. The audio never leaves the machine."
      >
        <input
          type="checkbox"
          checked={transcribe}
          onChange={(e) => setTranscribe(e.target.checked)}
          className="accent-lagoon"
        />
        [ listen too · unlocks the speech and laughter triggers · +{WHISPER_APPROX_MB}MB ]
      </label>
      <p className="fnote text-[10px] leading-relaxed text-ink-faint">
        [ runs the detector in this tab · the clip is already saved either way ]
      </p>
    </div>
  );
}
