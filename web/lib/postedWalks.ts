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

export function isWalkPosted(tripId: string): boolean {
  return store().overrides.get(tripId) ?? !isUploadedTripId(tripId);
}

export function setWalkPosted(tripId: string, posted: boolean): void {
  store().overrides.set(tripId, posted);
}

export function __resetPostedWalks(): void {
  store().overrides.clear();
}
