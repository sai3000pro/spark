/**
 * The album grid. One dense, flat grid, newest first.
 *
 * There used to be a month header above each group. With seven albums spread
 * over five months that produced five rows of one or two tiles each — the live
 * page read "FEBRUARY · 1 journey" above a single tile with 85% of the row
 * empty. Month grouping is right for a library of hundreds and wrong for seven,
 * and every tile now carries its own month and year on the cover anyway, which
 * is strictly more information than the headers gave.
 *
 * Three columns at the base breakpoint matches the Photos library on a phone —
 * and the base breakpoint IS the phone design, because `sm:` and above never
 * resolve inside the 362px DeviceFrame iframe.
 *
 * ── IT STOPS AT FOUR COLUMNS ────────────────────────────────────────────────
 * The ladder used to run 3 / 4 / 5 / 6 / 7. On a desktop that put seven tiles in
 * a row at 167px each — and a tile whose own comment says "the tile IS the
 * photograph" cannot be 167px wide, because at that size the cover is a swatch
 * and the date on it is the only thing you can actually read. Four columns give
 * the same tiles ~300px, which is where the artwork starts being a picture.
 *
 * It also stops the orphan. Eight albums across seven columns is a full row and
 * then a single tile marooned on the next one with 86% of it empty — the exact
 * ragged ending the month headers were removed for. Four columns divides the
 * current library evenly, and for any other count a trailing row of up to three
 * still reads as a row rather than as a mistake.
 *
 * Gaps are symmetric now. The old asymmetric row gap existed only to bind a
 * caption to the tile above it; with the captions gone it would just look like
 * a mistake.
 *
 * Server component — the tiles are never bundled to the client. RevealGrid takes
 * them as `children` precisely so that stays true.
 */
import { RevealGrid } from "@/components/album/RevealGrid";
import { JourneyCard } from "@/components/trip/JourneyCard";
import type { TripListItem } from "@/lib/tripData";

export function AlbumGallery({ trips }: { trips: TripListItem[] }) {
  const newestFirst = [...trips].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );

  return (
    <RevealGrid className="grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-4 xl:gap-3">
      {newestFirst.map((trip) => (
        <JourneyCard key={trip.id} trip={trip} />
      ))}
    </RevealGrid>
  );
}
