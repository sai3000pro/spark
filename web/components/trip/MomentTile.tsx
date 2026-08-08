"use client";

/**
 * One moment, as a square in the album grid.
 *
 * Square inside an album, portrait for album covers — that is how Photos
 * distinguishes the two levels, and it costs nothing to borrow.
 *
 * No title on the tile. Text over a photo needs a scrim and a grid of scrimmed
 * thumbnails is noise; the title lives in the panel, and the tile carries it in
 * `aria-label` and `title` so it is still reachable and still announced.
 *
 * Owns nothing — hover and selection belong to TripExplorer, which is what makes
 * the grid, the map pins, the timeline and the panel highlight together.
 */
import { Keyframe } from "@/components/Keyframe";
import { clockTime } from "@/lib/format";
import type { MomentSummary } from "@/lib/tripData";

interface Props {
  moment: MomentSummary;
  tripStartedAt: string;
  hovered: boolean;
  selected: boolean;
  /** Outside the scrubber window — dimmed rather than removed, so the grid never reflows. */
  dimmed: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export function MomentTile({
  moment,
  tripStartedAt,
  hovered,
  selected,
  dimmed,
  onHover,
  onSelect,
}: Props) {
  const on = hovered || selected;

  return (
    <button
      type="button"
      onMouseEnter={() => onHover(moment.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(moment.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(moment.id)}
      aria-pressed={selected}
      aria-label={`${moment.title} — ${clockTime(tripStartedAt, moment.tStart)} at ${moment.placeLabel}`}
      title={moment.title}
      className={`group relative aspect-square overflow-hidden rounded-xl bg-ink-850 transition-all duration-200 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-machine-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 sm:rounded-2xl ${
        on ? "ring-1 ring-machine-400/50" : "ring-0"
      } ${dimmed ? "opacity-30 saturate-50" : "opacity-100"}`}
    >
      <Keyframe
        keyframe={{
          placeholderSeed: moment.thumbnailSeed,
          hue: moment.thumbnailHue,
          url: moment.thumbnailUrl,
        }}
        alt=""
        className={`h-full w-full object-cover transition-transform duration-500 ease-out-soft ${
          on ? "scale-[1.03]" : "scale-100"
        }`}
        width={400}
        height={400}
      />

      <span className="glass tnum absolute bottom-2 left-2 rounded-full px-2 py-0.5 font-mono text-[10px] text-fog-200">
        {clockTime(tripStartedAt, moment.tStart)}
      </span>

      {/* Amber = has music, everywhere in the app. Violet = still reconstructing.
          Rose = reconstruction failed. One symbol, one meaning, every screen. */}
      <span className="absolute right-2 top-2 flex items-center gap-1">
        {moment.splatStatus !== "ready" && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background:
                moment.splatStatus === "processing"
                  ? "var(--color-compute-400)"
                  : "var(--color-fail-400)",
            }}
            title={
              moment.splatStatus === "processing"
                ? "Reconstruction still running"
                : "Reconstruction failed"
            }
          />
        )}
        {moment.hasMusic && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-memory-400"
            title={moment.music ? `${moment.music.trackName} — ${moment.music.artist}` : "Has music"}
          />
        )}
      </span>
    </button>
  );
}
