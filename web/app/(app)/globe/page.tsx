import { GlobeExplorerClient } from "@/components/globe/GlobeExplorerClient";
import { PageHeader } from "@/components/system/PageHeader";
import { getGlobeView } from "@/lib/globeData";

export const metadata = {
  title: "Globe — Spark",
  description: "Every album, pinned where it happened.",
};

export default function GlobePage() {
  const view = getGlobeView();

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-5">
      <PageHeader
        eyebrow="Every trip, placed"
        title="Globe"
        meta={`${view.albums.length} albums · ${view.pins.length} places · ${countCountries(view)} countries`}
      />

      <GlobeExplorerClient view={view} />
    </main>
  );
}

const countCountries = (view: { albums: Array<{ country: string }> }) =>
  new Set(view.albums.map((a) => a.country)).size;
