"use client";

/**
 * Client boundary for the detector bench.
 *
 * `next/dynamic` with `ssr: false` is only legal inside a Client Component, and
 * the page itself needs to stay a Server Component so it can export `metadata`.
 * This wrapper is the seam between the two.
 */
import dynamic from "next/dynamic";

const DetectorLab = dynamic(
  () => import("@/components/detect/DetectorLab").then((m) => m.DetectorLab),
  {
    ssr: false,
    loading: () => (
      <div className="surface grid h-64 place-items-center rounded-xl">
        <span className="font-mono text-[11px] text-fog-400">loading detector bench…</span>
      </div>
    ),
  },
);

export function DetectorLabClient() {
  return <DetectorLab />;
}
