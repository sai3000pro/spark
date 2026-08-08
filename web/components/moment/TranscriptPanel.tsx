"use client";

import { timecode } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";

interface Props {
  transcript: TranscriptSegment[];
  /** Segment ids to highlight — set by the Q&A panel's citations. */
  highlightIds?: string[];
  activeSegmentId?: string | null;
  onSeek?: (t: number, segmentId: string) => void;
}

export function TranscriptPanel({ transcript, highlightIds, activeSegmentId, onSeek }: Props) {
  if (!transcript.length) {
    return <p className="text-[12px] text-fog-400">No speech was captured in this moment.</p>;
  }

  const highlighted = new Set(highlightIds ?? []);

  return (
    <ol className="scrollbar-thin max-h-96 space-y-0.5 overflow-y-auto pr-1">
      {transcript.map((seg) => {
        const isHighlighted = highlighted.has(seg.id);
        const isActive = activeSegmentId === seg.id;
        return (
          <li key={seg.id} id={`seg-${seg.id}`}>
            <button
              type="button"
              onClick={() => onSeek?.(seg.t, seg.id)}
              className={`flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isActive
                  ? "bg-memory-500/15"
                  : isHighlighted
                    ? "bg-machine-500/12"
                    : "hover:bg-ink-800/60"
              }`}
            >
              <span
                className={`tnum shrink-0 font-mono text-[10px] leading-5 ${
                  isHighlighted ? "text-machine-300" : "text-fog-400"
                }`}
              >
                {timecode(seg.t)}
              </span>
              <span className="min-w-0">
                <span
                  className={`text-[11px] font-medium ${
                    seg.speaker === "You" ? "text-memory-300" : "text-fog-300"
                  }`}
                >
                  {seg.speaker}
                </span>
                <span className="ml-1.5 text-[13px] leading-relaxed text-fog-100">{seg.text}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
