/** Small shared primitives. Server-safe — no hooks, no client directive. */
import type { ReactNode } from "react";
import { colorForLabel } from "@/lib/mock/labels";
import { pct } from "@/lib/format";

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
