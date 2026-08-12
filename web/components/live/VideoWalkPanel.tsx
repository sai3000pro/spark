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
import { SaveToAlbum } from "@/components/album/SaveToAlbum";
import { PhoneHandoffPanel } from "@/components/live/PhoneHandoffPanel";
import { DETECTOR_MODELS, formatBytes, type ProgressInfo } from "@/lib/detector";
import { WHISPER_APPROX_MB } from "@/lib/audio/transcribe";
import { buildWalkFromVideo, type BuiltWalk, type WalkPhase } from "@/lib/video/buildWalk";

type Phase = "idle" | WalkPhase | "done" | "error";

interface Found extends BuiltWalk {
  splatJobId: string | null;
}

export function VideoWalkPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [modelId, setModelId] = useState(DETECTOR_MODELS[0].id);
  const [reconstruct, setReconstruct] = useState(false);
  const [transcribe, setTranscribe] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [step, setStep] = useState({ done: 0, total: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  const run = useCallback(
    async (video: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setFound(null);
      setFile(video);

      try {
        // The reconstruction leaves FIRST, if asked, so the long errand gets a
        // head start while the detector is still downloading. A reconstruction
        // that fails must never cost you the walk.
        let splatJobId: string | null = null;
        if (reconstruct) {
          const form = new FormData();
          form.append("video", video);
          const res = await fetch("/api/splat/jobs", { method: "POST", body: form });
          if (res.ok) {
            splatJobId = ((await res.json()) as { job?: { id?: string } }).job?.id ?? null;
          } else {
            console.warn("[upload] splat job failed to open:", await res.text());
          }
        }

        // The funnel itself is lib/video/buildWalk.ts, because a clip arriving
        // from the phone has to go through exactly the same one — otherwise the
        // two paths give different answers for the same footage and nobody can
        // say which is right. See components/live/CapturedWalk.tsx.
        const built = await buildWalkFromVideo({
          video,
          modelId,
          splatJobId,
          transcribe,
          signal: controller.signal,
          onProgress: (p) => {
            setPhase(p.phase);
            if (p.download !== undefined) setProgress(p.download);
            if (p.step) setStep(p.step);
          },
        });

        setFound({ ...built, splatJobId });
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
    [modelId, reconstruct, transcribe],
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

        <label
          className={`fnote flex w-full cursor-pointer items-center gap-2 text-[10px] ${
            transcribe ? "text-lagoon" : "text-ink-faint"
          }`}
          title="Whisper runs in this tab, like the detector. The audio never leaves the machine."
        >
          <input
            type="checkbox"
            checked={transcribe}
            disabled={busy}
            onChange={(e) => setTranscribe(e.target.checked)}
            className="accent-lagoon"
          />
          [ listen too · unlocks the speech and laughter triggers · +{WHISPER_APPROX_MB}MB, stays
          in this tab ]
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

            {/* The footage is usually on the phone that shot it, and getting it
                onto a laptop first is AirDrop, a cable, or a cloud round trip —
                all of which are longer than pointing a camera at a square. The
                same handoff as section 02, but the phone lands on its video
                picker instead of a recorder. */}
            <div className="mt-4 border-t border-ink/10 pt-4">
              <p className="fnote mb-2 text-[9.5px] text-ink-faint">
                [ the video is on your phone? ]
              </p>
              <div className="mx-auto max-w-xs">
                <PhoneHandoffPanel intent="upload" label="Send one from my phone" />
              </div>
            </div>
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

          {/* The same filing step the phone path gets, for the same reason: a
              walk on its own is a file, a walk in an album is a collection. */}
          {found.moments > 0 && <SaveToAlbum journeyId={found.tripId} />}

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
