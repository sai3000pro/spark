"use client";

/**
 * The detector bench.
 *
 * Its job is to prove the contract end-to-end: a real model runs on a real image,
 * its output is converted to the pipeline's `Detection[]`, and those go straight
 * into the SAME `scoreCandidates` the mock trip uses. If a candidate comes out the
 * other side, stage 1 → stage 2 works on live data.
 *
 * Doubles as the day-2 tuning tool: change TRIGGER_WEIGHTS, drop an image in,
 * see what fires.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip, ConfidenceBar, LabelDot, SectionHeading, StageTag } from "@/components/ui";
import {
  DETECTOR_MODELS,
  formatBytes,
  loadDetector,
  toDetections,
  type DetectorHandle,
  type ProgressInfo,
  type RawDetection,
} from "@/lib/detector";
import { colorForLabel } from "@/lib/mock/labels";
import { PIPELINE_CONFIG, promoteToMoment, scoreCandidates } from "@/lib/pipeline";
import { describeTrigger, LAYER_COLOR, TRIGGER_LAYER } from "@/lib/triggers";
import type { Detection, MomentCandidate } from "@/lib/types";

type Phase = "idle" | "loading" | "ready" | "running" | "error";

export function DetectorLab() {
  const [modelId, setModelId] = useState(DETECTOR_MODELS[0].id);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [handle, setHandle] = useState<DetectorHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [raw, setRaw] = useState<RawDetection[] | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs so repeated drops don't leak.
  useEffect(() => {
    return () => {
      if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const h = await loadDetector(modelId, setProgress);
      setHandle(h);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [modelId]);

  const run = useCallback(async () => {
    if (!handle || !imageUrl) return;
    setPhase("running");
    const started = performance.now();
    try {
      const out = await handle.detect(imageUrl, threshold);
      setRaw(out);
      setElapsedMs(Math.round(performance.now() - started));
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [handle, imageUrl, threshold]);

  const onFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setRaw(null);
    setElapsedMs(null);
  };

  // ── The contract check: model output → Detection[] → scoreCandidates ──────
  const detections: Detection[] = useMemo(
    () =>
      raw
        ? toDetections(raw, { tripId: "trip_live", frameId: "live0", t: 4, source: "manual" })
        : [],
    [raw],
  );

  const candidates: MomentCandidate[] = useMemo(() => {
    if (!detections.length) return [];
    // A single frame is a degenerate case for a temporal scorer, so synthesize a
    // short window by replaying the frame across it — enough to exercise the
    // novelty and face-count triggers honestly.
    const replayed: Detection[] = [];
    for (let k = 0; k < 12; k++) {
      for (const d of detections) {
        replayed.push({ ...d, id: `${d.id}_r${k}`, t: Number((k * 1.2).toFixed(1)) });
      }
    }
    return scoreCandidates({
      tripId: "trip_live",
      durationSec: 16,
      detections: replayed,
      // No audio or odometry from a still image — so a still can only ever fire
      // the vision triggers, which is the honest result.
      audioEvents: [],
      path: [],
    });
  }, [detections]);

  const promoted = candidates.find((c) => c.status !== "discarded") ?? candidates[0] ?? null;

  const momentJson = useMemo(() => {
    if (!promoted || !detections.length) return null;
    const replayed = detections.map((d) => ({ ...d, t: 6 }));
    const moment = promoteToMoment(promoted, replayed, {
      id: "m_live_preview",
      title: "Live detector frame",
      summary: "Built from a single frame in the detector bench.",
      place: { label: "Detector bench", pos: [0, 0] },
      people: [],
      transcript: [],
      splat: { status: "processing", note: "No capture — single frame only." },
      vibe: { mood: "n/a", energy: 0, tags: ["bench"] },
    });
    return JSON.stringify(moment, null, 2);
  }, [promoted, detections]);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-fog-100">Detector bench</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fog-300">
          Runs a real object detector in your browser and pushes its output through the same{" "}
          <code className="font-mono text-[13px] text-machine-300">scoreCandidates</code> the trip
          data uses. Nothing is uploaded — the model runs locally.
        </p>
      </header>

      {/* ── Model ────────────────────────────────────────────────────────── */}
      <section className="surface rounded-xl p-4">
        <SectionHeading
          hint="Weights download on demand, then stay cached for the session."
          right={
            handle && (
              <Chip tone="signal">
                loaded · {handle.device}
              </Chip>
            )
          }
        >
          Model
        </SectionHeading>

        <div className="grid gap-2 sm:grid-cols-2">
          {DETECTOR_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={phase === "loading" || phase === "running"}
              onClick={() => {
                setModelId(m.id);
                setHandle(null);
                setPhase("idle");
                setRaw(null);
              }}
              className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                modelId === m.id
                  ? "border-machine-500/60 bg-machine-500/10"
                  : "border-ink-700 hover:border-ink-600"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-fog-100">{m.label}</span>
                <span className="tnum font-mono text-[10px] text-fog-400">~{m.approxMb} MB</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-fog-300">{m.note}</p>
              <p className="mt-1 font-mono text-[10px] text-fog-400">{m.id}</p>
            </button>
          ))}
        </div>

        {phase === "idle" && (
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg border border-machine-500/60 bg-machine-500/12 px-3 py-2 text-[13px] font-medium text-machine-300 transition-colors hover:bg-machine-500/20"
          >
            Load model
          </button>
        )}

        {phase === "loading" && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3 text-[11px] text-fog-300">
              <span className="truncate font-mono">{progress?.file ?? progress?.status ?? "…"}</span>
              <span className="tnum shrink-0 font-mono text-fog-400">
                {formatBytes(progress?.loaded)}
                {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-machine-400 transition-[width] duration-200"
                style={{ width: `${Math.round(progress?.progress ?? 0)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-fail-400/40 bg-fail-400/10 p-2.5 text-[12px] text-fail-400">
            {error}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* ── Frame + boxes ─────────────────────────────────────────────── */}
        <section>
          <SectionHeading
            hint="Drop a photo with a few obvious objects in it."
            right={<StageTag n={1} name="detection" />}
          >
            Frame
          </SectionHeading>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files[0]);
            }}
            className="surface relative overflow-hidden rounded-xl"
          >
            {imageUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgRef} src={imageUrl} alt="Frame to run detection on" className="block w-full" />
                {raw?.map((d, i) => {
                  const color = colorForLabel(d.label.toLowerCase());
                  const dim = hoveredIdx !== null && hoveredIdx !== i;
                  return (
                    <span
                      key={i}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="absolute border-2 transition-opacity"
                      style={{
                        left: `${d.box.xmin * 100}%`,
                        top: `${d.box.ymin * 100}%`,
                        width: `${(d.box.xmax - d.box.xmin) * 100}%`,
                        height: `${(d.box.ymax - d.box.ymin) * 100}%`,
                        borderColor: color,
                        opacity: dim ? 0.28 : 1,
                      }}
                    >
                      <span
                        className="absolute -top-[18px] left-0 whitespace-nowrap rounded px-1 font-mono text-[10px] text-ink-950"
                        style={{ background: color }}
                      >
                        {d.label} {d.score.toFixed(2)}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <label className="flex h-64 cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-700 text-center">
                <span className="text-[13px] text-fog-300">Drop an image, or click to choose</span>
                <span className="text-[11px] text-fog-400">Runs locally — nothing is uploaded</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] text-fog-300">
              threshold
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="accent-machine-400"
              />
              <span className="tnum font-mono text-[11px] text-fog-400">
                {threshold.toFixed(2)}
              </span>
            </label>

            <button
              type="button"
              disabled={!handle || !imageUrl || phase === "running"}
              onClick={run}
              className="rounded-lg border border-machine-500/60 bg-machine-500/12 px-3 py-1.5 text-[13px] font-medium text-machine-300 transition-colors hover:bg-machine-500/20 disabled:opacity-40"
            >
              {phase === "running" ? "detecting…" : "Run detection"}
            </button>

            {imageUrl && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12px] text-fog-300 transition-colors hover:border-ink-600"
              >
                change image
              </button>
            )}

            {elapsedMs !== null && (
              <span className="tnum font-mono text-[11px] text-fog-400">
                {raw?.length ?? 0} boxes in {elapsedMs} ms
              </span>
            )}
          </div>
        </section>

        {/* ── Contract + pipeline output ────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <SectionHeading hint="Model output, converted to the pipeline's own type.">
              Detection[]
            </SectionHeading>
            {detections.length ? (
              <ul className="scrollbar-thin max-h-52 space-y-1 overflow-y-auto pr-1">
                {detections.map((d, i) => (
                  <li
                    key={d.id}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                      hoveredIdx === i ? "bg-ink-800/70" : ""
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <LabelDot label={d.label} size={7} />
                      <span className="truncate text-[13px] text-fog-100">{d.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tnum font-mono text-[10px] text-fog-400">
                        {d.depthM}m
                      </span>
                      <ConfidenceBar value={d.confidence} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-fog-400">
                Load a model and run detection to see records here.
              </p>
            )}
          </div>

          <div>
            <SectionHeading
              hint={`Same scorer as the trip. Promote threshold ${PIPELINE_CONFIG.promoteThreshold}.`}
              right={<StageTag n={2} name="candidates" />}
            >
              What stage 2 makes of it
            </SectionHeading>

            {candidates.length ? (
              <ul className="space-y-2">
                {candidates.slice(0, 3).map((c) => (
                  <li key={c.id} className="rounded-lg border border-ink-700 bg-ink-850 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-fog-400">
                        {c.tStart}s–{c.tEnd}s
                      </span>
                      <span className="tnum font-mono text-[11px] text-machine-300">
                        score {c.score.toFixed(2)}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {c.triggers.slice(0, 4).map((t, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-[11px] text-fog-200">
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: LAYER_COLOR[TRIGGER_LAYER[t.kind]] }}
                          />
                          {describeTrigger(t)}
                        </li>
                      ))}
                    </ul>
                    {c.discardReason && (
                      <p className="mt-1.5 border-t border-ink-700 pt-1.5 text-[10px] text-fail-400">
                        discarded — {c.discardReason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-fog-400">
                No candidates yet. A still frame has no audio or odometry, so only the vision
                triggers can fire — that is the honest result, not a bug.
              </p>
            )}
          </div>

          {momentJson && (
            <div>
              <SectionHeading
                hint="What stage 3 would store."
                right={
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(momentJson)}
                    className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-fog-300 transition-colors hover:border-ink-600"
                  >
                    copy JSON
                  </button>
                }
              >
                Promoted Moment
              </SectionHeading>
              <pre className="scrollbar-thin max-h-64 overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-2.5 font-mono text-[10px] leading-relaxed text-fog-300">
                {momentJson}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
