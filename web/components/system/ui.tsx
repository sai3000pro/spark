/**
 * The riso-poster primitives. Server-safe — no hooks, no client directive.
 *
 * The grammar comes from the sound-pack poster: numbered corner chips, round
 * play buttons, mono uppercase tags, chunky outlined cards. Every metadata
 * voice in the app speaks through these.
 */
import type { CSSProperties, ReactNode } from "react";
import { placeholderDataUri } from "@/lib/mock/placeholder";
import { colorForLabel } from "@/lib/mock/labels";
import { CREAM_BRIGHT, INK, type RisoInk } from "@/lib/theme";
import type { Keyframe as KeyframeModel } from "@/lib/types";

/** The corner chip: `01`, `02`… — the poster's signature index mark. */
export function NumberChip({
  n,
  ink,
  size = "md",
  className = "",
}: {
  n: number;
  /** Colored variant — chip takes the drum ink, numeral goes cream. */
  ink?: RisoInk;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-6 min-w-6 px-1 text-[11px] rounded-[6px]",
    md: "h-8 min-w-8 px-1.5 text-[13px] rounded-[8px]",
    lg: "h-12 min-w-12 px-2 text-[20px] rounded-[10px]",
  };
  const style: CSSProperties = ink
    ? { background: ink.base, color: CREAM_BRIGHT, borderColor: INK }
    : { background: CREAM_BRIGHT, color: INK, borderColor: INK };
  return (
    <span
      style={style}
      className={`tnum inline-flex items-center justify-center border-[1.5px] font-mono font-bold ${sizes[size]} ${className}`}
    >
      {String(n).padStart(2, "0")}
    </span>
  );
}

/** The round play button. A glyph, not a control — wrap it in the real button. */
export function PlayGlyph({
  size = 40,
  paused = false,
  ink = INK,
  fg = CREAM_BRIGHT,
}: {
  size?: number;
  paused?: boolean;
  ink?: string;
  fg?: string;
}) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: ink, border: `1.5px solid ${INK}` }}
    >
      {paused ? (
        <svg width={size * 0.3} height={size * 0.34} viewBox="0 0 10 12" fill={fg}>
          <rect x="0" y="0" width="3.4" height="12" rx="1" />
          <rect x="6.6" y="0" width="3.4" height="12" rx="1" />
        </svg>
      ) : (
        <svg
          width={size * 0.32}
          height={size * 0.34}
          viewBox="0 0 11 12"
          fill={fg}
          style={{ marginLeft: size * 0.06 }}
        >
          <path d="M0 1.2C0 .3 1 -.25 1.8.22l8.6 4.8c.8.45.8 1.5 0 1.96L1.8 11.8C1 12.25 0 11.7 0 10.8V1.2z" />
        </svg>
      )}
    </span>
  );
}

/** Chunky primary button — ink pill, cream text, springy press. */
export function inkButtonClass(extra = "") {
  return `inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 font-display text-[14px] font-bold text-cream-bright transition-transform duration-200 ease-(--ease-pop) hover:scale-[1.03] active:scale-[0.96] disabled:opacity-40 disabled:hover:scale-100 ${extra}`;
}

/** Secondary — outlined on cream. */
export function outlineButtonClass(extra = "") {
  return `inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-ink/50 px-4 py-2 font-display text-[13px] font-bold text-ink transition-all duration-200 ease-(--ease-pop) hover:border-ink hover:scale-[1.03] active:scale-[0.96] ${extra}`;
}

/** A detected label with its family color — always next to the label text. */
export function LabelDot({ label, size = 7 }: { label: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full border border-ink/40"
      style={{ width: size, height: size, background: colorForLabel(label) }}
    />
  );
}

/** Chunky confidence meter. */
export function Meter({
  value,
  ink,
  width = 44,
}: {
  value: number;
  ink?: RisoInk;
  width?: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`peak confidence ${Math.round(value * 100)}%`}
      aria-label={`confidence ${Math.round(value * 100)}%`}
    >
      <span
        className="relative inline-block h-[7px] overflow-hidden rounded-full border border-ink/35 bg-cream-deep"
        style={{ width }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: ink?.base ?? INK }}
        />
      </span>
      <span className="tag text-[10px] text-ink-soft">{value.toFixed(2)}</span>
    </span>
  );
}

/**
 * A captured frame. Renders the real image when the robot's capture exists, and
 * a riso-printed stand-in when it does not — so layout, aspect ratio, and
 * loading behaviour are identical tonight and tomorrow.
 */
export function KeyframeImg({
  keyframe,
  alt,
  className = "",
  width = 640,
  height = 400,
}: {
  keyframe: Pick<KeyframeModel, "placeholderSeed" | "hue" | "url"> & { id?: string };
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const src =
    keyframe.url ??
    placeholderDataUri({ seed: keyframe.placeholderSeed, hue: keyframe.hue, width, height });

  return (
    // Deliberately a plain <img>: the src is frequently an inline SVG data URI,
    // which next/image cannot optimize and would only warn about.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={width} height={height} className={className} draggable={false} />
  );
}

/** Small marker for frames that are stand-ins, so nobody is misled on stage. */
export function SynthNote({ className = "" }: { className?: string }) {
  return (
    <span
      className={`tag rounded-[6px] border-[1.5px] border-ink/40 bg-cream-bright/90 px-1.5 py-0.5 text-[9px] text-ink-soft ${className}`}
      title="No capture uploaded yet — this frame is printed from the moment's metadata."
    >
      synthetic
    </span>
  );
}

/** Mono uppercase tag with optional drum-ink color. */
export function InkTag({
  children,
  color,
  className = "",
  title,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span title={title} className={`tag ${className}`} style={color ? { color } : undefined}>
      {children}
    </span>
  );
}
