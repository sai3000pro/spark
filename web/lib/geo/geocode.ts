import "server-only";

/**
 * A place name → a coordinate, when the name is all we have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT RUNS HERE AND NOT IN THE BROWSER
 *
 * Nominatim's usage policy asks for an identifying User-Agent and a low request
 * rate. A browser cannot set a User-Agent, and a page that geocodes on every
 * keystroke is exactly the traffic that gets an app blocked — so this is
 * server-side, called once per submit, never per keypress.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEST EFFORT MEANS BEST EFFORT
 *
 * It never throws and it never guesses. No result, an unreachable service, a
 * timeout, a body that does not parse — all come back null, and the caller
 * keeps whatever it had. The alternative is a confident pin somewhere wrong,
 * which the globe draws exactly like a real one.
 *
 * The coordinate is only half the answer: `label` is Nominatim's own display
 * name, so what lands on the trip is what the geocoder actually matched rather
 * than what was typed. Someone who searches "the park" and gets a park in
 * Ohio should be able to see that immediately.
 */
import { findKnownPlace } from "./knownPlaces";
import { parseCoordinates } from "./parsePlace";

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

/**
 * Identifies this app, per Nominatim's policy. Overridable so a deployment can
 * put a real contact address in it, which the policy asks for.
 */
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT ?? "spark-walk-memory/0.1 (local development)";

/** Short: a person is waiting on a form, not a batch job. */
const TIMEOUT_MS = 8_000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** What the geocoder matched, in its words. Null when coordinates were typed. */
  label: string | null;
  /** How the answer was reached, so the UI can say. */
  source: "typed-coordinates" | "known-place" | "geocoded";
}

interface NominatimRow {
  lat?: string;
  lon?: string;
  display_name?: string;
}

/**
 * Resolve whatever was typed.
 *
 * Coordinates are handled WITHOUT a network round trip and without consulting
 * the geocoder at all — a pasted coordinate is already exact, and asking
 * Nominatim to interpret it can only introduce error.
 */
export async function resolvePlace(query: string): Promise<GeocodeResult | null> {
  const raw = query.trim();
  if (!raw) return null;

  const typed = parseCoordinates(raw);
  if (typed) {
    return { lat: typed.lat, lng: typed.lng, label: null, source: "typed-coordinates" };
  }

  // Before the network, because the entries here exist precisely because the
  // network answers "no match" for them. See lib/geo/knownPlaces.ts.
  const known = findKnownPlace(raw);
  if (known) {
    return { lat: known.lat, lng: known.lng, label: known.label, source: "known-place" };
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", raw);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  let body: unknown;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    // Offline, blocked, rate-limited, slow. None of these is worth an error
    // page — the walk keeps the place it already had.
    return null;
  }

  if (!Array.isArray(body) || body.length === 0) return null;
  const row = body[0] as NominatimRow;
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  // Re-validated rather than trusted: the range check is cheap and a malformed
  // row would otherwise become a pin.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return {
    lat,
    lng,
    label: typeof row.display_name === "string" ? row.display_name : null,
    source: "geocoded",
  };
}
