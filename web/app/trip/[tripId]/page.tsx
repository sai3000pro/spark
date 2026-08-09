import { notFound } from "next/navigation";
import { AtlasScreen, firstParam } from "@/components/atlas/AtlasScreen";
import { getTripSpec, TRIP_SPECS } from "@/lib/mock/trips";

/**
 * An album, opened: the trip's own walk screen.
 *
 * This used to redirect to `/walk`, from back when the atlas could render
 * precisely one trip — so every album card, every globe pin and every
 * cross-trip search result landed on Waterloo Park regardless of what you
 * clicked. It renders the trip named in the path now.
 *
 * `?m=<momentId>&anchor=<trackId>` is the moment deep link, same as `/walk`.
 */
export function generateStaticParams() {
  return TRIP_SPECS.map((spec) => ({ tripId: spec.id }));
}

export default async function TripPage({ params, searchParams }: PageProps<"/trip/[tripId]">) {
  const { tripId } = await params;
  if (!getTripSpec(tripId)) notFound();

  const sp = await searchParams;
  return <AtlasScreen tripId={tripId} momentId={firstParam(sp.m)} anchor={firstParam(sp.anchor)} />;
}
