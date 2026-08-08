import { DetectorLabClient } from "@/components/detect/DetectorLabClient";
import { TopBar } from "@/components/shell/TopBar";

export const metadata = {
  title: "Detector bench — Spark",
  description:
    "Run a real object detector in the browser and push its output through the moment pipeline.",
};

export default function DetectPage() {
  return (
    <>
      <TopBar backHref="/" title="Detector bench" subtitle="stage 1 → stage 2, live" />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-5">
        {/* Transformers.js is browser-only (WebGPU/WASM) and large, so the bench is
            loaded client-side inside DetectorLabClient. */}
        <DetectorLabClient />
      </main>
    </>
  );
}
