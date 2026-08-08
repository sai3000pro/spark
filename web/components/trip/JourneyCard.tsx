/**
 * A trip as an album card. Cover frame with the identity overlaid on a gradient,
 * a moment-count badge, and a strip of overlapping keyframes underneath so the
 * card hints at what is inside before you open it.
 *
 * Server-safe — hover is CSS only.
 */
import Link from "next/link";
import { Keyframe } from "@/components/Keyframe";
import { compactNumber, distance, duration, tripDate } from "@/lib/format";
import type { TripListItem } from "@/lib/tripData";

export function JourneyCard({ trip }: { trip: TripListItem }) {
  const [cover, ...rest] = trip.momentThumbs;

  return (
    <Link
      href={`/trip/${trip.id}`}
      className="surface group flex flex-col overflow-hidden rounded-2xl transition-transform duration-300 ease-out-soft hover:scale-[1.015] active:scale-[0.995]"
    >
      <div className="relative h-44 overflow-hidden bg-ink-850">
        <Keyframe
          keyframe={{ placeholderSeed: cover.seed, hue: cover.hue, url: cover.url }}
          alt={trip.title}
          className="h-full w-full object-cover transition-transform duration-500 ease-out-soft group-hover:scale-105"
          width={800}
          height={480}
        />
        {/* Gradient carries the text — without it the title fights the image. */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />

        <span className="glass absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] text-machine-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-machine-400" />
          {trip.stats.momentCount} moments
        </span>

        <div className="absolute inset-x-3 bottom-3">
          <h3 className="font-display text-lg font-bold leading-tight text-fog-100">
            {trip.title}
          </h3>
          <div className="mt-0.5 flex items-center justify-between gap-3 font-mono text-[11px] text-fog-300">
            <span className="truncate">
              {trip.placeLabel}, {trip.region}
            </span>
            <span className="shrink-0">{tripDate(trip.startedAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center">
          {rest.slice(0, 3).map((thumb, i) => (
            <span
              key={i}
              className="h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-ink-900"
              style={{ marginLeft: i > 0 ? -9 : 0 }}
            >
              <Keyframe
                keyframe={{ placeholderSeed: thumb.seed, hue: thumb.hue, url: thumb.url }}
                alt=""
                className="h-full w-full object-cover"
                width={64}
                height={64}
              />
            </span>
          ))}
          <span className="tnum ml-2 truncate font-mono text-[11px] text-fog-400">
            {duration(trip.stats.durationSec)} · {distance(trip.stats.distanceM)} ·{" "}
            {compactNumber(trip.stats.detectionCount)} detections
          </span>
        </div>

        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-machine-400">
          Explore
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            <path
              d="M2 6h8M6 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </Link>
  );
}
