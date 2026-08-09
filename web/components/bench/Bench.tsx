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
 *
 * Two readouts here exist to make previously invisible things visible:
 *
 *   · AGREEMENT — how many of the augmented passes found each object. This is
 *     what "the detector is inconsistent" looks like when you measure it instead
 *     of watching boxes flicker. A 6/6 detection and a 1/6 detection used to be
 *     rendered identically.
 *   · BEST ANGLE — which look the pipeline would keep, scored on framing rather
 *     than on the model's confidence, plus the one thing most wrong with it.
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
  QUALITY_PRESETS,
  formatBytes,
  loadDetector,
  passCountFor,
  toDetections,
  trackFrames,
  type DetectRun,
  type DetectorHandle,
  type Precision,
  type ProgressInfo,
  type QualityMode,
} from "@/lib/detector";
import { scoreView, type ViewScore } from "@/lib/detect/viewQuality";
import { colorForLabel } from "@/lib/mock/labels";
import { PIPELINE_CONFIG, promoteToMoment, scoreCandidates } from "@/lib/pipeline";
import { describeTrigger, LAYER_COLOR, TRIGGER_LAYER } from "@/lib/triggers";
import { PINE } from "@/lib/theme";
import type { Detection, MomentCandidate } from "@/lib/types";

type Phase = "idle" | "loading" | "ready" | "running" | "error";

const QUALITY_ORDER: QualityMode[] = ["fast", "balanced", "thorough"];

export function Bench() {
  const [modelId, setModelId] = useState(DETECTOR_MODELS[0].id);
  const [quality, setQuality] = useState<QualityMode>("balanced");
  const [precision, setPrecision] = useState<Precision>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [handle, setHandle] = useState<DetectorHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [run, setRun] = useState<DetectRun | null>(null);
  const [passDone, setPassDone] = useState<[number, number] | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const raw = run?.detections ?? null;

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
      const h = await loadDetector(modelId, setProgress, precision);
      setHandle(h);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [modelId, precision]);

  const detect = useCallback(async () => {
    if (!handle || !imageUrl) return;
    setPhase("running");
    setPassDone([0, passCountFor(QUALITY_PRESETS[quality])]);
    try {
      const out = await handle.detect(imageUrl, {
        threshold,
        quality,
        onPass: (done, total) => setPassDone([done, total]),
      });
      setRun(out);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      setPassDone(null);
    }
  }, [handle, imageUrl, threshold, quality]);

  const onFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setRun(null);
  };

  const resetModel = (next: Partial<{ modelId: string; precision: Precision }>) => {
    if (next.modelId !== undefined) setModelId(next.modelId);
    if (next.precision !== undefined) setPrecision(next.precision);
    setHandle(null);
    setPhase("idle");
    setRun(null);
  };

  // ── The contract check: model output → Detection[] → scoreCandidates ──────
  const detections: Detection[] = useMemo(
    () =>
      raw
        ? toDetections(raw, { tripId: "trip_live", frameId: "live0", t: 4, source: "manual" })
        : [],
    [raw],
  );

  /**
   * Best angle, per detection.
   *
   * Scored on the frame's own geometry, so it works on a still with no odometry
   * — the steadiness term simply stays neutral, which the panel says out loud.
   */
  const views: ViewScore[] = useMemo(
    () => detections.map((d) => scoreView(d.bbox, d.label, d.confidence, d.t)),
    [detections],
  );

  const bestIdx = useMemo(() => {
    if (!views.length) return null;
    let idx = 0;
    for (let i = 1; i < views.length; i++) if (views[i].score > views[idx].score) idx = i;
    return idx;
  }, [views]);

  /**
   * A single frame is a degenerate case for a temporal scorer, so synthesize a
   * short window by replaying the frame across it. The replay goes through
   * `trackFrames` rather than being hand-stamped: that is the real tracker, so
   * the resulting Detections carry real trackIds and `collapseToSightings` will
   * actually accept them — which is the whole seam being tested.
   */
  const replayed: Detection[] = useMemo(() => {
    if (!raw) return [];
    const frames = Array.from({ length: 12 }, (_, k) => ({
      frameId: `live_r${k}`,
      t: Number((k * 1.2).toFixed(1)),
      detections: raw,
    }));
    return trackFrames(frames, { tripId: "trip_live", source: "manual" });
  }, [raw]);

  const candidates: MomentCandidate[] = useMemo(() => {
    if (!replayed.length) return [];
    return scoreCandidates({
      tripId: "trip_live",
      durationSec: 16,
      detections: replayed,
      // No audio or odometry from a still image — so a still can only ever fire
      // the vision triggers, which is the honest result.
      audioEvents: [],
      path: [],
    });
  }, [replayed]);

  const promoted = candidates.find((c) => c.status !== "discarded") ?? candidates[0] ?? null;

  const momentJson = useMemo(() => {
    if (!promoted || !replayed.length) return null;
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
  }, [promoted, replayed]);

  const preset = QUALITY_PRESETS[quality];

  return (
    <div className="space-y-6">
      <header className="rise-in max-w-2xl">
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
        className="plate-vellum rise-in relative p-5 sm:p-6"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <CardHead n={1} title="Pick a model" hint="Weights download once, then stay cached.">
          {handle && (
            <span className="fnote chip chip-live text-[10px]">
              [ loaded · {handle.device} · {handle.dtype} ]
            </span>
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
                onClick={() => resetModel({ modelId: m.id })}
                className="rounded-[10px] p-4 text-left transition-[box-shadow,background-color,transform] duration-300 ease-(--ease-signature) hover:-translate-y-0.5 disabled:opacity-50"
                style={{
                  background: on ? "var(--color-pine)" : "transparent",
                  boxShadow: on ? "var(--shadow-card)" : "var(--ring-ink)",
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[15px] font-semibold ${on ? "text-milk" : "text-ink"}`}>
                    {m.label}
                  </span>
                  <span className={`fnote tnum text-[10px] ${on ? "text-brass" : "text-ink-faint"}`}>
                    ~{m.approxMb} MB
                  </span>
                </div>
                <p className={`mt-1.5 text-[12px] leading-snug ${on ? "text-mist" : "text-ink-soft"}`}>
                  {m.note}
                </p>
                <p className={`fnote mt-2 text-[9.5px] ${on ? "text-mist/70" : "text-ink-faint"}`}>
                  {m.id}
                </p>
              </button>
            );
          })}
        </div>

        {/* Precision. The default on a machine without WebGPU is int8, which is
            the single biggest hidden quality difference between two laptops. */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <span className="tag text-[12px] text-ink-soft">Weights</span>
          {(
            [
              ["auto", "Auto", "fp32 on WebGPU, int8 on WASM"],
              ["full", "Full (fp32)", "Best boxes everywhere. Big download, slow on WASM."],
              ["quantized", "Int8", "Smallest and fastest. Looser boxes."],
            ] as const
          ).map(([id, label, tip]) => (
            <button
              key={id}
              type="button"
              title={tip}
              disabled={phase === "loading" || phase === "running"}
              onClick={() => resetModel({ precision: id })}
              className={
                precision === id
                  ? "pill-ghost bg-ink/8 px-3 py-1.5 text-[11.5px] font-semibold text-ink disabled:opacity-50"
                  : "pill-ghost px-3 py-1.5 text-[11.5px] text-ink-soft disabled:opacity-50"
              }
            >
              {label}
            </button>
          ))}
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
          className="plate-vellum rise-in relative h-fit p-5 sm:p-6"
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
            style={{ boxShadow: imageUrl ? "var(--ring-ink)" : "none" }}
          >
            {imageUrl ? (
              <div className="relative bg-pine">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Frame to run detection on" className="block w-full" />
                {raw?.map((d, i) => {
                  const color = colorForLabel(d.label.toLowerCase());
                  const dim = hoveredIdx !== null && hoveredIdx !== i;
                  const isBest = bestIdx === i;
                  return (
                    <span
                      key={i}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="absolute rounded-[4px] transition-opacity duration-200"
                      style={{
                        left: `${d.box.xmin * 100}%`,
                        top: `${d.box.ymin * 100}%`,
                        width: `${(d.box.xmax - d.box.xmin) * 100}%`,
                        height: `${(d.box.ymax - d.box.ymin) * 100}%`,
                        // The best-angle box is drawn solid and the rest dashed,
                        // so the pick is legible without reading a number.
                        border: `2px ${isBest ? "solid" : "dashed"} ${color}`,
                        boxShadow: isBest ? `0 0 0 2px ${color}55, 0 0 14px ${color}55` : "none",
                        opacity: dim ? 0.25 : 1,
                      }}
                    >
                      <span
                        className="tag absolute -top-[20px] left-0 whitespace-nowrap rounded-[4px] px-1.5 text-[10px] font-bold"
                        style={{ background: color, color: PINE }}
                      >
                        {d.label} {d.score.toFixed(2)}
                        {d.agreement < 1 && ` · ${d.support}/${run?.passCount}`}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <label className="flex h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-ink/20 text-center transition-colors duration-300 ease-(--ease-signature) hover:border-ink/40 hover:bg-vellum">
                <span className="pill-ghost px-4 py-2 text-[13px] text-ink">Choose an image</span>
                <span className="tag text-[12px] text-ink-soft">
                  or drag one anywhere in this frame
                </span>
                <span className="fnote text-[9.5px] text-ink-faint">
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

          {/* Quality preset — how many looks the detector gets at the frame. */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="tag text-[12px] text-ink-soft">Looks</span>
            {QUALITY_ORDER.map((id) => {
              const p = QUALITY_PRESETS[id];
              const on = quality === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={p.note}
                  disabled={phase === "running"}
                  onClick={() => setQuality(id)}
                  className={
                    on
                      ? "pill-ghost bg-ink/8 px-3 py-1.5 text-[11.5px] font-semibold text-ink disabled:opacity-50"
                      : "pill-ghost px-3 py-1.5 text-[11.5px] text-ink-soft disabled:opacity-50"
                  }
                >
                  {p.label}
                  <span className="fnote tnum ml-1.5 text-[9.5px] text-ink-faint">
                    ×{passCountFor(p)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="tag mt-1.5 text-[11.5px] text-ink-faint">{preset.note}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
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
              onClick={detect}
              className={inkButtonClass("px-4 py-2 text-[13px]")}
            >
              {phase === "running"
                ? passDone
                  ? `Pass ${passDone[0]}/${passDone[1]}…`
                  : "Detecting…"
                : "Run detection"}
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

            {run && (
              <span className="fnote chip chip-live tnum text-[10px]">
                [ {run.detections.length} boxes · {run.passCount} passes · {run.elapsedMs} ms ]
              </span>
            )}
          </div>
        </section>

        {/* ── 03 · Pipeline ─────────────────────────────────────────────── */}
        <section className="space-y-5">
          {/* Best angle. The pick the pipeline would keep, and why. */}
          <div
            className="plate-vellum rise-in relative p-5 sm:p-6"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <CardHead
              n={3}
              title="Best angle"
              hint="Scored on framing, not on the model's confidence."
            >
              <span
                className="fnote chip chip-synth text-[10px]"
                title="A still has no odometry, so the motion-blur term stays neutral for every box here."
              >
                [ no odometry ]
              </span>
            </CardHead>

            {bestIdx !== null && detections[bestIdx] ? (
              <>
                <div className="mt-2.5 flex items-center gap-2">
                  <LabelDot label={detections[bestIdx].label} />
                  <span className="text-[15px] font-semibold text-ink">
                    {detections[bestIdx].label}
                  </span>
                  <span className="fnote tnum ml-auto text-[10px] text-moss">
                    view {(views[bestIdx].score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
                  Weakest: {views[bestIdx].critique}.
                </p>
                <TermBars view={views[bestIdx]} />
                <p className="fnote mt-2.5 text-[9.5px] leading-relaxed text-ink-faint">
                  [ this is the box the moment would keep, and the pose the robot would drive back
                  to — not the highest-confidence one ]
                </p>
              </>
            ) : (
              <p className="mt-2 text-[12px] text-ink-soft">
                Run detection to see which look the pipeline would keep.
              </p>
            )}
          </div>

          <div
            className="plate-vellum rise-in relative p-5 sm:p-6"
            style={{ "--i": 4 } as React.CSSProperties}
          >
            <CardHead
              n={4}
              title="Detection[]"
              hint="Model output in the pipeline's own type."
            />
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
                      <span className="truncate text-[13px] font-medium text-ink">{d.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/* Agreement across passes — the consistency readout. */}
                      <span
                        className="fnote tnum text-[10px]"
                        title={`${raw?.[i].support ?? 0} of ${run?.passCount ?? 1} passes found this`}
                        style={{
                          color:
                            (raw?.[i].agreement ?? 1) >= 0.75
                              ? "var(--color-moss)"
                              : (raw?.[i].agreement ?? 1) >= 0.4
                                ? "var(--color-brass)"
                                : "var(--color-clay)",
                        }}
                      >
                        {raw?.[i].support}/{run?.passCount}
                      </span>
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
            className="plate-vellum rise-in relative p-5 sm:p-6"
            style={{ "--i": 5 } as React.CSSProperties}
          >
            <CardHead
              n={5}
              title="What stage 2 makes of it"
              hint={`Same scorer as the day. Promote ≥ ${PIPELINE_CONFIG.promoteThreshold}.`}
            >
              <span
                className="fnote chip chip-synth text-[10px]"
                title="A still frame has no timeline — the frame is replayed across a synthetic 16 s window and run through the real tracker, so the detections carry real trackIds."
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
                        <li key={i} className="flex items-center gap-1.5 text-[11.5px] text-ink">
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
            <div className="plate-vellum rise-in relative p-5 sm:p-6">
              <CardHead n={6} title="Promoted Moment" hint="What stage 3 would store.">
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(momentJson)}
                  className="fnote text-[10px] text-ink-soft transition-colors duration-150 hover:text-ink"
                >
                  Copy JSON
                </button>
              </CardHead>
              <pre className="plate-pine scrollbar-thin mt-2 max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-mist">
                {momentJson}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** The six view terms as bars — makes "why this angle" readable at a glance. */
function TermBars({ view }: { view: ViewScore }) {
  const rows: Array<[string, number]> = [
    ["framing", view.terms.framing],
    ["wholeness", view.terms.wholeness],
    ["centering", view.terms.centering],
    ["aspect", view.terms.aspect],
    ["certainty", view.terms.certainty],
    ["steadiness", view.terms.steadiness],
  ];
  return (
    <ul className="mt-2.5 space-y-1">
      {rows.map(([name, value]) => (
        <li key={name} className="flex items-center gap-2">
          <span className="tag w-[68px] shrink-0 text-[11px] text-ink-soft">{name}</span>
          <span
            aria-hidden
            className="h-[6px] flex-1 overflow-hidden rounded-full"
            style={{ background: "rgb(27 27 24 / 0.08)" }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.round(value * 100)}%`,
                background: value >= 0.7 ? "var(--color-moss)" : "var(--color-brass)",
              }}
            />
          </span>
          <span className="fnote tnum w-[30px] shrink-0 text-right text-[9.5px] text-ink-faint">
            {(value * 100).toFixed(0)}
          </span>
        </li>
      ))}
    </ul>
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
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <NumberChip n={n} size="sm" className="mt-[3px]" />
        <div className="min-w-0">
          <h2 className="text-[17px] leading-tight text-ink">{title}</h2>
          {hint && <p className="tag mt-1 text-[11.5px] text-ink-faint">{hint}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-[3px]">{children}</div>
    </div>
  );
}
