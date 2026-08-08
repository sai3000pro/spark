"use client";

/**
 * The pipeline, as one picture.
 *
 * Three lanes on a shared time axis:
 *   1  detections   — density over time (magnitude → area, single hue)
 *   2  candidates    — windows stage 2 flagged, promoted AND discarded
 *   3  moments       — what survived, connected back to its candidate
 *
 * The discarded candidates are the point. Showing only successes proves nothing;
 * showing what was rejected and why is what makes the scoring look like a system
 * instead of a filter that happened to keep six things.
 */
import { useMemo, useState } from "react";
import { timecode } from "@/lib/format";
import { DENSITY_RAMP } from "@/lib/mock/labels";
import { PIPELINE_CONFIG } from "@/lib/pipeline";
import { FOG, INK, MEMORY, STATE } from "@/lib/theme";
import type { DetectionBin } from "@/lib/pipeline";
import { describeTrigger, LAYER_COLOR, TRIGGER_LAYER } from "@/lib/triggers";
import type { MomentSummary } from "@/lib/tripData";
import type { MomentCandidate } from "@/lib/types";
import { StageTag } from "@/components/ui";

interface Props {
  bins: DetectionBin[];
  candidates: MomentCandidate[];
  moments: MomentSummary[];
  durationSec: number;
  detectionCount: number;
  activeMomentId?: string | null;
  onHoverMoment?: (id: string | null) => void;
  onSelectMoment?: (id: string) => void;
}

const W = 1000;
const LANE = {
  detTop: 6,
  detBottom: 52,
  candTop: 64,
  candH: 18,
  momTop: 96,
  momH: 20,
  axisY: 130,
};
const H = 142;

type Hover =
  | { kind: "candidate"; c: MomentCandidate; x: number; y: number }
  | { kind: "moment"; m: MomentSummary; index: number; x: number; y: number }
  | null;

export function PipelineTimeline({
  bins,
  candidates,
  moments,
  durationSec,
  detectionCount,
  activeMomentId,
  onHoverMoment,
  onSelectMoment,
}: Props) {
  const [hover, setHover] = useState<Hover>(null);

  const x = (t: number) => (t / durationSec) * W;

  const { areaPath, maxCount } = useMemo(() => {
    const max = Math.max(1, ...bins.map((b) => b.count));
    const h = LANE.detBottom - LANE.detTop;
    const pts = bins.map((b, i) => {
      const px = (i / (bins.length - 1 || 1)) * W;
      const py = LANE.detBottom - (b.count / max) * h;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    return {
      areaPath: `M0,${LANE.detBottom} L${pts.join(" L")} L${W},${LANE.detBottom} Z`,
      maxCount: max,
    };
  }, [bins]);

  // Tooltip position, as a percentage of the wrapper. The SVG scales to the
  // wrapper's width, so a viewBox x maps to the same fraction of it — no need to
  // measure anything, which also means no ref read during render.
  const toPct = (vx: number) => (vx / W) * 100;

  return (
    <div className="surface rounded-xl p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <StageTag n={1} name={`${detectionCount.toLocaleString()} detections`} />
          <StageTag n={2} name={`${candidates.length} candidates`} />
          <StageTag n={3} name={`${moments.length} moments`} />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-fog-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm border border-signal-500 bg-signal-500/25" />
            promoted
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm border border-dashed border-ink-500" />
            discarded
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full overflow-visible"
          role="img"
          aria-label={`Pipeline timeline: ${detectionCount} detections produced ${candidates.length} moment candidates, of which ${moments.length} became moments`}
        >
          <defs>
            <linearGradient id="detFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={DENSITY_RAMP[4]} stopOpacity="0.55" />
              <stop offset="1" stopColor={DENSITY_RAMP[1]} stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* ── Lane 1: detection density ───────────────────────────────── */}
          <path d={areaPath} fill="url(#detFill)" />
          <path
            d={areaPath}
            fill="none"
            stroke={DENSITY_RAMP[4]}
            strokeWidth={1.25}
            strokeOpacity={0.9}
          />
          <line
            x1={0}
            x2={W}
            y1={LANE.detBottom}
            y2={LANE.detBottom}
            stroke={INK[600]}
            strokeWidth={1}
          />
          <text x={2} y={LANE.detTop + 8} fontSize={9} fill={FOG[400]} className="font-mono">
            {maxCount}/bin
          </text>

          {/* ── Lane 2: candidates ──────────────────────────────────────── */}
          {candidates.map((c) => {
            const cx = x(c.tStart);
            const cw = Math.max(3, x(c.tEnd) - cx);
            const promoted = c.status === "promoted";
            const linkedMoment = moments.find((m) => m.tStart === c.tStart);
            const isActive = linkedMoment && activeMomentId === linkedMoment.id;
            return (
              <g key={c.id}>
                <rect
                  x={cx}
                  y={LANE.candTop}
                  width={cw}
                  height={LANE.candH}
                  rx={4}
                  fill={promoted ? STATE.signal : INK[500]}
                  fillOpacity={promoted ? (isActive ? 0.55 : 0.3) : 0.14}
                  stroke={promoted ? (isActive ? STATE.signal : STATE.signalDim) : INK[500]}
                  strokeWidth={promoted && isActive ? 2 : 1.25}
                  strokeDasharray={promoted ? undefined : "3 3"}
                />
                {/* Score as a fill level inside the window — no extra axis needed. */}
                {promoted && (
                  <rect
                    x={cx}
                    y={LANE.candTop + LANE.candH - c.score * LANE.candH}
                    width={cw}
                    height={c.score * LANE.candH}
                    rx={3}
                    fill={STATE.signal}
                    fillOpacity={0.28}
                  />
                )}
                {/* Hit target deliberately taller than the mark. */}
                <rect
                  x={cx}
                  y={LANE.candTop - 5}
                  width={cw}
                  height={LANE.candH + 10}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => {
                    setHover({ kind: "candidate", c, x: cx + cw / 2, y: LANE.candTop });
                    if (linkedMoment) onHoverMoment?.(linkedMoment.id);
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    onHoverMoment?.(null);
                  }}
                  onClick={() => linkedMoment && onSelectMoment?.(linkedMoment.id)}
                />
              </g>
            );
          })}

          {/* ── Promotion connectors: candidate → moment ────────────────── */}
          {moments.map((m) => {
            const cx = x((m.tStart + m.tEnd) / 2);
            return (
              <line
                key={`link${m.id}`}
                x1={cx}
                x2={cx}
                y1={LANE.candTop + LANE.candH}
                y2={LANE.momTop}
                stroke={activeMomentId === m.id ? MEMORY[300] : INK[500]}
                strokeWidth={activeMomentId === m.id ? 2 : 1}
              />
            );
          })}

          {/* ── Lane 3: moments ─────────────────────────────────────────── */}
          {moments.map((m, i) => {
            const cx = x(m.tStart);
            const cw = Math.max(14, x(m.tEnd) - cx);
            const active = activeMomentId === m.id;
            return (
              <g
                key={m.id}
                className="cursor-pointer"
                onMouseEnter={() => {
                  setHover({ kind: "moment", m, index: i, x: cx + cw / 2, y: LANE.momTop });
                  onHoverMoment?.(m.id);
                }}
                onMouseLeave={() => {
                  setHover(null);
                  onHoverMoment?.(null);
                }}
                onClick={() => onSelectMoment?.(m.id)}
              >
                <rect
                  x={cx}
                  y={LANE.momTop}
                  width={cw}
                  height={LANE.momH}
                  rx={5}
                  fill={active ? MEMORY[300] : MEMORY[400]}
                  fillOpacity={active ? 0.9 : 0.7}
                />
                <text
                  x={cx + cw / 2}
                  y={LANE.momTop + LANE.momH / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={700}
                  fill={INK[950]}
                  className="select-none font-mono"
                >
                  {i + 1}
                </text>
                <rect
                  x={cx - 6}
                  y={LANE.momTop - 4}
                  width={cw + 12}
                  height={LANE.momH + 8}
                  fill="transparent"
                />
              </g>
            );
          })}

          {/* ── Time axis ───────────────────────────────────────────────── */}
          <line x1={0} x2={W} y1={LANE.axisY} y2={LANE.axisY} stroke={INK[600]} strokeWidth={1} />
          {axisTicks(durationSec).map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={LANE.axisY}
                y2={LANE.axisY + 4}
                stroke={INK[500]}
                strokeWidth={1}
              />
              <text
                x={x(t)}
                y={LANE.axisY + 12}
                textAnchor="middle"
                fontSize={9}
                fill={FOG[400]}
                className="font-mono"
              >
                {timecode(t)}
              </text>
            </g>
          ))}
        </svg>

        {/* Lane labels, in HTML so they stay legible at any width. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-full sm:block">
          {(
            [
              ["detections", LANE.detTop],
              ["candidates", LANE.candTop - 1],
              ["moments", LANE.momTop - 1],
            ] as const
          ).map(([label, y]) => (
            <span
              key={label}
              className="absolute right-0 font-mono text-[9px] uppercase tracking-wider text-fog-400"
              style={{ top: `${(y / H) * 100}%` }}
            >
              {label}
            </span>
          ))}
        </div>

        {hover && (
          <Tooltip left={toPct(hover.x)} top={(hover.y / H) * 100}>
            {hover.kind === "candidate" ? (
              <CandidateTip c={hover.c} />
            ) : (
              <MomentTip m={hover.m} index={hover.index} />
            )}
          </Tooltip>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-fog-400">
        Stage 2 runs on detection metadata, odometry and audio envelopes only — never pixels — so it
        can run continuously on the robot. Windows scoring under{" "}
        <span className="tnum font-mono text-fog-300">{PIPELINE_CONFIG.promoteThreshold}</span> never
        reach the expensive stage.{" "}
        <span className="text-fog-300">Hover any window to see what fired.</span>
      </p>
    </div>
  );
}

function Tooltip({
  left,
  top,
  children,
}: {
  left: number;
  top: number;
  candidateSpan?: MomentCandidate | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 w-60 -translate-x-1/2 -translate-y-full"
      style={{ left: `${left}%`, top: `${top}%`, marginTop: -10 }}
    >
      <div className="glass-raised rounded-lg p-2.5 shadow-xl shadow-black/50">{children}</div>
    </div>
  );
}

function CandidateTip({ c }: { c: MomentCandidate }) {
  const promoted = c.status === "promoted";
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-fog-400">
          {timecode(c.tStart)}–{timecode(c.tEnd)}
        </span>
        <span
          className={`tnum font-mono text-[10px] ${promoted ? "text-signal-400" : "text-fog-400"}`}
        >
          score {c.score.toFixed(2)}
        </span>
      </div>
      <ul className="space-y-1">
        {c.triggers.slice(0, 5).map((t, i) => {
          const layer = TRIGGER_LAYER[t.kind];
          return (
            <li key={i} className="flex items-center gap-1.5 text-[11px] text-fog-200">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: LAYER_COLOR[layer] }}
              />
              {describeTrigger(t)}
            </li>
          );
        })}
        {c.triggers.length > 5 && (
          <li className="text-[10px] text-fog-400">+{c.triggers.length - 5} more</li>
        )}
      </ul>
      {c.discardReason && (
        <p className="mt-2 border-t border-ink-700 pt-1.5 text-[10px] leading-snug text-fail-400">
          discarded — {c.discardReason}
        </p>
      )}
    </>
  );
}

function MomentTip({ m, index }: { m: MomentSummary; index: number }) {
  return (
    <>
      <div className="mb-1 font-mono text-[10px] text-fog-400">
        moment {index + 1} · {timecode(m.tStart)}
      </div>
      <div className="text-[12px] font-medium leading-snug text-fog-100">{m.title}</div>
      <div className="mt-1 text-[11px] text-fog-400">
        {m.placeLabel} · {m.objectCount} objects tracked
      </div>
    </>
  );
}

/** Round tick marks every 10 or 15 minutes depending on trip length. */
function axisTicks(durationSec: number): number[] {
  const step = durationSec > 4800 ? 900 : durationSec > 1800 ? 600 : 300;
  const out: number[] = [];
  for (let t = 0; t <= durationSec; t += step) out.push(t);
  return out;
}
