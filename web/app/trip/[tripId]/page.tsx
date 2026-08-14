import { notFound } from "next/navigation";
import { AtlasScreen, firstParam } from "@/components/atlas/AtlasScreen";
import { getTripSpec, TRIP_SPECS } from "@/lib/mock/trips";
import { getUploadedWalk, isUploadedTripId } from "@/lib/uploadedTrips";

/**
 * An album, opened: the trip's own walk screen.
 *
 * This used to redirect to `/walk`, from back when the atlas could render
 * precisely one trip — so every album card, every globe pin and every
 * cross-trip search result landed on Waterloo Park regardless of what you
 * clicked. It renders the trip named in the path now.
 *
 * `?m=<momentId>&anchor=<trackId>` is the moment deep link, same as `/walk`.
 *
 * IT ALSO RENDERS UPLOADED WALKS. It used to `notFound()` anything without a
 * mock spec, which meant a walk built from your own footage — the entire point
 * of the capture flow — had no screen at all. The link handed out after a build
 * pointed at `/walk?trip=<id>`, and `/walk` is the global pinned-moments map
 * that ignores `?trip=` completely, so a finished walk with a real 144 MB
 * reconstruction attached to it rendered as "no pinned moments".
 *
 * `lib/tripData.ts` already knew how to resolve these; only this gate did not.
 */

/**
 * Uploaded walks live in a globalThis map, so this page cannot be cached: a
 * walk built one request ago does not exist in any build output.
 */
export const dynamic = "force-dynamic";
export function generateStaticParams() {
  return TRIP_SPECS.map((spec) => ({ tripId: spec.id }));
}

export default async function TripPage({ params, searchParams }: PageProps<"/trip/[tripId]">) {
  const { tripId } = await params;
  // A mock spec, or a walk built from real footage. Anything else is a 404.
  const known = isUploadedTripId(tripId) ? Boolean(getUploadedWalk(tripId)) : Boolean(getTripSpec(tripId));
  if (!known) notFound();

  const sp = await searchParams;
  return <AtlasScreen tripId={tripId} momentId={firstParam(sp.m)} anchor={firstParam(sp.anchor)} />;
}
