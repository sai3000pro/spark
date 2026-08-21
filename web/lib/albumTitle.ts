/**
 * What counts as a usable album title. Pure, and deliberately alone in a file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT IN lib/albums.ts, WHERE IT OBVIOUSLY BELONGS
 *
 * The save screen validates a title before it POSTs, so `normaliseTitle` has to
 * run in the browser. It used to be exported from lib/albums.ts and imported
 * straight out of a `"use client"` component, which was fine for exactly as
 * long as that module stayed pure.
 *
 * It stopped being pure the moment albums gained durable storage: albums.ts now
 * imports lib/persist.ts, which imports `node:fs`. Turbopack's answer to that
 * was not a warning but a build panic —
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)  ...  Failed to write app endpoint /live/page
 *
 * — and the route it named, `/live`, does not mention albums anywhere. The path
 * ran through a client component four hops away.
 *
 * So the rule this file encodes: A FUNCTION THE BROWSER NEEDS MUST NOT LIVE IN
 * A MODULE THE SERVER NEEDS DISK FOR. Splitting it costs one import and makes
 * the boundary something you can see rather than something you have to trace.
 *
 * lib/albums.ts re-exports both of these, so existing server-side callers are
 * unchanged. Client code must import them from HERE.
 */

/** Long enough to be a real name, short enough to sit under a globe pin. */
export const MAX_TITLE = 60;

/**
 * Trim, collapse whitespace, cap. Returns null when nothing is left.
 *
 * One implementation of "is this a usable title" beats two that disagree about
 * whether a string of spaces counts — which is the whole reason the browser
 * imports the same function the server validates with.
 */
export function normaliseTitle(raw: string): string | null {
  // Verbatim from where it used to live in lib/albums.ts, ordering included.
  // Moving a validator is a refactor; changing what it accepts on the way past
  // is a behaviour change nobody asked for, and the two must not travel together.
  const title = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return title.length > 0 ? title : null;
}
