import Link from "next/link";
import { BenchClient } from "@/components/bench/BenchClient";

export const metadata = {
  title: "Detector bench — Spark",
  description:
    "Run a real object detector in the browser and push its output through the moment pipeline.",
};

export default function DetectPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6">
      <nav className="mb-5">
        <Link href="/" className="btn-ghost px-3.5 py-2 text-[13px]">
          <span aria-hidden>←</span> Back to the map
        </Link>
      </nav>

      {/* Transformers.js is browser-only (WebGPU/WASM) and large, so the bench
          is loaded client-side inside BenchClient. */}
      <BenchClient />
    </main>
  );
}
