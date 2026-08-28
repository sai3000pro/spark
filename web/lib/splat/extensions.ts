/**
 * The five formats this app stores, and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE
 *
 * Three very different places need this one list and they cannot all import the
 * same module:
 *
 *   lib/splat/formats.ts        identifies an upload — and reaches for
 *                               `node:zlib` to inflate an SPZ header
 *   lib/splatJobs.ts            finds a stored splat again, server-side
 *   components/live/…Panel.tsx  fills the file picker's `accept`, in the BROWSER
 *
 * A client component importing `node:zlib`, even transitively, does not fail at
 * runtime with something legible — it fails at bundle time with a module
 * resolution error about a Node builtin, from a file that never mentions one.
 * The alternative is writing the list out twice, and a list written twice is a
 * list that drifts: the picker would go on offering `.ply` alone long after the
 * server started taking more, or, worse, offer a format the server
 * refuses, which is a wasted upload and a confusing refusal.
 *
 * So the list lives here, with no imports at all, and everything reads it from
 * one place.
 *
 * Order is load-bearing where it is consumed. `detectSplatFormat` tries the
 * self-describing formats before the headerless one, and `storedSplatFor` walks
 * the extensions in this order so that a duplicate on disk resolves the same
 * way every time rather than by readdir order.
 *
 * A trap worth naming, since two of these are suffixes of each other: `.ksplat`
 * ends with the letters of `splat`. Anything classifying a FILENAME must take
 * its extension and compare it, never test suffixes in a loop — a suffix test
 * gets the right answer only while this array happens to list ksplat first, and
 * gets a silently wrong one the day somebody sorts it alphabetically.
 */

/*
  `rad` sits before `splat` for the reason the note above gives: it is
  self-describing (a "RAD0" magic) and `.splat` is not, so anything that can
  identify itself must get the chance before the format that is identified by
  elimination.

  It is also the one format here that only ONE of the two engines can open -
  see RENDERER_FORMATS in ./renderer.ts. Storing it is still right: the viewer
  picks the engine that can read the file, and refusing a format because the
  fallback engine cannot draw it would be refusing the only format that makes a
  million-splat scene openable at all.
*/
export const SPLAT_FORMATS = ["ply", "spz", "ksplat", "rad", "splat"] as const;
export type SplatFormat = (typeof SPLAT_FORMATS)[number];

/** The same list as filename extensions, dot included. */
export const SPLAT_EXTENSIONS: readonly string[] = SPLAT_FORMATS.map((f) => `.${f}`);

/**
 * What a file picker's `accept` attribute wants: `.ply,.spz,.ksplat,.rad,.splat`.
 *
 * A hint to the browser and nothing more. The server re-derives the format from
 * the bytes, because an extension is a claim by whoever named the file — see
 * lib/splat/formats.ts.
 */
export const SPLAT_ACCEPT_ATTRIBUTE = SPLAT_EXTENSIONS.join(",");

/** Does this filename claim one of the formats? Used only to skip a doomed upload. */
export function hasSplatExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return SPLAT_EXTENSIONS.some((e) => lower.endsWith(e));
}
