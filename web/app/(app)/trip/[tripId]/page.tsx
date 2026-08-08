import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { TripExplorer } from "@/components/trip/TripExplorer";
import { compactNumber, distance, duration, tripDate } from "@/lib/format";
import { buildTrip } from "@/lib/mock/buildTrip";
import { getTripSpec } from "@/lib/mock/trips";
import { getObjectIndexView, getTripView } from "@/lib/tripData";
import { buildTripQA } from "@/lib/tripQA";

const TABS = ["moments", "map", "timeline", "ask"] as const;
type Tab = (typeof TABS)[number];

export default async function TripPage({ params, searchParams }: PageProps<"/trip/[tripId]">) {
  const { tripId } = await params;
  const trip = getTripView(tripId);
  const spec = getTripSpec(tripId);
  if (!trip || !spec) notFound();

  const { stats } = trip;

  // ?tab= follows the existing URL-as-state convention (?anchor=, ?chrome=off):
  // the tab is shareable and the back button works.
  const query = await searchParams;
  const requested = typeof query.tab === "string" ? query.tab : undefined;
  const initialTab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "moments";

  // Ask Spark stays scoped to the trip you are reading: its answers cite
  // trip-relative timecodes and render a nav pose in this trip's local metric
  // frame. The ⌘K palette in the app bar is the cross-trip one.
  const index = getObjectIndexView(tripId);
  // Precomputed on the server so the chat panel never ships full transcripts.
  const qa = buildTripQA(buildTrip(spec).trip.moments);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-5">
      <PageHeader
        backHref="/"
        backLabel="All albums"
        eyebrow={`${trip.placeLabel}, ${trip.region}`}
        title={trip.title}
        meta={
          <>
            {tripDate(trip.startedAt)} · {duration(stats.durationSec)} ·{" "}
            {distance(stats.distanceM)} · {compactNumber(stats.detectionCount)} detections
          </>
        }
        aside={
          <dl className="scrollbar-thin flex shrink-0 gap-5 overflow-x-auto">
            <Stat label="moments" value={String(stats.momentCount)} tone="memory" />
            <Stat label="splats" value={`${stats.splatsReady}/${stats.momentCount}`} tone="memory" />
            <Stat label="candidates" value={String(stats.candidateCount)} />
            <Stat label="objects" value={String(stats.distinctObjectCount)} />
          </dl>
        }
      />

      <TripExplorer
        trip={trip}
        index={index?.entries ?? []}
        qa={qa}
        initialTab={initialTab}
      />
    </main>
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
