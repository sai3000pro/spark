/**
 * Where finished splats live on disk. One line, its own file, and a reason.
 *
 * This path used to be declared in lib/splatJobs.ts, which is its natural home
 * — that module owns jobs and jobs own splats. The problem is what else comes
 * with it: splatJobs imports lib/video/remux.ts for one suffix constant, and
 * remux.ts opens with `import "server-only"`, which THROWS the moment anything
 * outside a server-component graph loads it. So importing splatJobs to learn a
 * directory name drags in a module that refuses to be loaded by a script.
 *
 * That mattered the day the upload limits needed the same path. Their whole
 * point is a byte budget measured against this directory, and a budget nobody
 * can run a test against is a budget nobody should believe —
 * scripts/verify-splat-upload.ts runs DOM-free under `tsx`, exactly where
 * `server-only` fires. The same reasoning is already written down at the bottom
 * of lib/splat/plyHeader.ts: a guard that costs the coverage buys nothing.
 *
 * So the constant moved down here where it has no dependencies at all, and
 * lib/splatJobs.ts re-exports it so every existing importer is untouched.
 */
import path from "node:path";

/**
 * Where a finished reconstruction has to be dropped to close the loop.
 *
 * Under `public/`, so Next serves it statically with no route in the way —
 * which is why an upload landing here under its final name is INSTANTLY
 * reachable by anyone with the URL, and why nothing is renamed into place until
 * it has been validated.
 */
export const SPLAT_DIR = path.join(process.cwd(), "public", "mock", "splats");
