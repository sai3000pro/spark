/**
 * A trip as an album tile.
 *
 * Photos-density: the tile is the photograph and nothing else takes vertical
 * space. The month and year sit ON the cover in white; the album's name appears
 * over the bottom of the tile on hover or focus.
 *
 * The caption row that used to live under every tile is gone. With seven albums
 * across a five-column grid it cost a line of type per tile and pushed the rows
 * apart, which is most of what made the library look sparse.
 *
 * ── ALBUM TILES vs MOMENT TILES ──────────────────────────────────────────────
 * Both levels are square, so the distinction is carried by three rules that
 * MomentTile.tsx repeats:
 *
 *   1. OVERLAY   album = a date, top-left. moment = a timecode pill, bottom-left,
 *                plus status dots top-right.
 *   2. RADIUS    album 12px (rounded-xl). moment 12/16px with the responsive step.
 *   3. CAPTION   album reveals its title on hover. moment never shows text.
 *
 * A bare square with a date on it is an album. A square with a glass pill on it
 * is a moment.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Server-safe — every interaction is CSS.
 */
import Link from "next/link";
import { Keyframe } from "@/components/Keyframe";
import { tileDate } from "@/lib/format";
import type { TripListItem } from "@/lib/tripData";

export function JourneyCard({ trip }: { trip: TripListItem }) {
  const cover = trip.momentThumbs[0];

  return (
    <Link
      href={`/trip/${trip.id}`}
      className="album-tile group relative block aspect-square overflow-hidden rounded-xl bg-ink-850 transition-transform duration-200 ease-out-soft active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
    >
      {cover ? (
        <Keyframe
          keyframe={{ placeholderSeed: cover.seed, hue: cover.hue, url: cover.url }}
          alt={trip.title}
          // The IMAGE scales, never the tile: at six columns, every cell growing
          // 1.5% makes the whole grid wobble.
          className="h-full w-full object-cover transition-transform duration-500 ease-out-soft group-hover:scale-[1.05]"
          width={600}
          height={600}
        />
      ) : (
        <div className="grid h-full place-items-center px-2 text-center font-mono text-[10px] text-fog-400">
          no moments kept
        </div>
      )}

      {/* Month and year, straight on the cover. A text-shadow rather than a
          scrim — a shadow costs no visual area, a scrim dims the photograph. */}
      <span className="album-tile__date">{tileDate(trip.startedAt)}</span>

      {/* The name, on hover or keyboard focus. Its gradient covers only the
          lower third, so the cover is untouched at rest. */}
      <span className="album-tile__name">
        <span className="line-clamp-2">{trip.title}</span>
        <span className="album-tile__count">
          {trip.stats.momentCount === 0
            ? "no moments kept"
            : `${trip.stats.momentCount} moment${trip.stats.momentCount === 1 ? "" : "s"}`}
        </span>
      </span>
    </Link>
  );
}
