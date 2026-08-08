/**
 * The persistent app bar. One row, rendered once by app/(app)/layout.tsx.
 *
 * It carries ONLY invariant chrome: brand, the Albums|Globe switch, the record
 * control, search, and the robot's telemetry. Per-page context — titles, back
 * chevrons, stats — lives in the page body via components/shell/PageHeader.tsx.
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
import { RecordControl } from "@/components/shell/RecordControl";
import { SparkMark } from "@/components/shell/SparkMark";
import { TelemetryPills } from "@/components/shell/TelemetryPills";
import { ViewSwitch } from "@/components/shell/ViewSwitch";
import { SearchMount } from "@/components/search/SearchMount";
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
          <SparkMark />
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

/** Split out so the index computation streams instead of blocking the page. */
function SearchSlot() {
  const index = getGlobalObjectIndex();
  return <SearchMount entries={index.entries} />;
}
