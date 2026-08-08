import Link from "next/link";
import { TopBar } from "@/components/shell/TopBar";
import { JourneyCard } from "@/components/trip/JourneyCard";
import { compactNumber, duration } from "@/lib/format";
import { listTrips } from "@/lib/tripData";

export default function Home() {
  const trips = listTrips();

  const totals = trips.reduce(
    (acc, t) => ({
      moments: acc.moments + t.stats.momentCount,
      seconds: acc.seconds + t.stats.durationSec,
      detections: acc.detections + t.stats.detectionCount,
    }),
    { moments: 0, seconds: 0, detections: 0 },
  );

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-5">
        <header className="max-w-2xl">
          <p className="eyebrow text-machine-400">Your journeys</p>
          <h1 className="mt-1.5 font-display text-3xl font-bold leading-tight text-fog-100">
            Memory Albums
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-fog-300">
            Spark follows you, watches, listens, and decides on its own what was worth keeping.
            When you get home, the moments are already here.
          </p>
        </header>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <StatTile label="Journeys" value={String(trips.length)} />
          <StatTile label="Moments" value={String(totals.moments)} />
          <StatTile label="Captured" value={duration(totals.seconds)} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {trips.map((trip) => (
            <JourneyCard key={trip.id} trip={trip} />
          ))}

          <section className="surface flex flex-col items-center justify-center gap-1.5 rounded-2xl border-dashed p-6 text-center">
            <p className="font-display text-[14px] font-semibold text-fog-200">
              No trip in progress
            </p>
            <p className="max-w-xs text-[12px] leading-relaxed text-fog-400">
              Starting one would put Spark in follow mode and begin the stage-1 detection loop.
              It has run {compactNumber(totals.detections)} detections so far.
            </p>
            <Link
              href="/detect"
              className="mt-2 rounded-lg border border-machine-500/45 bg-machine-500/10 px-3 py-1.5 font-display text-[12px] font-semibold text-machine-300 transition-colors hover:bg-machine-500/20"
            >
              See what that loop emits →
            </Link>
          </section>
        </div>
      </main>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface rounded-xl px-3 py-3 text-center">
      <div className="tnum font-display text-xl font-bold text-machine-400">{value}</div>
      <div className="mt-0.5 font-mono text-[11px] text-fog-400">{label}</div>
    </div>
  );
}
