/**
 * The journal's primitives. Server-safe — no hooks, no client directive.
 *
 * The voice is the field journal's: quiet sentence-case metadata, typewriter
 * [ TAGS ] for provenance, numbered chips stamped in the moment's pressed ink,
 * vellum cards with a fine pen-line ring, and the two pills. Every metadata
 * voice in the app speaks through these.
 */
import type { CSSProperties, ReactNode } from "react";
import { placeholderDataUri } from "@/lib/mock/placeholder";
import { colorForLabel, deepColorForLabel } from "@/lib/mock/labels";
import { PAPER, PINE, type MomentInk } from "@/lib/theme";
import type { Keyframe as KeyframeModel } from "@/lib/types";

/** The corner chip: `01`, `02`… — the index mark, stamped in pressed ink. */
export function NumberChip({
  n,
  ink,
  size = "md",
  className = "",
}: {
  n: number;
  /** Colored variant — the chip is stamped in the moment's pressed ink. */
  ink?: MomentInk;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-6 min-w-6 px-1 text-[11px] rounded-[5px]",
    md: "h-7 min-w-7 px-1.5 text-[12px] rounded-[6px]",
    lg: "h-11 min-w-11 px-2 text-[17px] rounded-[8px]",
  };
  const style: CSSProperties = ink
    ? {
        background: ink.deep,
        color: PAPER,
        boxShadow: "0 0 0 1.5px rgb(250 244 227 / 0.85), 0 1px 3px rgb(27 27 24 / 0.25)",
      }
    : { background: PINE, color: PAPER, boxShadow: "0 1px 3px rgb(27 27 24 / 0.2)" };
  return (
    <span
      style={style}
      className={`tnum inline-flex items-center justify-center font-semibold ${sizes[size]} ${className}`}
    >
      {n}
    </span>
  );
}

/** The play button face. A glyph, not a control — wrap it in the real button. */
export function PlayGlyph({
  size = 40,
  paused = false,
  ink,
  fg = PAPER,
}: {
  size?: number;
  paused?: boolean;
  /** Disc color — defaults to pine ink so it reads as a pressed seal on paper. */
  ink?: string;
  fg?: string;
}) {
  const disc = ink ?? PINE;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: disc }}
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

/** Primary action — the journal's brass pill. */
export function inkButtonClass(extra = "") {
  return `pill-brass px-4 py-2 text-[13.5px] disabled:opacity-40 ${extra}`;
}

/** Secondary — the quiet hairline pill, inked in the current text color. */
export function outlineButtonClass(extra = "") {
  return `pill-ghost text-ink px-4 py-2 text-[13px] disabled:opacity-40 ${extra}`;
}

/**
 * A detected label with its family color — always next to the label text.
 * Pressed for paper by default; `luminous` for the dark splat stage.
 */
export function LabelDot({
  label,
  size = 7,
  luminous = false,
}: {
  label: string;
  size?: number;
  luminous?: boolean;
}) {
  const color = luminous ? colorForLabel(label) : deepColorForLabel(label);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: luminous ? `0 0 6px ${color}55` : "0 0 0 1px rgb(250 244 227 / 0.9)",
      }}
    />
  );
}

/** Confidence meter — a pen-line rail with a pressed-ink fill. */
export function Meter({
  value,
  ink,
  width = 44,
}: {
  value: number;
  ink?: MomentInk;
  width?: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`peak confidence ${Math.round(value * 100)}%`}
      aria-label={`confidence ${Math.round(value * 100)}%`}
    >
      <span
        className="relative inline-block h-[6px] overflow-hidden rounded-full"
        style={{ width, background: "rgb(27 27 24 / 0.1)" }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: ink?.deep ?? PINE }}
        />
      </span>
      <span className="fnote text-[10px] text-ink-faint">{value.toFixed(2)}</span>
    </span>
  );
}

/**
 * A captured frame. Renders the real image when the robot's capture exists, and
 * a printed stand-in when it does not — so layout, aspect ratio, and loading
 * behaviour are identical tonight and tomorrow.
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

/** Provenance chip for frames that are stand-ins, so nobody is misled on stage. */
export function SynthNote({ className = "" }: { className?: string }) {
  return (
    <span
      className={`fnote chip chip-synth text-[10px] ${className}`}
      title="No capture uploaded yet — this frame is printed from the moment's metadata."
    >
      [ synthetic ]
    </span>
  );
}

/** Quiet metadata tag with optional ink color. */
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
