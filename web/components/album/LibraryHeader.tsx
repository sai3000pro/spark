/**
 * The library's own header, below the hero.
 *
 * An <h2> at 20/22px, not PageHeader's 28/34px <h1>. This is a section of a
 * page, not a page: the hero owns the <h1>, and sizing this like a page title
 * would make the hero read as a banner bolted on top of the old screen.
 *
 * PageHeader is deliberately not used on `/` any more — it still serves /globe,
 * /detect and /trip/[tripId] unchanged. What survives from it is the line that
 * mattered: the mono totals, which are the only proof on screen that the
 * pipeline really ran over ~35,000 detections.
 */
import { compactNumber, duration } from "@/lib/format";

interface Props {
  tripCount: number;
  totals: { moments: number; seconds: number; detections: number };
}

export function LibraryHeader({ tripCount, totals }: Props) {
  return (
    <header className="mb-6">
      {/* Plain .eyebrow rather than teal. The albums screen's own comment claims
          the only saturated colour here is the nav segment and the focus ring,
          and a teal eyebrow quietly broke that. */}
      <p className="eyebrow">Memory albums</p>
      <h2 className="mt-1 font-display text-[20px] font-semibold leading-tight tracking-[-0.01em] text-fog-100 sm:text-[22px]">
        Your library
      </h2>
      {tripCount > 0 && (
        <p className="tnum mt-1.5 font-mono text-[11px] text-fog-400">
          {/* "trips", matching the button that starts one and the route that
              serves it. This line said "journeys" while the control above it
              said "trip". */}
          {tripCount} trips · {totals.moments} moments · {duration(totals.seconds)} captured ·{" "}
          {compactNumber(totals.detections)} detections
        </p>
      )}
    </header>
  );
}
