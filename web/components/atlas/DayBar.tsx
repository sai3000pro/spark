"use client";

/**
 * The day bar: a floating transport that re-walks the day.
 *
 * Press play and the robot travels its odometry on the map at 120× while the
 * clock runs; the numbered chips sit at their true position in the day, jump
 * the playhead when clicked, and light up as the playhead passes them. The
 * range input IS the scrubber, so the whole thing is keyboard-accessible.
 */
import { NumberChip, PlayGlyph } from "@/components/system/ui";
import { timecode } from "@/lib/format";
import { inkForMoment } from "@/lib/theme";
import type { MomentSummary } from "@/lib/tripData";

interface Props {
  durationSec: number;
  playhead: number | null;
  playing: boolean;
  moments: MomentSummary[];
  activeId: string | null;
  replaySpeed: number;
  onPlayToggle: () => void;
  onScrub: (t: number) => void;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}

export function DayBar({
  durationSec,
  playhead,
  playing,
  moments,
  activeId,
  replaySpeed,
  onPlayToggle,
  onScrub,
  onHover,
  onOpen,
}: Props) {
  const t = playhead ?? 0;

  return (
    <div className="plate-vellum papergrain pointer-events-auto relative flex items-center gap-3 overflow-hidden px-3.5 py-3 sm:gap-4 sm:px-5">
      <button
        type="button"
        onClick={onPlayToggle}
        aria-label={playing ? "Pause the replay" : "Replay the day"}
        className="relative z-[2] shrink-0 rounded-full transition-transform duration-300 ease-(--ease-signature) hover:scale-105 active:scale-95"
      >
        <PlayGlyph size={42} paused={playing} />
      </button>

      <div className="min-w-0 flex-1">
        {/* The chips ride ABOVE the track at their true time-of-day position. */}
        <div className="relative mb-2 h-7">
          {moments.map((m, i) => {
            const pct = (m.tStart / durationSec) * 100;
            const on = activeId === m.id;
            const unreached = playhead !== null && m.tStart > t;
            return (
              <button
                key={m.id}
                type="button"
                onMouseEnter={() => onHover(m.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onOpen(m.id)}
                aria-label={`Open moment ${i + 1}: ${m.title}`}
                className="absolute top-0 -translate-x-1/2 transition-all duration-300 ease-(--ease-signature)"
                style={{
                  left: `${pct}%`,
                  transform: `translateX(-50%) scale(${on ? 1.25 : 1})`,
                  opacity: unreached && !on ? 0.35 : 1,
                  zIndex: on ? 2 : 1,
                }}
              >
                <NumberChip n={i + 1} ink={inkForMoment(i)} size="sm" />
              </button>
            );
          })}
        </div>

        <input
          type="range"
          min={0}
          max={Math.round(durationSec)}
          step={1}
          value={Math.round(t)}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Scrub the day"
          className="scrub-paper w-full"
        />
      </div>

      <div className="hidden shrink-0 flex-col items-end sm:flex">
        <span className="fnote text-[11px] text-ink">
          {timecode(t)} <span className="text-ink-faint">/ {timecode(durationSec)}</span>
        </span>
        <span className="tag mt-1 text-[11px] text-ink-soft">
          {playing ? `Replaying · ${replaySpeed}×` : "Press play to re-walk the day"}
        </span>
      </div>
    </div>
  );
}
