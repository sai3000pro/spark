/**
 * The live trip dashboard — where the blob lands after it jumps.
 *
 * A STUB, deliberately and visibly. The hero's launch sequence needs somewhere
 * to hand off to, and a handoff to nowhere is the kind of thing that quietly
 * never gets finished; this route makes the seam real and names what is missing.
 * The panel below is the contract the real dashboard has to fill.
 *
 * WHY `/live` AND NOT `/trip/live`. Two reasons, both load-bearing:
 *
 *   1. `app/trip/[tripId]` already exists and would swallow `/trip/live` as a
 *      trip whose id is the string "live".
 *   2. `app/trip/*` sits OUTSIDE this route group — it is the FIELD NOTES
 *      design, cream paper and pine ink, with no LiveTripProvider and no app
 *      bar. A live dashboard reached from the aurora hero would arrive on the
 *      wrong design system with no access to the trip state it exists to show.
 *
 * Inside `(app)` it inherits `.aurora-app`, the app bar and the provider for
 * free, and route groups add no path segment, so the URL stays `/live`.
 *
 * Stays a Server Component: the redirect below has to happen before anything
 * paints, and the counters come from the same server read the layout already
 * does. It carries no `data-hero`, so the app bar is solid here rather than
 * transparent — this is a screen, not a scene.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { RecordControl } from "@/components/shell/RecordControl";
import { getActiveTrip } from "@/lib/liveTrip";

export const metadata = {
  title: "Spark — live trip",
  description: "The session in progress.",
};

/** The store is a per-process singleton with no cache semantics to trust. */
export const dynamic = "force-dynamic";

export default function LivePage() {
  const active = getActiveTrip();

  // Nothing running means nothing to show. Home rather than a "no trip" screen:
  // the landing page already has the blob that starts one, which is the only
  // useful thing this page could offer someone who arrives without a session.
  if (!active) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="eyebrow text-brand-300">Trip in progress</p>
        <h1 className="font-hero text-3xl text-fog-100">The robot is out there</h1>
        <p className="max-w-prose text-sm text-fog-400">
          Following your walk and keeping what it finds worth keeping.
        </p>
      </header>

      <section className="surface flex flex-col gap-4 rounded-lg p-6">
        <RecordControl />
        <p className="text-sm text-fog-400">
          The live map, the detection feed and the moments as they land all belong here. None of
          it is built yet — this page exists so the hero has somewhere real to send you, and so
          the gap is visible rather than implied.
        </p>
      </section>

      <p className="text-sm text-fog-400">
        <Link href="/" className="underline underline-offset-4">
          Back to the library
        </Link>
      </p>
    </main>
  );
}
