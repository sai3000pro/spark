import { AtlasApp, type NavTargetMap } from "@/components/atlas/AtlasApp";
import { buildTrip } from "@/lib/mock/trip-waterloo-park";
import { getObjectIndexView, getTripView } from "@/lib/tripData";

/**
 * The walk: the day as a full-screen twilight map of the real park, with every
 * kept moment pinned as a Gaussian splat you can step inside. Everything is
 * composed here on the server so the client gets exactly the shapes it renders —
 * full moments for the takeover, the thinned path for the map, the object index
 * for ⌘K — and never the ~10,000 raw detection rows.
 *
 * `?m=<momentId>` (optionally `&anchor=<trackId>`) opens a moment's splat on
 * load — the deep-link the old moment routes redirect into.
 */
export default async function WalkPage({ searchParams }: PageProps<"/walk">) {
  const sp = await searchParams;
  const trip = getTripView();
  const { trip: fullTrip } = buildTrip();
  const { entries } = getObjectIndexView();

  // Nav targets keyed moment → track, so the takeover can say "the robot can
  // drive back to this" without shipping the whole index again.
  const navTargets: NavTargetMap = {};
  for (const entry of entries) {
    if (!entry.navTarget) continue;
    for (const s of entry.sightings) {
      (navTargets[s.momentId] ??= {})[s.trackId] = {
        pos: entry.navTarget.pos,
        heading: entry.navTarget.heading,
      };
    }
  }

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <AtlasApp
      trip={trip}
      moments={fullTrip.moments}
      entries={entries}
      navTargets={navTargets}
      initialMomentId={first(sp.m) ?? null}
      initialAnchor={first(sp.anchor) ?? null}
    />
  );
}
