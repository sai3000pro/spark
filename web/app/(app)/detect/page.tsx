import { DetectorLabClient } from "@/components/detect/DetectorLabClient";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata = {
  title: "Detector bench — Spark",
  description:
    "Run a real object detector in the browser and push its output through the moment pipeline.",
};

export default function DetectPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-5">
      <PageHeader
        backHref="/"
        backLabel="All albums"
        eyebrow="Stage 1 → stage 2, live"
        title="Detector bench"
        description="Run the real detector in your browser, then push its output through the same scoring code the robot uses to decide what was worth keeping."
      />

      {/* Transformers.js is browser-only (WebGPU/WASM) and large, so the bench is
          loaded client-side inside DetectorLabClient. */}
      <DetectorLabClient />
    </main>
  );
}
