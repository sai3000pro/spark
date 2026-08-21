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
import { __wipeStore, hydrate, persist } from "./persist";

interface Store {
  /** Explicit choices only; anything absent falls back to the default rule. */
  overrides: Map<string, boolean>;
  /** Whether the disk sidecar has been read back into this process yet. */
  hydrated: boolean;
}

const KEY = Symbol.for("spark.postedWalks.store");

/** Sidecar directory under `.data/`. See lib/persist.ts. */
const STORE_NAME = "posted";

/**
 * ONE record for the whole map, not one per walk.
 *
 * Unlike journeys, walks and albums, this store holds a handful of booleans
 * whose total size is smaller than the filesystem overhead of splitting them.
 * More to the point they are read together and never individually: every call
 * to `isWalkPosted` consults the same map, so there is no partial-read case a
 * per-record layout would help with.
 */
const RECORD_ID = "overrides";

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const existing = g[KEY];
  if (existing) {
    hydrateOnce(existing);
    return existing;
  }
  const fresh: Store = { overrides: new Map(), hydrated: false };
  g[KEY] = fresh;
  hydrateOnce(fresh);
  return fresh;
}

function hydrateOnce(s: Store): void {
  if (s.hydrated) return;
  s.hydrated = true; // set first — a throw below must not retry forever
  // Entries whose value is not a boolean are dropped rather than coerced. A
  // truthy string here would silently flip a walk to posted, and "posted"
  // means visible to other people on the globe — not a thing to guess at.
  const [record] = hydrate<Record<string, unknown>>(STORE_NAME, (raw) =>
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null,
  );
  if (!record) return;
  for (const [tripId, posted] of Object.entries(record)) {
    if (typeof posted === "boolean") s.overrides.set(tripId, posted);
  }
}

function persistOverrides(s: Store): void {
  persist(STORE_NAME, RECORD_ID, Object.fromEntries(s.overrides));
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
  const s = store();
  s.overrides.set(tripId, posted);
  // Unposting is a privacy choice. A restart that silently reverted it would
  // put a walk back on the globe that someone had deliberately taken down,
  // which is the one direction this must never fail in.
  persistOverrides(s);
}

export function __resetPostedWalks(): void {
  __wipeStore(STORE_NAME);
  const s = store();
  s.overrides.clear();
  s.hydrated = true;
}

/** Tests only — a restart is memory cleared with the disk left alone. */
export function __simulateRestart(): void {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  g[KEY] = { overrides: new Map(), hydrated: false };
}
