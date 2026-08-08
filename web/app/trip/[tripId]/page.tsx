import { notFound } from "next/navigation";
import { TopBar } from "@/components/shell/TopBar";
import { TripExplorer } from "@/components/trip/TripExplorer";
import { compactNumber, distance, duration, tripDate } from "@/lib/format";
import { buildTrip } from "@/lib/mock/trip-waterloo-park";
import { getObjectIndexView, getTripView } from "@/lib/tripData";
import { buildTripQA } from "@/lib/tripQA";

export default async function TripPage({ params }: PageProps<"/trip/[tripId]">) {
  const { tripId } = await params;
  const trip = getTripView();
  if (trip.id !== tripId) notFound();

  const { stats } = trip;
  const { entries } = getObjectIndexView();
  // Precomputed on the server so the chat panel never ships full transcripts.
  const qa = buildTripQA(buildTrip().trip.moments);

  return (
    <>
      <TopBar
        backHref="/"
        title={trip.title}
        subtitle={`${tripDate(trip.startedAt)} · ${stats.momentCount} moments`}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-5">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <p className="eyebrow text-machine-400">
              {trip.placeLabel}, {trip.region}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold leading-tight text-fog-100">
              {trip.title}
            </h1>
            <p className="tnum mt-1 font-mono text-[11px] text-fog-400">
              {duration(stats.durationSec)} · {distance(stats.distanceM)} ·{" "}
              {compactNumber(stats.detectionCount)} detections
            </p>
          </div>

          <dl className="scrollbar-thin flex shrink-0 gap-5 overflow-x-auto">
            <Stat label="moments" value={String(stats.momentCount)} tone="memory" />
            <Stat
              label="splats"
              value={`${stats.splatsReady}/${stats.momentCount}`}
              tone="memory"
            />
            <Stat label="candidates" value={String(stats.candidateCount)} />
            <Stat label="objects" value={String(stats.distinctObjectCount)} />
          </dl>
        </header>

        <TripExplorer trip={trip} index={entries} qa={qa} />
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "memory";
}) {
  return (
    <div className="shrink-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog-400">{label}</dt>
      <dd
        className={`tnum mt-0.5 font-display text-xl font-bold ${
          tone === "memory" ? "text-memory-400" : "text-machine-400"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
