"use client";

/**
 * Client boundary for the detector bench.
 *
 * `next/dynamic` with `ssr: false` is only legal inside a Client Component, and
 * the page itself needs to stay a Server Component so it can export `metadata`.
 * This wrapper is the seam between the two.
 */
import dynamic from "next/dynamic";

const Bench = dynamic(() => import("@/components/bench/Bench").then((m) => m.Bench), {
  ssr: false,
  loading: () => (
    <div className="plate relative grid h-64 place-items-center">
      <span className="tag text-[10px] text-moth">[ loading the bench… ]</span>
    </div>
  ),
});

export function BenchClient() {
  return <Bench />;
}
