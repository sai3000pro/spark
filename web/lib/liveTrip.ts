/**
 * The in-flight trip.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS AND IS NOT — read before relying on it.
 *
 * A module-level singleton stashed on globalThis. That buys exactly one thing:
 * it survives Next's dev module reloading, so starting a trip and then editing a
 * file does not silently forget it. Everything else is a limitation:
 *
 *   · It does NOT survive a dev-server restart or a rebuild.
 *   · SINGLE PROCESS ONLY. Any multi-worker `next start`, any serverless deploy,
 *     and two requests can land on two different stores. There is one robot and
 *     one demo laptop, so this is a correct trade today and a wrong one the
 *     moment it isn't.
 *   · ONE SESSION FOR THE WHOLE APP. There are no user accounts, so a trip
 *     belongs to the installation rather than to a person — which is exactly what
 *     a robot in someone's hallway actually is. Add a `userId` field here and key
 *     the store by it if accounts ever arrive.
 *   · Nothing is written to disk.
 *
 * Swapping it for a database is a ONE-FILE change: every consumer goes through
 * startTrip / stopTrip / getActiveTrip / noteIngest and never touches the store.
 * Make those four async, add `await` in the three route handlers, done. Same
 * promise lib/tripData.ts makes about reading from Postgres tomorrow.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No `next/*` imports — scripts/verify-pipeline.ts reaches this file, and it runs
 * under tsx.
 */
import { buildTrip } from "./mock/buildTrip";
import { PIPELINE_CONFIG } from "./pipeline";
import { waterlooPark } from "./mock/trips/waterloo-park";
import type { GeoPoint } from "./types";

export type LiveTripStatus = "starting" | "recording" | "stopping" | "processing";

export interface LiveCounters {
  detections: number;
  candidates: number;
  moments: number;
}

interface ActiveTrip {
  id: string;
  startedAt: string;
  /** Set by stopTrip. Status is derived from it rather than from a timer. */
  endedAt: string | null;
  origin: GeoPoint;
  placeLabel: string;
  region: string;
  country: string;
  source: "ui" | "robot";
  /** Real counts reported by /api/ingest/*. Null until the robot actually speaks. */
  reported: LiveCounters | null;
  lastIngestAt: string | null;
}

/** What crosses the wire. Serializable, and honest about what it is. */
export interface ActiveTripSnapshot {
  id: string;
  status: LiveTripStatus;
  startedAt: string;
  endedAt: string | null;
  /** Seeds the first client paint only — the client then ticks its own clock. */
  elapsedSec: number;
  origin: GeoPoint;
  placeLabel: string;
  region: string;
  country: string;
  counters: LiveCounters;
  /** True while the counters are extrapolated from elapsed time, not measured. */
  simulated: boolean;
  /** Matches the ingest routes' flag. Nothing here is written anywhere. */
  persisted: false;
}

export interface StartTripInput {
  placeLabel?: string;
  region?: string;
  country?: string;
  origin?: GeoPoint;
  source?: "ui" | "robot";
}

export class TripConflictError extends Error {
  constructor(
    message: string,
    readonly active: ActiveTripSnapshot | null,
  ) {
    super(message);
    this.name = "TripConflictError";
  }
}

/** How long the "building the album" state lasts after a stop. */
export const PROCESSING_SEC = 12;

/** The first moments of a session, before it settles into recording. */
const STARTING_MS = 800;

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

interface Store {
  active: ActiveTrip | null;
  serverStartedAt: string;
}

const KEY = Symbol.for("spark.liveTrip.store");

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const fresh: Store = { active: null, serverStartedAt: new Date().toISOString() };
  g[KEY] = fresh;
  return fresh;
}

export const serverStartedAt = (): string => store().serverStartedAt;

// ─────────────────────────────────────────────────────────────────────────────
// Counters
//
// When nothing has been reported, the numbers are extrapolated from elapsed time
// using the REAL pipeline tunables and the demo trip's own promotion rates —
// computed once at module load, not hardcoded. So the live readout and the
// finished albums agree with each other instead of being two separate fictions.
// buildTrip is memoized, so this costs nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** Stage 1 runs at ~10 fps with drops. */
const DETECTION_HZ = 9.4;

const RATES = (() => {
  const { trip } = buildTrip(waterlooPark);
  const durationSec =
    (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000;
  const windows = Math.max(
    1,
    Math.floor((durationSec - PIPELINE_CONFIG.windowSec) / PIPELINE_CONFIG.strideSec) + 1,
  );
  const candidates = trip.candidates.length;
  const promoted = trip.candidates.filter((c) => c.status === "promoted").length;
  return {
    candidatePerWindow: candidates / windows,
    promotedPerCandidate: candidates ? promoted / candidates : 0,
  };
})();

function simulateCounters(elapsedSec: number): LiveCounters {
  const windows = Math.max(
    0,
    Math.floor((elapsedSec - PIPELINE_CONFIG.windowSec) / PIPELINE_CONFIG.strideSec) + 1,
  );
  const candidates = Math.round(windows * RATES.candidatePerWindow);
  return {
    detections: Math.round(elapsedSec * DETECTION_HZ),
    candidates,
    moments: Math.round(candidates * RATES.promotedPerCandidate),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export function startTrip(input: StartTripInput = {}): ActiveTripSnapshot {
  const current = getActiveTrip();
  if (current) {
    throw new TripConflictError("a trip is already in progress", current);
  }

  const now = new Date();
  store().active = {
    id: `trip_live_${now.getTime().toString(36)}`,
    startedAt: now.toISOString(),
    endedAt: null,
    origin: input.origin ?? { lat: 43.4735, lng: -80.531 },
    placeLabel: input.placeLabel ?? "Current location",
    region: input.region ?? "—",
    country: input.country ?? "—",
    source: input.source ?? "ui",
    reported: null,
    lastIngestAt: null,
  };

  return getActiveTrip()!;
}

export function stopTrip(tripId?: string): ActiveTripSnapshot {
  const active = store().active;
  const snapshot = getActiveTrip();

  if (!active || !snapshot) {
    throw new TripConflictError("no trip in progress", null);
  }
  // Guards a stale tab stopping a trip that a different tab already replaced.
  if (tripId && tripId !== active.id) {
    throw new TripConflictError("that trip is not the one in progress", snapshot);
  }
  if (active.endedAt) return snapshot;

  active.endedAt = new Date().toISOString();
  return getActiveTrip()!;
}

/**
 * Status is DERIVED, never ticked.
 *
 * No setTimeout, no interval, nothing to leak, and it is correct on a cold read
 * after the process has been idle for an hour. Same derive-don't-sync discipline
 * as MomentDetail.
 */
export function getActiveTrip(): ActiveTripSnapshot | null {
  const s = store();
  const active = s.active;
  if (!active) return null;

  const now = Date.now();
  const startedMs = Date.parse(active.startedAt);
  const elapsedSec = Math.max(0, (now - startedMs) / 1000);

  let status: LiveTripStatus;
  if (!active.endedAt) {
    status = now - startedMs < STARTING_MS ? "starting" : "recording";
  } else {
    const sinceEnd = (now - Date.parse(active.endedAt)) / 1000;
    if (sinceEnd >= PROCESSING_SEC) {
      // The session is over and has been collected. Clearing it here rather than
      // on a timer is what keeps this module free of scheduled work.
      s.active = null;
      return null;
    }
    status = "processing";
  }

  // Once stopped, the counters freeze at their value from the moment of the stop.
  const measuredSec = active.endedAt
    ? (Date.parse(active.endedAt) - startedMs) / 1000
    : elapsedSec;

  return {
    id: active.id,
    status,
    startedAt: active.startedAt,
    endedAt: active.endedAt,
    elapsedSec: Math.round(measuredSec),
    origin: active.origin,
    placeLabel: active.placeLabel,
    region: active.region,
    country: active.country,
    counters: active.reported ?? simulateCounters(measuredSec),
    simulated: active.reported === null,
    persisted: false,
  };
}

/**
 * The robot reporting in.
 *
 * The moment /api/ingest/* calls this with the active trip's id, `reported` goes
 * non-null, `simulated` flips to false, the "simulated counters" badge disappears
 * from the UI, and the numbers become real — with no other code change anywhere.
 * That is the whole point of the seam.
 */
export function noteIngest(tripId: string, delta: Partial<LiveCounters>): boolean {
  const active = store().active;
  if (!active || active.id !== tripId || active.endedAt) return false;

  const base = active.reported ?? { detections: 0, candidates: 0, moments: 0 };
  active.reported = {
    detections: base.detections + (delta.detections ?? 0),
    candidates: base.candidates + (delta.candidates ?? 0),
    moments: base.moments + (delta.moments ?? 0),
  };
  active.lastIngestAt = new Date().toISOString();
  return true;
}

/** Test seam — the only way to clear state without waiting out PROCESSING_SEC. */
export function __resetLiveTrip(): void {
  store().active = null;
}
