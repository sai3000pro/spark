import { AtlasScreen, firstParam } from "@/components/atlas/AtlasScreen";
import { resolveTripId } from "@/lib/tripData";

/**
 * The walk: a day as a full-screen survey map of the real place, with every kept
 * moment pinned as a Gaussian splat you can step inside.
 *
 * `?trip=<tripId>` picks the trip; without it you get the demo's default, which
 * is Waterloo Park built by the journal's own builder — the bare `/walk` this
 * route has always served, unchanged. `?m=<momentId>` (optionally
 * `&anchor=<trackId>`) opens a moment's splat on load.
 *
 * `/trip/<tripId>` renders the same screen with the id in the path; both go
 * through components/atlas/AtlasScreen.tsx, which is where the composition lives.
 */
export default async function WalkPage({ searchParams }: PageProps<"/walk">) {
  const sp = await searchParams;
  return (
    <AtlasScreen
      tripId={resolveTripId(sp.trip)}
      momentId={firstParam(sp.m)}
      anchor={firstParam(sp.anchor)}
    />
  );
}
