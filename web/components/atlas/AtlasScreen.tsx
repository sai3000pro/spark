/**
 * The atlas, composed on the server for one trip.
 *
 * Both routes that show a walk render this: `/walk` (optionally `?trip=`) and
 * `/trip/<tripId>`. It exists so the composition — which builder, which object
 * index, which map calibration — lives once, and so the client keeps receiving
 * exactly the shapes it renders and never the ~10,000 raw detection rows.
 *
 * Returns null for an unknown trip; the caller decides whether that is a 404 or
 * a redirect.
 */
import { AtlasApp } from "@/components/atlas/AtlasApp";
import { getGlobeView } from "@/lib/globeData";
import { getAtlasView } from "@/lib/tripData";

interface Props {
  tripId: string;
  /** `?m=<momentId>` — opens that moment's splat on load. */
  momentId?: string | null;
  /** `?anchor=<trackId>` — focuses one object inside it. The find → 3D handoff. */
  anchor?: string | null;
}

export function AtlasScreen({ tripId, momentId, anchor }: Props) {
  const view = getAtlasView(tripId);
  if (!view) return null;

  return (
    <AtlasApp
      // Keyed by trip: landing here from the globe is a client-side navigation
      // within the same segment, and without the key React would reconcile the
      // old AtlasApp — leaving the globe plate (and its paper wash) open over
      // the new walk instead of remounting onto it.
      key={view.trip.id}
      {...view}
      globe={getGlobeView()}
      initialMomentId={momentId ?? null}
      initialAnchor={anchor ?? null}
    />
  );
}

/** `?m=a&m=b` is legal in a URL and meaningless here — take the first. */
export const firstParam = (v: string | string[] | undefined): string | null =>
  (Array.isArray(v) ? v[0] : v) ?? null;
