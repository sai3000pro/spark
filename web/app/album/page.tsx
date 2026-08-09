/**
 * The album of moments — every finished splat in the studio, laid out as a
 * journal of prints on cream paper. Same register as /walk: paper ground, pine
 * ink, brass accent, typewriter specimen tags. NOT the aurora shell — this route
 * lives under the root journal layout, so there is no dark app bar here.
 *
 * The splats themselves live in the Reconstruction Studio (:8899). This page
 * lists them (fetchRuns) and each card links OUT to the studio's bigview engine
 * to render — the viewer needs SharedArrayBuffer, which only the studio origin
 * grants. No filters, no pipeline: just the shelf of moments. See memory:
 * frontend-merge-platform.
 */
import { NavBrandSwitch } from "@/components/shell/NavBrandSwitch";
import { AlbumClient, type AlbumItem } from "@/components/studio-album/AlbumClient";
import {
  bigviewUrl,
  fetchRuns,
  framesAlbumUrl,
  isTraining,
  runSpecs,
  studioFileUrl,
} from "@/lib/studio";

export const metadata = {
  title: "Spark — the album",
  description: "Every moment worth keeping, as a Gaussian splat you can step back into.",
};

// The studio's library changes as runs finish; never freeze this at build time.
export const dynamic = "force-dynamic";

export default async function AlbumPage() {
  const runs = await fetchRuns();

  const items: AlbumItem[] = runs.map((r) => {
    const training = isTraining(r);
    return {
      id: r.id,
      title: r.label || r.id,
      place: r.place?.name?.trim()
        ? {
            name: r.place.name.trim(),
            lat: typeof r.place.lat === "number" ? r.place.lat : null,
            lng: typeof r.place.lng === "number" ? r.place.lng : null,
          }
        : null,
      gaussians: r.gaussians ?? null,
      cover: r.ref_image ? studioFileUrl(r.ref_image) : null,
      // While training, link to the live-reloading viewer (once the first snapshot
      // has published a result_ply); before any snapshot exists, bigviewUrl is null
      // and the card shows "Building splat…".
      splatUrl: training ? bigviewUrl(r, { liveSeconds: 10 }) : bigviewUrl(r),
      framesUrl: framesAlbumUrl(r),
      training,
      specs: runSpecs(r),
      // Seed the live progress readout; the card polls for updates while training.
      train: training
        ? {
            started: typeof r.started === "number" ? r.started : null,
            latestIter: r.latest_iter ?? null,
            steps: r.steps ?? null,
          }
        : undefined,
    };
  });

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="papergrain relative">
        <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-3 px-5 pb-6 pt-8 sm:px-8 sm:pt-12">
          <NavBrandSwitch tone="paper" />
          <p className="fnote ml-auto text-ink-faint">
            [ {items.length} {items.length === 1 ? "moment" : "moments"} ]
          </p>
        </header>

        <div className="gridfield relative">
          <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
            <div className="mb-8 max-w-xl">
              <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
                The album
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                Moments Spark kept, each one a place you can walk back into. Hover a
                print to step inside the splat or leaf through its frames.
              </p>
            </div>

            <AlbumClient items={items} />
          </section>
        </div>
      </div>
    </main>
  );
}
