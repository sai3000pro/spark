/**
 * The persistent app bar. One row, rendered once by app/(app)/layout.tsx.
 *
 * It carries ONLY invariant chrome: brand, the Albums|Globe switch, the record
 * control and the robot's telemetry. Per-page context — titles, back chevrons,
 * stats — lives in the page body via components/shell/PageHeader.tsx.
 *
 * The one conditional slot is search, which appears only while a trip is running
 * — "where is my X?" is a question about a robot that is currently out there.
 * See components/search/SearchMount.tsx.
 *
 * That split is not a workaround for layouts being unable to read child page
 * data. It removes a real duplication: the old TopBar rendered the trip title in
 * the bar AND the page rendered it again in an <h1> forty pixels below.
 *
 * Server component. The search index sits in its own <Suspense> so building it
 * streams instead of holding up the page beneath.
 */
import Link from "next/link";
import { Suspense } from "react";
import { BlobMark } from "@/components/shell/BlobMark";
import { RecordControl } from "@/components/shell/RecordControl";
import { TelemetryPills } from "@/components/shell/TelemetryPills";
import { ViewSwitch } from "@/components/shell/ViewSwitch";
import { SearchMount } from "@/components/search/SearchMount";
import { getActiveTrip } from "@/lib/liveTrip";
import { getGlobalObjectIndex } from "@/lib/tripData";

export function AppBar() {
  return (
    // The height is DECLARED, not emergent. The landing hero has to subtract it
    // to fill exactly one viewport, and an emergent height cannot be subtracted.
    // If you change the contents, re-measure and update --appbar-h in globals.css.
    <header data-appbar className="glass sticky top-0 z-30 h-(--appbar-h) border-x-0 border-t-0">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-5">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          aria-label="Spark home"
        >
          {/* The robot itself, asleep until you do something. It replaces the
              drawn four-point spark: a mark that IS the product beats a mark
              that stands for it, and the frames are already in cache for the
              hero. SparkMark survives for EmptyLibrary, where a static glyph is
              the right weight. */}
          <BlobMark />
          {/* Wordmark is the first thing to go at phone width. White, not teal:
              the glyph carries the brand colour and the word carries the name,
              exactly as the brand sheet draws it. */}
          <span className="hidden font-display text-[15px] font-bold tracking-[0.18em] text-fog-100 sm:inline">
            SPARK
          </span>
        </Link>

        <ViewSwitch />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* /detect was only reachable from a buried text link on the album
              page; the reference design promotes it to the bar and it is a
              genuine improvement. Sheds at phone width along with the wordmark. */}
          <Link
            href="/detect"
            className="hidden h-7 shrink-0 items-center rounded-full border border-white/[0.10] px-2.5 font-mono text-[11px] text-fog-300 transition-colors hover:border-white/20 hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 sm:inline-flex"
          >
            Detector bench
          </Link>
          <RecordControl compact />
          <Suspense fallback={null}>
            <SearchSlot />
          </Suspense>
          <TelemetryPills />
        </div>
      </div>
    </header>
  );
}

/**
 * Split out so the index computation streams instead of blocking the page.
 *
 * The server gate is not redundant with the one inside SearchMount. That one
 * decides what renders; this one decides whether the whole cross-trip object
 * index gets built and then SERIALISED into the client bundle as props. On the
 * library — the page you land on, where the palette is deliberately absent —
 * that was every entry from every trip shipped to the browser for a control that
 * never appears.
 */
function SearchSlot() {
  if (!getActiveTrip()) return null;
  const index = getGlobalObjectIndex();
  return <SearchMount entries={index.entries} />;
}
