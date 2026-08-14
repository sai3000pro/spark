"use client";

/**
 * Client boundary for the splat stage.
 *
 * `next/dynamic` with `ssr: false` is only legal inside a Client Component, and
 * the page has to stay a Server Component — it reads the .ply off disk, measures
 * it and exports metadata, none of which can happen in a browser. This wrapper
 * is the seam between the two, same shape as components/bench/BenchClient.tsx.
 *
 * The `ssr: false` is not ceremony. Both engines reach for WebGL and a WASM sort
 * the moment they initialise, and neither three.js instance has anything useful
 * to say on a server render — rendering them there costs a pass and produces
 * markup that is thrown away on the first client frame anyway.
 */
import dynamic from "next/dynamic";

import type { SplatView } from "@/lib/types";

const Stage = dynamic(() => import("./SplatStage").then((m) => m.SplatStage), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center">
      <span className="fnote text-[10px] text-mist">[ starting the renderer ]</span>
    </div>
  ),
});

export function StageClient(props: {
  url: string;
  view: SplatView;
  span: number;
  bytes: number;
  pointCount: number;
}) {
  return <Stage {...props} />;
}
