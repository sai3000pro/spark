"use client";

import { ConfidenceBar, LabelDot } from "@/components/ui";
import { timecode } from "@/lib/format";
import type { ObjectSighting, Vec2 } from "@/lib/types";

interface Props {
  objects: ObjectSighting[];
  selectedTrackId?: string | null;
  onSelect?: (trackId: string | null) => void;
  navTargets?: Record<string, { pos: Vec2; heading: number }>;
}

/**
 * Everything stage 1 tracked in this moment, collapsed to one row per physical
 * object. Clicking a row focuses that object's anchor in the splat — the chips and
 * the 3D view are two ways into the same ObjectSighting.
 */
export function ObjectChips({ objects, selectedTrackId, onSelect, navTargets }: Props) {
  if (!objects.length) {
    return <p className="text-[12px] text-fog-400">No objects were tracked in this window.</p>;
  }

  return (
    <ul className="scrollbar-thin max-h-80 space-y-1 overflow-y-auto pr-1">
      {objects.map((o) => {
        const selected = selectedTrackId === o.trackId;
        const locatable = !!o.worldPos;
        return (
          <li key={o.trackId}>
            <button
              type="button"
              onClick={() => onSelect?.(selected ? null : o.trackId)}
              disabled={!locatable}
              title={
                locatable
                  ? `Focus ${o.label} in 3D`
                  : "No depth estimate for this track — cannot be placed in 3D"
              }
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                selected
                  ? "border-memory-500/60 bg-memory-500/10"
                  : locatable
                    ? "border-transparent hover:border-ink-600 hover:bg-ink-800/60"
                    : "border-transparent opacity-55"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <LabelDot label={o.label} size={7} />
                  <span className="truncate text-[13px] text-fog-100">{o.label}</span>
                </span>
                <ConfidenceBar value={o.confidence} />
              </div>
              <div className="tnum mt-1 flex items-center gap-2 pl-4 font-mono text-[10px] text-fog-400">
                <span>{timecode(o.firstSeenT)}</span>
                <span className="text-ink-500">→</span>
                <span>{timecode(o.lastSeenT)}</span>
                <span className="text-ink-500">·</span>
                <span>{o.detectionCount} frames</span>
                {navTargets?.[o.trackId] && (
                  <>
                    <span className="text-ink-500">·</span>
                    <span className="text-signal-400">navigable</span>
                  </>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
