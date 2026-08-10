"use client";

/**
 * Drop a video in, get a walk out.
 *
 * The whole product claim, run against footage you brought: sample the frames,
 * detect what is in them, link the boxes into tracks, and push the result
 * through the SAME `scoreCandidates` the authored walks use. Whatever survives
 * is a moment. Nothing about the finding is staged.
 *
 * Two independent errands leave this component, on purpose:
 *
 *   the walk     found here in the browser, posted to /api/upload/walk as
 *                detections, back in seconds, openable immediately.
 *   the splat    the video itself posted to /api/splat/jobs, reconstructed on a
 *                GPU box, back in minutes. The walk does not wait for it; every
 *                moment simply reads `processing` until it lands.
 *
 * The frames never leave the tab. The video does, and only if reconstruction is
 * asked for — the checkbox says so, and it is off by default.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DETECTOR_MODELS,
  formatBytes,
  loadDetector,
  type ProgressInfo,
} from "@/lib/detector";
import { probeVideo, sampleFrames } from "@/lib/video/sampleFrames";
import { trackDetections, type FrameDetections } from "@/lib/video/trackFrames";

type Phase =
  | "idle"
  | "loading-model"
  | "sampling"
  | "detecting"
  | "building"
  | "done"
  | "error";

interface Found {
  tripId: string;
  href: string;
  detections: number;
  candidates: number;
  discarded: number;
  moments: number;
  splatJobId: string | null;
}

/** Detector confidence floor. Below this a frame is mostly furniture hallucination. */
const THRESHOLD = 0.5;

export function VideoWalkPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [modelId, setModelId] = useState(DETECTOR_MODELS[0].id);
  const [reconstruct, setReconstruct] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [step, setStep] = useState({ done: 0, total: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy =
    phase === "loading-model" || phase === "sampling" || phase === "detecting" || phase === "building";

  const run = useCallback(
    async (video: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setFound(null);
      setFile(video);

      try {
        const info = await probeVideo(video);
        if (info.durationSec < 4) {
          throw new Error(
            `that clip is ${info.durationSec.toFixed(1)}s — too short for the scorer's ${8}s window to see anything`,
          );
        }

        // 1 · the model. Cached at module scope, so a second video is instant.
        setPhase("loading-model");
        const detector = await loadDetector(modelId, setProgress);

        // 2 · the frames. Sampled by seeking, so a 4-minute clip does not take
        //     4 minutes.
        setPhase("sampling");
        const { frames } = await sampleFrames(video, {
          signal: controller.signal,
          onFrame: (done, total) => setStep({ done, total }),
        });

        // 3 · the detector, frame by frame. This is the slow part and the only
        //     part that is actually doing perception.
        setPhase("detecting");
        const perFrame: FrameDetections[] = [];
        for (let i = 0; i < frames.length; i++) {
          if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
          // One pass per frame — the video already gives the detector many looks
          // at each object, so the still-frame TTA presets would only slow it.
          const run = await detector.detect(frames[i].dataUrl, {
            threshold: THRESHOLD,
            quality: "fast",
          });
          perFrame.push({ t: frames[i].t, frameId: frames[i].frameId, raw: run.detections });
          setStep({ done: i + 1, total: frames.length });
        }

        // 4 · link boxes into tracks, so a person standing still is one sighting
        //     rather than ninety.
        const detections = trackDetections(perFrame, { tripId: "trip_upload_pending" });
        if (!detections.length) {
          throw new Error(
            "the detector found nothing above 50% in any frame — try footage with people or objects clearly in shot",
          );
        }

        // 5 · hand the video over for reconstruction, if asked. Started BEFORE
        //     the walk post so the long errand gets a head start.
        let splatJobId: string | null = null;
        if (reconstruct) {
          const form = new FormData();
          form.append("video", video);
          const res = await fetch("/api/splat/jobs", { method: "POST", body: form });
          if (res.ok) {
            splatJobId = (await res.json()).job?.id ?? null;
          } else {
            // A failed reconstruction must not cost you the walk.
            console.warn("[upload] splat job failed to open:", await res.text());
          }
        }

        // 6 · the pipeline, on the server, on real detections.
        setPhase("building");
        const res = await fetch("/api/upload/walk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detections,
            durationSec: info.durationSec,
            sourceName: video.name,
            splatJobId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `the walk could not be built (${res.status})`);
        }
        const built = await res.json();

        setFound({
          tripId: built.tripId,
          href: built.href,
          detections: built.found.detections,
          candidates: built.found.candidates,
          discarded: built.found.discarded,
          moments: built.found.moments,
          splatJobId,
        });
        setPhase("done");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setPhase("idle");
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      } finally {
        abortRef.current = null;
      }
    },
    [modelId, reconstruct],
  );

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError(`that is ${f.type || "not a video"} — drop a video file`);
      setPhase("error");
      return;
    }
    void run(f);
  };

  return (
    <section className="plate-vellum rise-in relative p-5 sm:p-6" style={{ "--i": 3 } as React.CSSProperties}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="fnote text-[10px] text-ink-faint">[ 03 ]</span>
          <h2 className="mt-1 text-[20px] leading-tight text-ink">Or bring your own footage</h2>
          <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
            A video has a real timeline, so the scorer can do real work on it. The frames are read
            and detected in this tab — the file itself is only sent if you ask for a reconstruction.
          </p>
        </div>
        <span className="fnote chip chip-live text-[10px]">[ real pipeline ]</span>
      </header>

      {/* ── Options ────────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {DETECTOR_MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy}
            onClick={() => setModelId(m.id)}
            title={m.note}
            className={`pill-ghost px-3 py-1.5 text-[12.5px] disabled:opacity-50 ${
              modelId === m.id ? "bg-brass/20 text-ink" : "text-ink-soft"
            }`}
          >
            {m.label}
            <span className="fnote text-[9px] text-ink-faint">[ ~{m.approxMb}MB ]</span>
          </button>
        ))}

        <label
          className={`fnote ml-auto flex cursor-pointer items-center gap-2 text-[10px] ${
            reconstruct ? "text-clay" : "text-ink-faint"
          }`}
          title="Sends the video to /api/splat/jobs. Reconstruction runs on the GPU box, not here."
        >
          <input
            type="checkbox"
            checked={reconstruct}
            disabled={busy}
            onChange={(e) => setReconstruct(e.target.checked)}
            className="accent-clay"
          />
          [ also reconstruct a splat · uploads the video ]
        </label>
      </div>

      {/* ── The drop target ────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) onFile(e.dataTransfer.files[0]);
        }}
        className="mt-4 rounded-[6px] p-6 text-center"
        style={{ boxShadow: "inset 0 0 0 1.5px rgb(120 120 108 / 0.35)" }}
      >
        {phase === "idle" || phase === "error" ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pill-brass px-4 py-2 text-[13px]"
            >
              Choose a video
            </button>
            <p className="fnote mt-2.5 text-[9.5px] text-ink-faint">
              [ or drag one in · mp4, mov, webm ]
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </>
        ) : (
          <Working
            phase={phase}
            step={step}
            progress={progress}
            fileName={file?.name}
            onCancel={() => abortRef.current?.abort()}
          />
        )}
      </div>

      {error && (
        <p className="fnote mt-3 text-[10px] text-clay">[ {error} ]</p>
      )}

      {/* ── What it found ──────────────────────────────────────────────────── */}
      {found && phase === "done" && (
        <div className="mt-4 rounded-[6px] bg-milk p-4" style={{ boxShadow: "var(--ring-ink)" }}>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
            <Stat n={found.detections} label="detections" />
            <Stat n={found.candidates} label="candidates" />
            <Stat n={found.discarded} label="discarded" tone="faint" />
            <Stat n={found.moments} label="moments kept" tone="strong" />
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
            {found.moments > 0 ? (
              <>
                The scorer kept {found.moments} {found.moments === 1 ? "window" : "windows"} out of{" "}
                {found.candidates}. Where they sit on the map comes from camera motion measured in
                the footage — how far the boxes travel between frames. The distance is a monocular
                estimate and the direction is not estimated at all, so read the line as
                distance-travelled, not as a shape.
              </>
            ) : (
              <>
                Nothing cleared the keep line. That is a real answer, not a failure: with no audio
                pass the speech triggers cannot fire at all, so a clip has to earn it on novelty,
                faces and dwell alone. Try footage where people stay in shot for a while, or where
                new things come into frame.
              </>
            )}
          </p>

          {found.splatJobId && (
            <p className="fnote mt-2 text-[9.5px] text-lagoon">
              [ reconstruction queued · {found.splatJobId} · drop the result at
              public/mock/splats/{found.splatJobId}.ply ]
            </p>
          )}

          {found.moments > 0 && (
            <button
              type="button"
              onClick={() => router.push(found.href)}
              className="pill-brass mt-4 px-4 py-2 text-[13px]"
            >
              Open the walk <span aria-hidden>→</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Working({
  phase,
  step,
  progress,
  fileName,
  onCancel,
}: {
  phase: Phase;
  step: { done: number; total: number };
  progress: ProgressInfo | null;
  fileName?: string;
  onCancel: () => void;
}) {
  const pct = step.total ? Math.round((100 * step.done) / step.total) : 0;

  const line =
    phase === "loading-model"
      ? progress?.file
        ? `downloading ${progress.file} · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
        : "loading the detector"
      : phase === "sampling"
        ? `reading frames · ${step.done}/${step.total}`
        : phase === "detecting"
          ? `detecting · frame ${step.done} of ${step.total}`
          : "scoring the windows";

  return (
    <div className="mx-auto max-w-md">
      <p className="fnote text-[10px] text-ink-soft">[ {line} ]</p>
      {fileName && <p className="tag mt-1 truncate text-[12px] text-ink-faint">{fileName}</p>}

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-clay transition-[width] duration-200"
          style={{ width: `${phase === "building" ? 100 : pct}%` }}
        />
      </div>

      {(phase === "sampling" || phase === "detecting") && (
        <button
          type="button"
          onClick={onCancel}
          className="fnote mt-3 text-[9.5px] text-ink-faint underline-offset-4 hover:text-ink hover:underline"
        >
          [ cancel ]
        </button>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "faint" | "strong" }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={`tnum text-[19px] leading-none ${
          tone === "strong" ? "text-clay" : tone === "faint" ? "text-ink-faint" : "text-ink"
        }`}
      >
        {n.toLocaleString()}
      </span>
      <span className="fnote text-[9.5px] text-ink-faint">{label}</span>
    </span>
  );
}
