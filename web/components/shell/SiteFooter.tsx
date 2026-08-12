/**
 * The end of the page.
 *
 * Before this, the landing page stopped: the last album tile was the last thing
 * in the document, and the viewport simply ran out. A page that ends on a
 * half-empty grid row reads as truncated rather than finished.
 *
 * It carries the one standing caveat the app owes a visitor — that no robot is
 * connected — in the place a caveat belongs. TripSessionCard says the same thing
 * far more loudly, but only once a trip has actually ended; somebody who never
 * starts one should still be able to find out what they are looking at.
 *
 * Server component. Plain <a> for the same-page jumps and next/link for the real
 * routes, which is the distinction ScrollCue's header comment sets out.
 */
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-5 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[42ch]">
          <p className="font-display text-[15px] font-bold tracking-[0.18em] text-fog-100">
            SPARK
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-fog-400">
            A companion robot that rolls along behind you, decides for itself what was worth
            keeping, and hands it back as places you can step into.
          </p>
        </div>

        <nav
          aria-label="Elsewhere in Spark"
          className="flex flex-col gap-2 font-mono text-[11px] text-fog-400"
        >
          <a
            href="#albums"
            className="transition-colors hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70"
          >
            Your albums
          </a>
          <Link
            href="/globe"
            className="transition-colors hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70"
          >
            Every trip on a globe
          </Link>
          <Link
            href="/detect"
            className="transition-colors hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70"
          >
            Detector bench
          </Link>
        </nav>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-5">
        {/* warn-400, the token this build uses for its honesty notices. */}
        <p className="max-w-[62ch] font-mono text-[10.5px] leading-relaxed text-warn-400/80">
          Demo build. No rover is connected, so no live trip can open — record with your phone
          instead. The albums above are recorded fixtures.
        </p>
      </div>
    </footer>
  );
}
