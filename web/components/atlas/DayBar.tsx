"use client";

/**
 * The day bar: a floating transport that re-walks the day.
 *
 * The timeline is drawn like the journal's own instruments: a pen-line rail
 * with quarter-hour ticks, a brass highlighter fill that grows to the
 * playhead, a clay nib riding its front edge, and the kept moments planted on
 * the rail as miniature pennant flags at their true time of day — the map's
 * specimen banners in shorthand (the rail already speaks the clock, so the
 * pennants stay wordless until hovered). The range input is still the
 * scrubber — it lies invisible over the rail, so the whole thing stays
 * keyboard-accessible (the rail wears the clay focus ring on its behalf).
 */
import { PlayGlyph } from "@/components/system/ui";
import { timecode } from "@/lib/format";
import { inkForMoment } from "@/lib/theme";
import type { MomentSummary } from "@/lib/tripData";

interface Props {
  durationSec: number;
  playhead: number | null;
  playing: boolean;
  moments: MomentSummary[];
  /** Wall-clock labels ("19:42"), aligned with `moments` — the slips show them. */
  clocks: string[];
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
  clocks,
  activeId,
  replaySpeed,
  onPlayToggle,
  onScrub,
  onHover,
  onOpen,
}: Props) {
  const t = playhead ?? 0;
  const pct = durationSec > 0 ? (t / durationSec) * 100 : 0;

  // Quarter-hour ticks; every fourth (the hour) cuts deeper.
  const ticks: { pct: number; hour: boolean }[] = [];
  for (let s = 900; s < durationSec; s += 900) {
    ticks.push({ pct: (s / durationSec) * 100, hour: s % 3600 === 0 });
  }

  return (
    // No overflow clip — the pennants' hover slips float above the plate.
    <div className="plate-vellum papergrain pointer-events-auto relative flex items-center gap-4 px-4 py-3 sm:gap-5 sm:px-5">
      <button
        type="button"
        onClick={onPlayToggle}
        aria-label={playing ? "Pause the replay" : "Replay the day"}
        className="relative z-[2] shrink-0 rounded-full transition-transform duration-300 ease-(--ease-signature) hover:scale-105 active:scale-95"
      >
        <PlayGlyph size={44} paused={playing} />
      </button>

      {/* The clock, set in typewriter. */}
      <div className="relative z-[2] hidden w-[76px] shrink-0 flex-col gap-0.5 sm:flex">
        <span className="fnote text-[11.5px] text-ink">{timecode(t)}</span>
        <span className="fnote text-[9.5px] text-ink-faint">/ {timecode(durationSec)}</span>
      </div>

      {/* ── The rail ──────────────────────────────────────────────────────── */}
      <div className="relative h-[52px] min-w-0 flex-1">
        {/* Baseline + ticks — the instrument's ruling. */}
        <span aria-hidden className="absolute inset-x-0 bottom-[17px] h-px bg-ink/30" />
        {ticks.map(({ pct: p, hour }, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute w-px bg-ink/25"
            style={{ left: `${p}%`, bottom: hour ? 7 : 11, height: hour ? 10 : 6 }}
          />
        ))}
        <span aria-hidden className="absolute bottom-[7px] left-0 h-[10px] w-px bg-ink/40" />
        <span aria-hidden className="absolute bottom-[7px] right-0 h-[10px] w-px bg-ink/40" />

        {/* The replay's highlighter fill and the pen nib at its front. */}
        {playhead !== null && (
          <>
            <span
              aria-hidden
              className="absolute bottom-[15.5px] left-0 h-[4px] rounded-full bg-brass"
              style={{ width: `${pct}%`, opacity: 0.95 }}
            />
            <span
              aria-hidden
              className={`absolute bottom-[9px] h-[18px] w-[2px] -translate-x-1/2 rounded-full bg-clay ${playing ? "nib-live" : ""}`}
              style={{ left: `${pct}%` }}
            />
            <span
              aria-hidden
              className="absolute bottom-[25px] h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-clay"
              style={{ left: `${pct}%`, boxShadow: "0 0 0 1.5px var(--color-paper)" }}
            />
          </>
        )}

        {/* The scrubber itself — invisible, but real. */}
        <input
          type="range"
          min={0}
          max={Math.round(durationSec)}
          step={1}
          value={Math.round(t)}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Scrub the day"
          className="peer absolute inset-x-0 bottom-0 z-[1] h-9 w-full cursor-pointer opacity-0"
        />

        {/* Focus ring worn on the input's behalf (peer ⇒ must follow it). */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-x-2 inset-y-0 rounded-[8px] outline-2 outline-offset-2 outline-clay [outline-style:none] peer-focus-visible:[outline-style:solid]"
        />

        {/* The kept moments — miniature pennant flags planted on the rail at
            their true time of day. The rail speaks the clock, so the flags
            stay wordless; hovering one lifts a vellum slip with the details. */}
        {moments.map((m, i) => {
          const p = (m.tStart / durationSec) * 100;
          const ink = inkForMoment(i);
          const on = activeId === m.id;
          const unreached = playhead !== null && m.tStart > t;
          const hollow = unreached && !on;
          return (
            <button
              key={m.id}
              type="button"
              onMouseEnter={() => onHover(m.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onOpen(m.id)}
              aria-label={`Open moment ${i + 1}, ${clocks[i] ?? ""}: ${m.title}`}
              className="absolute bottom-[17px] z-[2] block h-[24px] w-[14px] transition-transform duration-300 ease-(--ease-signature)"
              style={{
                left: `${p}%`,
                transform: `translateX(-1px) scale(${on ? 1.25 : 1})`,
                transformOrigin: "bottom left",
                opacity: hollow ? 0.45 : 1,
              }}
            >
              {/* The staff. */}
              <span
                aria-hidden
                className="absolute bottom-0 left-0 w-px"
                style={{ height: 22, background: ink.deep }}
              />
              {/* The pennant, flying off the staff. */}
              <span
                aria-hidden
                className="absolute left-[1px] top-[1px] block"
                style={{
                  width: 11,
                  height: 10,
                  background: ink.deep,
                  clipPath: "polygon(0 0, 100% 32%, 0 64%)",
                }}
              />
              {on && (
                <span
                  aria-hidden
                  className="sonar absolute left-[-5px] top-[-1px] rounded-full"
                  style={{ width: 12, height: 12, boxShadow: `0 0 0 1.5px ${ink.deep}` }}
                />
              )}
              {/* The slip — clock and title on vellum, pinned above the rail. */}
              {on && (
                <span
                  className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 flex w-max -translate-x-1/2 items-baseline gap-2 rounded-[6px] px-2.5 py-1.5"
                  style={{
                    background: "var(--color-vellum)",
                    boxShadow: "var(--ring-ink), 0 8px 20px rgb(27 27 24 / 0.2)",
                    animation: "takeover 0.3s var(--ease-signature) both",
                  }}
                >
                  <span className="fnote text-[9px]" style={{ color: ink.deep }}>
                    [ {clocks[i] ?? ""} ]
                  </span>
                  <span className="text-[11.5px] font-semibold text-ink">{m.title}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative z-[2] hidden w-[170px] shrink-0 flex-col items-end gap-1 text-right md:flex">
        <span className="fnote whitespace-nowrap text-[9.5px]" style={{ color: playing ? "var(--color-moss)" : "var(--color-ink-faint)" }}>
          {playing ? `[ replaying · ${replaySpeed}× ]` : "[ paused ]"}
        </span>
        <span className="tag text-[11px] text-ink-soft">
          {playing ? "The pen is re-drawing the walk" : "Press play to re-walk the day"}
        </span>
      </div>
    </div>
  );
}
