/**
 * Which walks are posted to the globe.
 *
 * The globe is everybody's walks laid on one sphere; POSTING is the explicit act
 * of setting yours onto it. Nothing arrives there by default just because it was
 * recorded — except the seeded specs, which ARE the "everybody else" the globe
 * amalgamates and so start posted. An uploaded walk starts hidden and stays
 * yours until you post it from the map.
 *
 * Storage is the same globalThis singleton discipline as lib/liveTrip.ts, with
 * the same limitations: survives dev module reloads, does NOT survive a server
 * restart, single process only, nothing on disk. See that file's header — the
 * argument is identical and so is the one-file path to a database (this map
 * becomes a `posted` column on the walks table).
 *
 * No `next/*` imports: scripts/verify-pipeline.ts can reach this and runs under tsx.
 */
import { TRIP_ID } from "./tripData";
import { isUploadedTripId } from "./uploadedTrips";

interface Store {
  /** Explicit choices only; anything absent falls back to the default rule. */
  overrides: Map<string, boolean>;
}

const KEY = Symbol.for("spark.postedWalks.store");

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const fresh: Store = { overrides: new Map() };
  g[KEY] = fresh;
  return fresh;
}

/**
 * Which walks are YOURS. Hardcoded until accounts exist: the flagship STACKT
 * walk is this user's own recording, and anything uploaded here is theirs.
 * Every other seeded spec belongs to another walker — they appear on the globe
 * because THEY posted them, and you can no more unpost someone else's walk
 * than tear a page out of their journal. Only your own walks take the toggle.
 */
export function isWalkMine(tripId: string): boolean {
  return tripId === TRIP_ID || isUploadedTripId(tripId);
}

export function isWalkPosted(tripId: string): boolean {
  return store().overrides.get(tripId) ?? !isUploadedTripId(tripId);
}

export function setWalkPosted(tripId: string, posted: boolean): void {
  store().overrides.set(tripId, posted);
}

export function __resetPostedWalks(): void {
  store().overrides.clear();
}
