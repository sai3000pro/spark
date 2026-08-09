"use client";

/**
 * The companion that lives on the kept-moments ticker.
 *
 * Two blobs ship on this page and they are deliberately different registers.
 * BlobMark up in the header is CHROME — a sleeping mark beside the wordmark,
 * which you look at. This one is a TOY: pick it up, fling it along the strip,
 * watch it arc, land and trudge back to its spot. Same character, same sprite
 * sheet, opposite jobs.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 * Two things HeroBlobButton needs that the journal landing does not otherwise
 * provide, and both are the reason it cannot simply be dropped into Landing.tsx:
 *
 *   1. A STAGE. The button positions itself from --blob-cx/--blob-feet-y/--blob-h
 *      against its containing block, and writes --blob-dx/--blob-dy back onto
 *      its own parentElement every frame. That parent is also the box it measures
 *      for the arena — how far it may be thrown, and how high. So the stage is
 *      not decoration; it IS the physics' coordinate frame. See .ticker-stage.
 *
 *   2. A LIVE-TRIP CONTEXT. `useLiveTrip()` THROWS without a provider, and the
 *      provider was only ever mounted in app/(app)/layout.tsx — the aurora shell,
 *      which `/` is not inside since the journal took the route over. Wrapping it
 *      here rather than around the whole landing is deliberate: the hook ticks
 *      once a second while a trip runs, and that tick must not re-render a page
 *      of GSAP timelines.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { HeroBlobButton } from "@/components/hero/HeroBlobButton";
import { LiveTripProvider } from "@/components/shell/LiveTripProvider";
import type { ActiveTripSnapshot } from "@/lib/liveTrip";

export function TickerBlob({ initialTrip }: { initialTrip: ActiveTripSnapshot | null }) {
  return (
    <LiveTripProvider initial={initialTrip}>
      {/* The stage must be the button's DIRECT parent — see note 1 above. Nothing
          may be introduced between the two. */}
      <div className="ticker-stage">
        <HeroBlobButton />
      </div>
    </LiveTripProvider>
  );
}
