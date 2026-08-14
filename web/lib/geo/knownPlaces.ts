/**
 * A tiny gazetteer, for places a geocoder does not know.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * OpenStreetMap is very good and it is not complete. "Stackt Market, Toronto"
 * returns HTTP 200 with an empty array — the container market is simply not in
 * OSM under that name — and the one place in the world this project has the
 * most footage of is therefore the one place it could not put on a map.
 *
 * So: a curated fallback, consulted after the coordinate parser and BEFORE the
 * network. Every entry is a fact somebody supplied, not a guess, and each one
 * records where it came from so a wrong pin can be traced to a decision rather
 * than to a heuristic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT STAYS SMALL, AND THAT IS THE POINT
 *
 * This is NOT a geocoder and must not grow into one — the moment it holds
 * hundreds of entries it is a stale copy of a database somebody else maintains
 * properly. It holds the handful of places this project actually works in, and
 * anything else goes to Nominatim as before.
 *
 * Pure and dependency-free so scripts/verify-pipeline.ts can assert it.
 */

export interface KnownPlace {
  /** Canonical display name, used verbatim on the trip. */
  label: string;
  lat: number;
  lng: number;
  /** Alternate spellings someone might type. Matched after normalisation. */
  aliases: string[];
}

export const KNOWN_PLACES: KnownPlace[] = [
  {
    // The SummerHacks venue, and the subject of most of this repo's footage.
    // Supplied by hand because OSM has no entry under this name.
    label: "Stackt Market, Toronto",
    lat: 43.64088443911673,
    lng: -79.4017196836839,
    aliases: ["stackt market", "stackt", "stackt market toronto", "stackt toronto"],
  },
];

/**
 * Fold a typed string down to something comparable.
 *
 * Case, punctuation and repeated spaces all vary between people typing the same
 * name; none of them carries meaning here. Diacritics are deliberately left
 * alone — stripping them would collapse names that are genuinely different.
 */
export function normalisePlaceName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A curated entry, or null to carry on to the geocoder. */
export function findKnownPlace(query: string): KnownPlace | null {
  const needle = normalisePlaceName(query);
  if (!needle) return null;

  for (const place of KNOWN_PLACES) {
    // The label itself counts as an alias — nobody should have to know that
    // the canonical spelling was listed separately.
    const names = [place.label, ...place.aliases].map(normalisePlaceName);
    if (names.includes(needle)) return place;
  }
  return null;
}
