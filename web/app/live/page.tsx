import Link from "next/link";
import { LiveScreen } from "@/components/live/LiveScreen";
import { getActiveTrip } from "@/lib/liveTrip";

/**
 * Where a walk begins — either the robot is out there, or you brought footage.
 *
 * WHY `/live` AND NOT `/trip/live`: `app/trip/[tripId]` would swallow it as a
 * trip whose id is the string "live".
 *
 * It used to sit in `app/(app)` for the aurora shell's app bar and live-trip
 * provider. It is FIELD NOTES now, like every other screen you can actually
 * reach — cream paper, vellum plates, survey lettering — and it carries its own
 * provider (components/live/LiveScreen.tsx) instead of inheriting one. The
 * aurora group had become a design system with one page in it, reached from a
 * journal hero, which is a seam the user could see.
 *
 * Stays a Server Component: the counters come from the same server read the
 * landing already does, so the first paint is correct with no idle→recording
 * flash while a client poll is in flight.
 */
export const metadata = {
  title: "Spark — start a walk",
  description: "Follow a live trip, or build one from a video you already have.",
};

/** The store is a per-process singleton with no cache semantics to trust. */
export const dynamic = "force-dynamic";

export default function LivePage() {
  // No redirect when nothing is running any more. There is a real second thing
  // to do on this page now — bring a video — and bouncing someone home for the
  // absence of a robot would hide it.
  const active = getActiveTrip();

  return (
    <main className="relative mx-auto w-full max-w-4xl flex-1 px-4 pb-16 pt-6 sm:px-6">
      {/* The journal's squared page, same ground the detector bench sits on. */}
      <div aria-hidden className="gridfield papergrain pointer-events-none absolute -inset-x-24 -inset-y-6" />

      <nav className="mb-5">
        <Link href="/" className="pill-ghost px-3.5 py-2 text-[13px] text-ink">
          <span aria-hidden>←</span> Back to Spark
        </Link>
      </nav>

      <header className="rise-in mb-6 max-w-2xl">
        <span className="fnote text-[10.5px] text-moss">[ stage 1 → stage 3 · a walk, from scratch ]</span>
        <h1 className="mt-2 text-[32px] leading-[1.02] text-ink sm:text-[38px]">Start a walk</h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">
          Record with the phone in your pocket, or hand over a video you already have — the
          same pipeline finds the moments either way. A rover can carry the camera instead,
          once you have one.
        </p>
      </header>

      <div className="space-y-5">
        <LiveScreen initial={active} />
      </div>
    </main>
  );
}
