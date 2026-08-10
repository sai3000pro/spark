import { MapScreen } from "@/components/map/MapScreen";

/**
 * The walk: the day as a survey map of the real place, every located moment
 * pinned as a Gaussian splat you can step inside.
 *
 * This is now REAL data — the located splats from the studio (given coordinates
 * in the album), not the old mock trip. The mock trip explorer still lives at
 * `/trip/<tripId>`. Deep-links like `?m=` from the older landing degrade
 * gracefully: this map has no per-moment overlay, it opens the splat in bigview.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Spark — the map",
  description: "Every located moment pinned on a real map of the place.",
};

export default function WalkPage() {
  return <MapScreen />;
}
