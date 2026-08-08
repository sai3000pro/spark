/**
 * MapLibre v6 loads its tile-parsing worker as a separate module bundle via
 * `new Worker(new URL(...))` — which Turbopack does not rewrite, so the worker
 * 404s and the map hangs forever with zero tiles requested. We copy the worker
 * (and the shared chunk it imports) into public/ and point maplibre at it with
 * setWorkerUrl (see NightMap.tsx). Runs on predev/prebuild so the copy always
 * matches the installed maplibre version; public/map-lib is gitignored.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "node_modules", "maplibre-gl", "dist");
const dest = join(here, "..", "public", "map-lib");

mkdirSync(dest, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, f), join(dest, f));
}
console.log("maplibre worker copied to public/map-lib");
