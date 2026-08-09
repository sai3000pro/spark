/**
 * The /walk map, composed on the server. Pulls the studio's finished runs and
 * keeps only the ones that have been given coordinates in the album, then hands
 * them to the client map. This is where the map's data stopped being mock: the
 * pins are real located splats now, not a synthesized trip.
 */
import { RealMap } from "@/components/map/RealMap";
import { fetchRuns, locatedPins } from "@/lib/studio";

export async function MapScreen() {
  const runs = await fetchRuns();
  const pins = locatedPins(runs);
  return <RealMap pins={pins} />;
}
