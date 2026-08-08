/** Small shared primitives. Server-safe — no hooks, no client directive. */
import type { ReactNode } from "react";
import { colorForLabel } from "@/lib/mock/labels";
import { pct } from "@/lib/format";
import { STATE } from "@/lib/theme";
import type { SplatStatus } from "@/lib/types";

export function Chip({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "machine" | "memory" | "signal" | "compute" | "warn" | "fail";
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-ink-600 text-fog-300",
    machine: "border-machine-500/45 text-machine-300 bg-machine-500/10",
    memory: "border-memory-500/45 text-memory-300 bg-memory-500/10",
    signal: "border-signal-500/45 text-signal-400 bg-signal-500/10",
    compute: "border-compute-500/45 text-compute-400 bg-compute-500/10",
    warn: "border-warn-400/45 text-warn-400 bg-warn-400/10",
    fail: "border-fail-400/45 text-fail-400 bg-fail-400/10",
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A detected label with its family color — the visual link to the timeline. */
export function LabelDot({ label, size = 6 }: { label: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: colorForLabel(label) }}
    />
  );
}

export function ConfidenceBar({ value, width = 34 }: { value: number; width?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`peak confidence ${pct(value)}`}
      aria-label={`confidence ${pct(value)}`}
    >
      <span
        className="relative inline-block h-1 overflow-hidden rounded-full bg-ink-600"
        style={{ width }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-machine-400"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="tnum font-mono text-[10px] text-fog-400">{value.toFixed(2)}</span>
    </span>
  );
}

/**
 * `processing` is violet rather than amber: amber is the memory layer (music,
 * moments), and a "still reconstructing" chip sitting next to a music badge in
 * the same amber was ambiguous. Violet reads as computing, and it is the hue the
 * design already uses for splat visuals.
 */
const SPLAT_TONE: Record<SplatStatus, "signal" | "compute" | "fail"> = {
  ready: "signal",
  processing: "compute",
  failed: "fail",
};

const SPLAT_DOT: Record<SplatStatus, string> = {
  ready: STATE.signal,
  processing: STATE.compute,
  failed: STATE.fail,
};

const SPLAT_TEXT: Record<SplatStatus, string> = {
  ready: "splat ready",
  processing: "reconstructing",
  failed: "splat failed",
};

export function SplatStatusChip({ status }: { status: SplatStatus }) {
  return (
    <Chip tone={SPLAT_TONE[status]}>
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          status === "processing" ? "animate-pulse" : ""
        }`}
        style={{ background: SPLAT_DOT[status] }}
      />
      {SPLAT_TEXT[status]}
    </Chip>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "default" | "machine" | "memory";
}) {
  const valueTone =
    tone === "machine" ? "text-machine-300" : tone === "memory" ? "text-memory-300" : "text-fog-100";
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-fog-400">
        {label}
      </div>
      <div className={`tnum mt-1 truncate text-xl font-semibold sm:text-2xl ${valueTone}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-fog-400">{sub}</div>}
    </div>
  );
}

export function SectionHeading({
  children,
  hint,
  right,
}: {
  children: ReactNode;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-fog-100">{children}</h2>
        {hint && <p className="text-xs text-fog-400">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/** Stage label used to make the three pipeline stages legible everywhere. */
export function StageTag({ n, name }: { n: 1 | 2 | 3; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fog-400">
      <span className="rounded border border-ink-600 px-1 text-machine-400">{n}</span>
      {name}
    </span>
  );
}
