"use client";

/**
 * The selected-moment panel: bottom sheet on mobile, floating card over the map on
 * desktop. This is the design's `MomentPanel`, with one change — "Relive in 3D"
 * is a <Link> to the moment route rather than a modal, because the moment URL with
 * `?anchor=<trackId>` is what the object search hands off to. A modal has no
 * address to deep-link.
 */
import Link from "next/link";
import { Keyframe } from "@/components/Keyframe";
import { NowPlaying } from "@/components/moment/NowPlaying";
import { SplatStatusChip } from "@/components/ui";
import { clockTime, duration } from "@/lib/format";
import type { MomentSummary } from "@/lib/tripData";

interface Props {
  moment: MomentSummary;
  tripId: string;
  tripStartedAt: string;
  onClose: () => void;
}

export function MomentPanel({ moment, tripId, tripStartedAt, onClose }: Props) {
  return (
    <div className="glass-raised flex flex-col rounded-2xl">
      {/* Grab handle, mobile only — signals the sheet is dismissible. */}
      <div className="flex justify-center pb-1 pt-2.5 md:hidden">
        <span className="h-1 w-10 rounded-full bg-white/15" />
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 max-md:pt-1">
        <span className="eyebrow">Selected moment</span>
        <button
          type="button"
          onClick={onClose}
          className="text-fog-400 transition-colors hover:text-fog-100"
          aria-label="Close moment panel"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 px-4 pb-4">
        <div className="flex gap-3">
          <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-ink-850">
            <Keyframe
              keyframe={{
                placeholderSeed: moment.thumbnailSeed,
                hue: moment.thumbnailHue,
                url: moment.thumbnailUrl,
              }}
              alt={moment.title}
              className="h-full w-full object-cover"
              width={240}
              height={200}
            />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[15px] font-bold leading-tight text-fog-100">
              {moment.title}
            </h3>
            <div className="tnum mt-0.5 font-mono text-[11px] text-fog-400">
              {clockTime(tripStartedAt, moment.tStart)} ·{" "}
              {duration(moment.tEnd - moment.tStart)}
            </div>
            <div className="mt-1.5">
              <SplatStatusChip status={moment.splatStatus} />
            </div>
          </div>
        </div>

        <Link
          href={`/trip/${tripId}/moment/${moment.id}`}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-machine-400 px-3 py-2 font-display text-[13px] font-semibold text-ink-950 transition-opacity hover:opacity-90"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 6l2.4-1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Relive in 3D
        </Link>

        {moment.transcriptPreview && (
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-machine-400" />
              <span className="eyebrow text-[10px]">Transcript</span>
            </div>
            <p className="line-clamp-2 text-[12px] italic leading-relaxed text-fog-300">
              {moment.transcriptPreview}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-fog-400">
          <span className="truncate">{moment.placeLabel}</span>
          <span className="tnum">{moment.objectCount} objects</span>
          {moment.transcriptSegmentCount > 0 && (
            <span className="tnum">{moment.transcriptSegmentCount} lines</span>
          )}
        </div>

        <NowPlaying music={moment.music} vibe={moment.vibe} compact />
      </div>
    </div>
  );
}
