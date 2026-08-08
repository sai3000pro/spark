"use client";

/**
 * The detector bench — the journal's workbench page.
 *
 * Its job is to prove the contract end-to-end: a real model runs on a real
 * image, its output is converted to the pipeline's `Detection[]`, and those go
 * straight into the SAME `scoreCandidates` the trip uses. If a candidate comes
 * out the other side, stage 1 → stage 2 works on live data.
 *
 * Doubles as the day-2 tuning tool: change TRIGGER_WEIGHTS, drop an image in,
 * see what fires. This is where the pipeline's honesty lives — discarded
 * candidates stay visible, thresholds stay legible, and every stat speaks the
 * quiet metadata voice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LabelDot,
  Meter,
  NumberChip,
  inkButtonClass,
  outlineButtonClass,
} from "@/components/system/ui";
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
import { PINE } from "@/lib/theme";
import type { Detection, MomentCandidate } from "@/lib/types";

type Phase = "idle" | "loading" | "ready" | "running" | "error";

export function Bench() {
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
    <div className="space-y-5">
      <header className="rise-in max-w-3xl">
        <span className="fnote text-[10.5px] text-moss">
          [ stage 1 → stage 2 · runs in your browser ]
        </span>
        <h1 className="mt-2 text-[32px] leading-[1.02] text-ink sm:text-[38px]">
          The detector bench
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">
          A real object detector runs on any photo you drop in, and its output goes through the
          same <code className="font-mono text-[13px] font-semibold text-ink">scoreCandidates</code> the
          day&apos;s map uses. Nothing is uploaded.
        </p>
      </header>

      {/* ── 01 · Model ──────────────────────────────────────────────────── */}
      <section
        className="plate-vellum rise-in relative p-4 sm:p-5"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <CardHead n={1} title="Pick a model" hint="Weights download once, then stay cached.">
          {handle && (
            <span className="fnote chip chip-live text-[10px]">[ loaded · {handle.device} ]</span>
          )}
        </CardHead>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {DETECTOR_MODELS.map((m) => {
            const on = modelId === m.id;
            return (
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
                className="rounded-[10px] p-3.5 text-left transition-[box-shadow,background-color] duration-200 ease-(--ease-signature) disabled:opacity-50"
                style={{
                  boxShadow: on ? "inset 0 0 0 1.5px var(--color-ink)" : "var(--ring-ink)",
                  background: on ? "rgb(27 27 24 / 0.05)" : "transparent",
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-[15px] font-semibold ${
                      on ? "selected-block px-1.5" : "text-ink"
                    }`}
                  >
                    {m.label}
                  </span>
                  <span className="fnote tnum text-[10px] text-ink-faint">~{m.approxMb} MB</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">{m.note}</p>
                <p className="fnote mt-1.5 text-[9.5px] text-ink-faint">{m.id}</p>
              </button>
            );
          })}
        </div>

        {phase === "idle" && (
          <button type="button" onClick={load} className={inkButtonClass("mt-3.5")}>
            Load model
          </button>
        )}

        {phase === "loading" && (
          <div className="mt-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="tag truncate text-[12px] text-ink-soft">
                {progress?.file ?? progress?.status ?? "…"}
              </span>
              <span className="fnote tnum shrink-0 text-[10px] text-moss">
                {formatBytes(progress?.loaded)}
                {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
              </span>
            </div>
            <div
              className="mt-1.5 h-[8px] overflow-hidden rounded-full"
              style={{ background: "rgb(27 27 24 / 0.1)" }}
            >
              <div
                className="h-full rounded-full bg-moss transition-[width] duration-200"
                style={{ width: `${Math.round(progress?.progress ?? 0)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p
            className="mt-3.5 rounded-[10px] px-3 py-2.5 text-[12px] font-medium text-clay"
            style={{ boxShadow: "0 0 0 1px rgb(207 94 50 / 0.4)" }}
          >
            {error}
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* ── 02 · Frame ────────────────────────────────────────────────── */}
        <section
          className="plate-vellum rise-in relative h-fit p-4 sm:p-5"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <CardHead n={2} title="Drop a frame" hint="A photo with a few obvious objects in it." />

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files[0]);
            }}
            className="relative mt-3 overflow-hidden rounded-[14px]"
            style={{ boxShadow: "var(--ring-ink)" }}
          >
            {imageUrl ? (
              <div className="relative bg-pine">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Frame to run detection on" className="block w-full" />
                {raw?.map((d, i) => {
                  const color = colorForLabel(d.label.toLowerCase());
                  const dim = hoveredIdx !== null && hoveredIdx !== i;
                  return (
                    <span
                      key={i}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="absolute rounded-[4px] border-2 transition-opacity duration-200"
                      style={{
                        left: `${d.box.xmin * 100}%`,
                        top: `${d.box.ymin * 100}%`,
                        width: `${(d.box.xmax - d.box.xmin) * 100}%`,
                        height: `${(d.box.ymax - d.box.ymin) * 100}%`,
                        borderColor: color,
                        boxShadow: `0 0 10px ${color}40`,
                        opacity: dim ? 0.25 : 1,
                      }}
                    >
                      <span
                        className="tag absolute -top-[20px] left-0 whitespace-nowrap rounded-[4px] px-1.5 text-[10px] font-bold"
                        style={{ background: color, color: PINE }}
                      >
                        {d.label} {d.score.toFixed(2)}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <label className="flex h-64 cursor-pointer flex-col items-center justify-center gap-2 bg-paper text-center transition-colors duration-200 hover:bg-brass/20">
                <span className="text-[15px] font-semibold text-ink">
                  Drop an image, or click to choose
                </span>
                <span className="fnote text-[10px] text-ink-faint">
                  [ runs locally — nothing is uploaded ]
                </span>
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

          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <label className="tag flex items-center gap-2 text-[12px] text-ink-soft">
              Threshold
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="scrub-paper w-28"
              />
              <span className="tnum text-ink">{threshold.toFixed(2)}</span>
            </label>

            <button
              type="button"
              disabled={!handle || !imageUrl || phase === "running"}
              onClick={run}
              className={inkButtonClass("px-4 py-2 text-[13px]")}
            >
              {phase === "running" ? "Detecting…" : "Run detection"}
            </button>

            {imageUrl && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={outlineButtonClass("px-3.5 py-1.5 text-[12px]")}
              >
                Change image
              </button>
            )}

            {elapsedMs !== null && (
              <span className="fnote chip chip-live tnum text-[10px]">
                [ {raw?.length ?? 0} boxes · {elapsedMs} ms ]
              </span>
            )}
          </div>
        </section>

        {/* ── 03 · Pipeline ─────────────────────────────────────────────── */}
        <section className="space-y-5">
          <div
            className="plate-vellum rise-in relative p-4 sm:p-5"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <CardHead n={3} title="Detection[]" hint="Model output in the pipeline's own type." />
            {detections.length ? (
              <ul className="scrollbar-thin mt-2 max-h-52 overflow-y-auto pr-1">
                {detections.map((d, i) => (
                  <li
                    key={d.id}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className={`flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors duration-150 ${
                      hoveredIdx === i ? "bg-ink/5" : ""
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <LabelDot label={d.label} />
                      <span className="truncate text-[13px] font-medium text-ink">
                        {d.label}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="fnote tnum text-[10px] text-ink-faint">{d.depthM} m</span>
                      <Meter value={d.confidence} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-ink-soft">
                Load a model and run detection to see records here.
              </p>
            )}
          </div>

          <div
            className="plate-vellum rise-in relative p-4 sm:p-5"
            style={{ "--i": 4 } as React.CSSProperties}
          >
            <CardHead
              n={4}
              title="What stage 2 makes of it"
              hint={`Same scorer as the day. Promote ≥ ${PIPELINE_CONFIG.promoteThreshold}.`}
            >
              <span
                className="fnote chip chip-synth text-[10px]"
                title="A still frame has no timeline — the scorer sees the frame replayed across a synthetic 16 s window."
              >
                [ synthetic window ]
              </span>
            </CardHead>

            {candidates.length ? (
              <ul className="mt-2 space-y-2.5">
                {candidates.slice(0, 3).map((c) => (
                  <li
                    key={c.id}
                    className="rounded-[10px] p-2.5"
                    style={{ boxShadow: "var(--ring-ink)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="fnote tnum text-[10px] text-ink-faint">
                        {c.tStart}s–{c.tEnd}s
                      </span>
                      <span
                        className={`fnote tnum text-[10px] ${
                          c.status === "promoted" ? "text-moss" : "text-ink-soft"
                        }`}
                      >
                        score {c.score.toFixed(2)}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {c.triggers.slice(0, 4).map((t, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-1.5 text-[11.5px] text-ink"
                        >
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 shrink-0 rounded-[3px]"
                            style={{ background: LAYER_COLOR[TRIGGER_LAYER[t.kind]] }}
                          />
                          {describeTrigger(t)}
                        </li>
                      ))}
                    </ul>
                    {c.discardReason && (
                      <p className="mt-1.5 text-[10.5px] font-semibold text-clay">
                        discarded — {c.discardReason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                No candidates yet. A still frame has no audio or odometry, so only the vision
                triggers can fire — that is the honest result, not a bug.
              </p>
            )}
          </div>

          {momentJson && (
            <div className="plate-vellum rise-in relative p-4 sm:p-5">
              <CardHead n={5} title="Promoted Moment" hint="What stage 3 would store.">
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(momentJson)}
                  className="fnote text-[10px] text-ink-soft transition-colors duration-150 hover:text-ink"
                >
                  Copy JSON
                </button>
              </CardHead>
              <pre
                className="plate-pine scrollbar-thin mt-2 max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-mist"
              >
                {momentJson}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CardHead({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <NumberChip n={n} size="sm" />
        <h2 className="text-[17px] text-ink">{title}</h2>
        {hint && <span className="hidden text-[11.5px] text-ink-soft sm:inline">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
