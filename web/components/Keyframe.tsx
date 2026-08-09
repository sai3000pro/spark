/**
 * A captured frame. Renders the real image when the robot's capture exists, and a
 * procedural stand-in when it does not — so layout, aspect ratio, and loading
 * behaviour are identical tonight and tomorrow. Drop files in /public/mock and set
 * `url` on the Keyframe; nothing else changes.
 */
import { placeholderDataUri } from "@/lib/mock/placeholder";
import type { Keyframe as KeyframeModel } from "@/lib/types";

interface Props {
  keyframe: Pick<KeyframeModel, "placeholderSeed" | "hue" | "url"> & { id?: string };
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}

export function Keyframe({ keyframe, alt, className = "", width = 640, height = 400 }: Props) {
  const src =
    keyframe.url ??
    placeholderDataUri({ seed: keyframe.placeholderSeed, hue: keyframe.hue, width, height });

  return (
    // Deliberately a plain <img>: the src is frequently an inline SVG data URI,
    // which next/image cannot optimize and would only warn about.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      draggable={false}
    />
  );
}

/** Small marker for frames that are stand-ins, so nobody is misled on stage. */
export function SyntheticBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`rounded-full border border-ink-600 bg-ink-950/80 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-fog-400 backdrop-blur-sm ${className}`}
      title="No capture uploaded yet — this frame is generated from the moment's metadata."
    >
      SYNTHETIC
    </span>
  );
}
