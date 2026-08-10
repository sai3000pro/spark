/**
 * The trip shelf — every authored walk, laid out like the album but for whole
 * walks instead of single splats. Same journal ground as /album and /walk: cream
 * paper, pine ink, brass accent, no aurora app bar. Each card opens /trip/<id>,
 * the atlas view of that walk.
 *
 * Pure Server Component: the trips are hardcoded (listAllTrips → TRIP_SPECS), so
 * unlike the album there is no studio to poll and nothing to freeze — the shelf
 * is the same on every request.
 */
import { NavBrandSwitch } from "@/components/shell/NavBrandSwitch";
import { TripGallery } from "@/components/studio-album/TripGallery";
import { listAllTrips } from "@/lib/tripData";

export const metadata = {
  title: "Spark — trips",
  description: "Every walk Spark has mapped, ready to step back into.",
};

export default function TripIndexPage() {
  const trips = listAllTrips();

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="papergrain relative">
        <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-3 px-5 pb-6 pt-8 sm:px-8 sm:pt-12">
          <NavBrandSwitch tone="paper" />
          <p className="fnote ml-auto text-ink-faint">
            [ {trips.length} {trips.length === 1 ? "trip" : "trips"} ]
          </p>
        </header>

        <div className="gridfield relative">
          <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
            <div className="mb-8 max-w-xl">
              <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
                Trips
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                Every walk Spark has mapped. Pick one to open its atlas — the route, the
                moments, and the objects it kept along the way.
              </p>
            </div>

            <TripGallery trips={trips} />
          </section>
        </div>
      </div>
    </main>
  );
}
