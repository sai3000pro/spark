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
import { CLAY, PAPER, PINE, type MomentInk } from "@/lib/theme";
import type { Keyframe as KeyframeModel } from "@/lib/types";

/** The same hand-drawn ellipse the landing's pen uses — sieve, statement, index. */
const RING_PATH =
  "M8 24 C 8 9, 38 3, 62 4 C 92 5, 114 11, 113 22 C 112 35, 84 41, 56 40 C 28 39, 9 34, 8 25";

/**
 * The index mark: `01`, `02`… set in typewriter with the journal's pen circle
 * drawn around it — the same ring the landing's sieve and field-notes index
 * wear. Clay by default; pass an ink and the pen dips into the moment's own.
 */
export function NumberChip({
  n,
  ink,
  size = "md",
  className = "",
}: {
  n: number;
  /** Colored variant — the pen circles the number in the moment's pressed ink. */
  ink?: MomentInk;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-6 min-w-[26px] text-[10.5px]",
    md: "h-7 min-w-[30px] text-[11.5px]",
    lg: "h-11 min-w-[46px] text-[16px]",
  };
  const style: CSSProperties = { color: ink?.deep ?? CLAY };
  return (
    <span
      style={style}
      className={`fnote relative inline-flex items-center justify-center ${sizes[size]} ${className}`}
    >
      {String(n).padStart(2, "0")}
      <svg
        aria-hidden
        viewBox="0 0 120 44"
        preserveAspectRatio="none"
        className="pointer-events-none absolute -inset-x-[4px] -inset-y-[2px] h-[calc(100%+4px)] w-[calc(100%+8px)] overflow-visible"
      >
        <path
          d={RING_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
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
