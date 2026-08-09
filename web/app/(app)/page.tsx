/**
 * The landing page: the scene, then the library.
 *
 * One page, two modes. The hero fills exactly one viewport and the album grid
 * sits directly beneath it, reached by scrolling or by the cue's #albums anchor.
 * The transition between them is a DENSITY change — empty and centred, then
 * dense and gridded — not a colour change, which is why there is no fade at the
 * seam, only a hairline. A gradient there would also fight the hero's own scrim.
 *
 * PageHeader is gone from this route (it still serves /globe, /detect and
 * /trip/[tripId]). The hero carries the <h1>; a second title block 900 pixels
 * below it would say the same thing twice and put two <h1>s on one page. The one
 * part worth keeping — the mono totals line — moved into LibraryHeader.
 *
 * Stays a Server Component. `data-hero` is the hook the app bar uses to go
 * transparent over the scene.
 */
import { AlbumGallery } from "@/components/album/AlbumGallery";
import { EmptyLibrary } from "@/components/album/EmptyLibrary";
import { LibraryHeader } from "@/components/album/LibraryHeader";
import { TripSessionCard } from "@/components/album/TripSessionCard";
import { LandingHero } from "@/components/hero/LandingHero";
import { WhatItDoes } from "@/components/home/WhatItDoes";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { listAllTrips } from "@/lib/tripData";

export const metadata = {
  title: "Spark — you enjoy the journey",
  description:
    "Spark rolls right behind you, capturing spontaneous 3D memories you can step back into long after the trip is over.",
};

export default function HomePage() {
  const trips = listAllTrips();

  const totals = trips.reduce(
    (acc, t) => ({
      moments: acc.moments + t.stats.momentCount,
      seconds: acc.seconds + t.stats.durationSec,
      detections: acc.detections + t.stats.detectionCount,
    }),
    { moments: 0, seconds: 0, detections: 0 },
  );

  return (
    <main data-hero className="flex-1">
      <LandingHero />

      {/* The answer to the headline, before the evidence for it. The hero makes
          three claims and this is where they are actually explained; putting the
          album grid first would show the OUTPUT of a product the visitor has not
          been told about yet. */}
      <WhatItDoes />

      {/* tabIndex={-1} so the scroll cue moves keyboard FOCUS here, not just the
          viewport. Without it the cue scrolls the page but leaves focus back in
          the hero, and the next Tab throws you to the top — the classic broken
          skip link. */}
      <section
        id="albums"
        tabIndex={-1}
        className="scroll-mt-20 border-t border-white/[0.06] outline-none"
      >
        <div className="mx-auto w-full max-w-7xl px-4 pb-20 pt-12 sm:px-5 sm:pt-16">
          <LibraryHeader tripCount={trips.length} totals={totals} />

          <div id="session" className="scroll-mt-24">
            <TripSessionCard detectionsSoFar={totals.detections} />
          </div>

          {trips.length === 0 ? <EmptyLibrary /> : <AlbumGallery trips={trips} />}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
