import { AtlasApp, type NavTargetMap } from "@/components/atlas/AtlasApp";
import { getGlobeView } from "@/lib/globeData";
import { TRIP_ID, getObjectIndexViewFor, getTripMomentsFor, getTripViewFor } from "@/lib/tripData";

/**
 * The walk: a day as a full-screen survey map of the real place, with every
 * kept moment pinned as a Gaussian splat you can step inside. Everything is
 * composed here on the server so the client gets exactly the shapes it renders —
 * full moments for the takeover, the thinned path for the map, the object index
 * for ⌘K — and never the ~10,000 raw detection rows.
 *
 * `?trip=<tripId>` picks the walk — the landing the desk globe dives into.
 * Unknown or absent ids fall back to the flagship (STACKT Market), so stale
 * links degrade to the best walk rather than a 500.
 *
 * `?m=<momentId>` (optionally `&anchor=<trackId>`) opens a moment's splat on
 * load — the deep-link the old moment routes redirect into.
 */
export default async function WalkPage({ searchParams }: PageProps<"/walk">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const requested = first(sp.trip);
  const trip = (requested ? getTripViewFor(requested) : null) ?? getTripViewFor(TRIP_ID)!;
  const moments = getTripMomentsFor(trip.id)!;
  const { entries } = getObjectIndexViewFor(trip.id)!;
  const globe = getGlobeView();

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

  return (
    // Keyed by trip: landing here from the globe is a client-side navigation
    // within the same segment, and without the key React would reconcile the
    // old AtlasApp — leaving the globe plate (and its paper wash) open over
    // the new walk instead of remounting onto it.
    <AtlasApp
      key={trip.id}
      trip={trip}
      moments={moments}
      entries={entries}
      navTargets={navTargets}
      globe={globe}
      initialMomentId={first(sp.m) ?? null}
      initialAnchor={first(sp.anchor) ?? null}
    />
  );
}
