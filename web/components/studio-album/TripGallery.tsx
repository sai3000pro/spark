/**
 * The trip shelf — every authored walk as a selectable print, in the same
 * register as the album's grid (paper ground, pine ink, brass accent, specimen
 * tags). Each card is a plain <Link> into /trip/<id>, the atlas view of that
 * walk.
 *
 * Unlike the album, this is a pure SERVER render: the trips are hardcoded
 * (listAllTrips → TRIP_SPECS), so there is nothing to poll, edit, or hydrate.
 * The cover is the first moment's keyframe; when it has no image we fall back to
 * a hue-tinted plate so the shelf never shows a broken frame.
 */
import Link from "next/link";
import { compactNumber, distance, duration } from "@/lib/format";
import type { TripListItem } from "@/lib/tripData";

export function TripGallery({ trips }: { trips: TripListItem[] }) {
  if (trips.length === 0) {
    return <p className="fnote max-w-md text-ink-faint">No trips yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip) => (
        <TripCard key={trip.id} trip={trip} />
      ))}
    </div>
  );
}

function TripCard({ trip }: { trip: TripListItem }) {
  const cover = trip.momentThumbs[0];
  const region = [trip.region, trip.country].filter(Boolean).join(", ");

  return (
    <Link
      href={`/trip/${trip.id}`}
      className="ink-halo group relative block overflow-hidden rounded-md bg-vellum"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-milk">
        {cover?.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated placeholder / mock frame, not a Next asset
          <img
            src={cover.url}
            alt={trip.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={cover?.hue != null ? { background: `hsl(${cover.hue} 38% 82%)` } : undefined}
          >
            <span className="fnote text-ink-faint">[ {trip.placeLabel} ]</span>
          </div>
        )}

        {/* Hover veil + the way in. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-pine/85 via-pine/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div className="p-3">
            <span className="pill-brass px-3.5 py-1.5 text-[12.5px]">Open walk →</span>
          </div>
        </div>
      </div>

      <div className="px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="truncate font-display text-[15px] font-semibold text-ink"
              title={trip.title}
            >
              {trip.title}
            </h2>
            <p className="fnote mt-0.5 flex items-center gap-1.5 truncate text-ink-faint">
              <span className="text-brass-deep" aria-hidden>
                ◈
              </span>
              {region ? `${trip.placeLabel} · ${region}` : trip.placeLabel}
            </p>
          </div>
          <span className="fnote shrink-0 text-brass-deep" title="Moments kept">
            [ {trip.stats.momentCount} ]
          </span>
        </div>
        <p className="fnote mt-1.5 truncate text-ink-faint">
          {distance(trip.stats.distanceM)} · {duration(trip.stats.durationSec)} ·{" "}
          {compactNumber(trip.stats.distinctObjectCount)} objects
        </p>
      </div>
    </Link>
  );
}
