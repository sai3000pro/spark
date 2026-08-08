"use client";

/**
 * The ssr:false seam — the same shape as DetectorLabClient.
 *
 * `ssr: false` is only legal inside a Client Component, which is the entire
 * reason this thin wrapper exists and app/(app)/globe/page.tsx stays a Server
 * Component (so it can export metadata).
 *
 * `three` is deliberately NOT imported above this boundary. The first visit to
 * /globe in dev compiles the three.js chunk and takes ~10 seconds; keeping the
 * import inside the dynamic boundary means that cost is paid on this route only,
 * and the fixed-height fallback below means it does not shift the layout when it
 * lands. Production builds are unaffected.
 */
import dynamic from "next/dynamic";
import type { GlobeView } from "@/lib/globeData";

const GlobeExplorer = dynamic(
  () => import("@/components/globe/GlobeExplorer").then((m) => m.GlobeExplorer),
  {
    ssr: false,
    loading: () => (
      <div className="surface grid h-[460px] place-items-center rounded-2xl bg-ink-950">
        <span className="font-mono text-[11px] text-fog-400">assembling the globe…</span>
      </div>
    ),
  },
);

export function GlobeExplorerClient({ view }: { view: GlobeView }) {
  return <GlobeExplorer view={view} />;
}
