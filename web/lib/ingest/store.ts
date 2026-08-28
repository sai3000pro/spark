/**
 * What the rover actually reported, kept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `/api/ingest/detections` and `/api/ingest/moments` validated a payload
 * against lib/types.ts, ran the real scorer over it, reported exactly what
 * stage 2 would make of the batch — and then dropped every byte. Both carried
 * `TODO(day 2): persist here`, and both told the caller `persisted: false`, so
 * nothing lied. But a rover that streamed for an hour left nothing behind: the
 * counters on /live moved, the session opened, and afterwards there was no
 * record that any of it had happened.
 *
 * That is the one shape of data loss this app has otherwise designed itself
 * against everywhere. A capture is minutes of something in the world that will
 * not repeat.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO FEEDS ARE NOT THE SAME KIND OF THING, AND ARE NOT KEPT THE SAME WAY
 *
 *   moments      the product. Scored, few, and each one is a thing a person
 *                would want to look at. Kept whole, and kept in full.
 *   detections   the evidence. Thousands per minute, individually meaningless,
 *                and valuable in aggregate as the thing a moment was derived
 *                from. Kept per trip, newest first, to a hard cap.
 *
 * Storing every detection forever is not a policy, it is a disk that fills.
 * A rover at 30 fps with ten objects in frame emits ~18,000 detections a
 * minute; an hour is a million records for a walk whose useful output is maybe
 * forty moments. So detections are capped, and — the part that matters — the
 * caller is TOLD when the cap bit, in the same response that says how many were
 * accepted. A silent truncation would make the count in the response a lie.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAME DURABILITY SEAM AS EVERY OTHER STORE
 *
 * `lib/persist.ts`, one record per trip, hydrate-on-first-read and
 * write-through after every change. Not Supabase: there is no project
 * configured here, and an untested persistence layer fails silently in exactly
 * the way that loses the data it was added to protect. When there is a project,
 * this swaps behind the same three functions as the rest.
 */
import { __wipeStore, forget, hydrate, persist } from "../persist";
import type { Detection, Moment } from "../types";

/** The sidecar namespace under `.data/`. */
const STORE = "ingest";

/**
 * How many trips are remembered at once.
 *
 * A trip here is a rover session, not a user's walk, and the interesting one is
 * always the recent one. Matches the spirit of `MAX_WALKS` in uploadedTrips.
 */
export const MAX_TRIPS = 20;

/**
 * Detections kept per trip, newest last.
 *
 * 5,000 is about twenty seconds of a busy frame at 30 fps, or several minutes
 * of a sparse one — enough to hold the window a moment was scored out of, which
 * is what anyone would go back to the raw feed FOR. It is not an archive and
 * this file does not pretend it is one.
 */
export const MAX_DETECTIONS_PER_TRIP = 5_000;

export interface IngestedTrip {
  tripId: string;
  /** Newest last. Trimmed to MAX_DETECTIONS_PER_TRIP. */
  detections: Detection[];
  /** Keyed by moment id, so a re-post of the same moment updates rather than doubles. */
  moments: Moment[];
  firstSeen: string;
  lastSeen: string;
  /**
   * Detections this trip has ever reported, including ones since trimmed.
   *
   * Kept because `detections.length` stops being the answer to "how much did
   * the rover send" the moment the cap bites, and a number that quietly changes
   * meaning is worse than no number.
   */
  totalDetections: number;
}

interface Store {
  trips: Map<string, IngestedTrip>;
  hydrated: boolean;
}

const KEY = Symbol.for("spark.ingest.store");

function parse(raw: unknown): IngestedTrip | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<IngestedTrip>;
  if (typeof r.tripId !== "string" || !r.tripId) return null;
  return {
    tripId: r.tripId,
    detections: Array.isArray(r.detections) ? (r.detections as Detection[]) : [],
    moments: Array.isArray(r.moments) ? (r.moments as Moment[]) : [],
    firstSeen: typeof r.firstSeen === "string" ? r.firstSeen : new Date().toISOString(),
    lastSeen: typeof r.lastSeen === "string" ? r.lastSeen : new Date().toISOString(),
    totalDetections:
      typeof r.totalDetections === "number" && r.totalDetections >= 0
        ? r.totalDetections
        : Array.isArray(r.detections)
          ? r.detections.length
          : 0,
  };
}

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { trips: new Map(), hydrated: false };
    g[KEY] = s;
  }
  if (!s.hydrated) {
    s.hydrated = true;
    for (const trip of hydrate<IngestedTrip>(STORE, parse)) {
      s.trips.set(trip.tripId, trip);
    }
  }
  return s;
}

function touch(tripId: string): IngestedTrip {
  const s = store();
  let trip = s.trips.get(tripId);
  const now = new Date().toISOString();
  if (!trip) {
    trip = {
      tripId,
      detections: [],
      moments: [],
      firstSeen: now,
      lastSeen: now,
      totalDetections: 0,
    };
    s.trips.set(tripId, trip);
    evict();
  }
  trip.lastSeen = now;
  return trip;
}

/**
 * Drop the least recently seen trips past the cap.
 *
 * By `lastSeen` rather than `firstSeen`: a long-running session that is still
 * reporting is the one you must not evict, and it is also the one with the
 * oldest `firstSeen`.
 */
function evict(): void {
  const s = store();
  if (s.trips.size <= MAX_TRIPS) return;
  const byAge = [...s.trips.values()].sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
  for (const trip of byAge.slice(0, s.trips.size - MAX_TRIPS)) {
    s.trips.delete(trip.tripId);
    // Deliberately NOT `forget`ed from disk here — see the note on
    // `forgetIngestedTrip`. Eviction is a memory policy; deleting somebody's
    // only record of a session is a decision, and this is not the place that
    // gets to make it silently.
  }
}

export interface RecordResult {
  stored: number;
  /** Trimmed by the per-trip cap on this call. Zero in the normal case. */
  dropped: number;
  /** Detections held for this trip after the write. */
  held: number;
  /** Everything this trip has ever reported, trimmed or not. */
  total: number;
}

/** Append a validated batch. Returns what was kept and what the cap took. */
export function recordDetections(tripId: string, batch: Detection[]): RecordResult {
  const trip = touch(tripId);
  trip.totalDetections += batch.length;
  trip.detections.push(...batch);

  let dropped = 0;
  if (trip.detections.length > MAX_DETECTIONS_PER_TRIP) {
    dropped = trip.detections.length - MAX_DETECTIONS_PER_TRIP;
    // Oldest go. The recent window is the one a moment was scored out of.
    trip.detections = trip.detections.slice(dropped);
  }

  persist(STORE, tripId, trip);
  return {
    stored: batch.length,
    dropped,
    held: trip.detections.length,
    total: trip.totalDetections,
  };
}

/** Store a moment, replacing any earlier version of the same id. */
export function recordMoment(moment: Moment): { stored: true; held: number } {
  const trip = touch(moment.tripId);
  const at = trip.moments.findIndex((m) => m.id === moment.id);
  if (at >= 0) trip.moments[at] = moment;
  else trip.moments.push(moment);
  persist(STORE, moment.tripId, trip);
  return { stored: true, held: trip.moments.length };
}

export function getIngestedTrip(tripId: string): IngestedTrip | null {
  return store().trips.get(tripId) ?? null;
}

export function listIngestedTrips(): IngestedTrip[] {
  return [...store().trips.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/**
 * Forget a trip, on disk as well.
 *
 * Separate from eviction on purpose, and not called by it: a cap running out of
 * room is a reason to stop holding something in memory, not a reason to destroy
 * the only copy. Deleting is an action somebody has to ask for.
 */
export function forgetIngestedTrip(tripId: string): boolean {
  const s = store();
  const had = s.trips.delete(tripId);
  forget(STORE, tripId);
  return had;
}

/** Tests only: clear memory AND disk. */
export function __resetIngest(): void {
  const s = store();
  s.trips.clear();
  __wipeStore(STORE);
  s.hydrated = true;
}

/**
 * Tests only: clear what this process holds and leave the disk alone.
 *
 * The honest simulation of a restart, and the only one worth asserting against
 * — see the header of scripts/verify-persistence.ts. `__resetIngest` would wipe
 * both halves and pass happily against a store that never wrote anything.
 */
export function __simulateRestart(): void {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  g[KEY] = undefined;
}
