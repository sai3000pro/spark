/**
 * Turning what someone typed into a coordinate, without a network.
 *
 * Pure and dependency-free so scripts/verify-pipeline.ts can assert it under
 * tsx — same split as lib/video/iso6709.ts, and for the same reason: this is
 * the part with real logic, and the geocoder that handles place NAMES is just
 * an HTTP call.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY PARSE AT ALL, WHEN A GEOCODER EXISTS
 *
 * Because a pasted coordinate is the one input that is already exact, and
 * sending it to a geocoder can only make it worse — Nominatim will happily
 * interpret "43.6406, -79.4019" as a search string and hand back whatever it
 * matches. It also works with no connection, which a demo appreciates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AMBIGUITY THAT MATTERS
 *
 * "43.6406, -79.4019" is lat,lng — the near-universal convention, and what
 * Google Maps, Apple Maps and every phone share sheet emit. GeoJSON uses the
 * opposite order and is a genuine trap, but a person typing into a box is
 * copying from a map app, not writing GeoJSON. So: lat first, and a value that
 * cannot be a latitude is rejected rather than silently swapped.
 */

export interface ParsedPlace {
  lat: number;
  lng: number;
}

/** Latitude runs ±90, longitude ±180. Anything else was not a coordinate. */
function inRange(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Gulf of Guinea. Overwhelmingly a placeholder rather than a
    // capture, and the same call lib/video/iso6709.ts makes.
    !(lat === 0 && lng === 0)
  );
}

/**
 * Decimal degrees, however they were separated.
 *
 * Accepts "43.6406, -79.4019", "43.6406 -79.4019", and the same with a
 * trailing/leading paren or bracket from a copied map URL. Deliberately does
 * NOT accept a bare pair of integers like "1 2" — that is far more likely to be
 * a typo than a coordinate off the coast of Africa.
 */
function parseDecimal(raw: string): ParsedPlace | null {
  const m = /(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  // At least one side must carry a decimal point. Whole-number pairs are
  // almost always something else entirely.
  if (!/\./.test(m[1]) && !/\./.test(m[2])) return null;
  return inRange(lat, lng) ? { lat, lng } : null;
}

/**
 * Degrees/minutes/seconds with hemisphere letters — what a map app shows a
 * person, and therefore what gets copied: 43°38'26.2"N 79°24'06.8"W.
 *
 * The letters are load-bearing: they carry the sign, and without them this
 * would be indistinguishable from two unrelated numbers.
 */
function parseDMS(raw: string): ParsedPlace | null {
  const part =
    /(\d{1,3})\s*[°d:]\s*(\d{1,2})\s*['′m:]?\s*(\d{1,2}(?:\.\d+)?)?\s*["″s]?\s*([NSEW])/gi;
  const found: Array<{ value: number; hemi: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = part.exec(raw)) !== null) {
    const deg = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const sec = Number(m[3] ?? 0);
    found.push({ value: deg + min / 60 + sec / 3600, hemi: m[4].toUpperCase() });
  }
  if (found.length !== 2) return null;

  const ns = found.find((f) => f.hemi === "N" || f.hemi === "S");
  const ew = found.find((f) => f.hemi === "E" || f.hemi === "W");
  // One of each, or it is not a coordinate pair — "43N 79N" is not a place.
  if (!ns || !ew) return null;

  const lat = ns.hemi === "S" ? -ns.value : ns.value;
  const lng = ew.hemi === "W" ? -ew.value : ew.value;
  return inRange(lat, lng) ? { lat, lng } : null;
}

/**
 * A coordinate, if that is what this is. Null means "treat it as a place name".
 *
 * Order matters: DMS is tried first because its digits would also match the
 * decimal pattern, and matching them there would read 43°38' as 43.0, 38.0 —
 * a confident pin in the Mediterranean.
 */
export function parseCoordinates(input: string): ParsedPlace | null {
  const raw = input.trim();
  if (!raw) return null;
  return parseDMS(raw) ?? parseDecimal(raw);
}
