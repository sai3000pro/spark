/**
 * Journeys: the thing that holds several walks together.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A JOURNEY IS
 *
 * One clip is a walk — lib/uploadedTrips.ts builds those. A JOURNEY is several
 * clips in order, plus the route between them: you filmed the courtyard,
 * stopped, walked to the fountain, filmed that, walked on. The gaps are part of
 * the route, and ./clips.ts is the contract that says what a file actually told
 * us versus what we worked out. Read that header first; every honesty rule in
 * this file is downstream of its one rule, which is that MEASURED AND ASSUMED
 * ARE NEVER THE SAME FIELD.
 *
 * A journey therefore holds two things:
 *
 *   · the ROUTE, which is derived — the output of `applyCorrections` over the
 *     facts the client read off the files, never a route the client sent. The
 *     server derives it so that the route in this store and the route on screen
 *     came out of the same function and cannot disagree.
 *   · the LEGS, which are the bookkeeping: for each clip, in route order, the
 *     uploaded trip it was built into, IF it was. `tripId: null` is the ordinary
 *     case, not a failure — someone can lay out a journey before, or without
 *     ever, running the single-clip pipeline over its footage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS STORE DOES NOT DO. Read before trusting anything it hands back.
 *
 *   · It does NOT persist. globalThis singleton, exactly the discipline in
 *     lib/uploadedTrips.ts, lib/albums.ts and lib/liveTrip.ts: it survives dev
 *     module reloads, it does NOT survive a server restart, it is single
 *     process, and nothing touches disk. A journey here is gone the moment the
 *     process is. Every route that returns one says so in words.
 *   · It does NOT verify that a `tripId` exists. A leg naming `trip_upload_x`
 *     is a leg that CLAIMS a walk, and this file never goes and looks. It can
 *     be a walk that was evicted past uploadedTrips' MAX_WALKS, or one from
 *     before the last restart, or a string a client made up. So the honest word
 *     for the count is "legs that name a walk", and callers must not print it
 *     as "legs that have one".
 *   · It does NOT dedupe across sessions. Posting the same five clips twice
 *     makes two journeys. There is no content hash and no notion of "the same
 *     footage" — the ids in ClipFacts are stable only within one selection, by
 *     that contract's own definition.
 *   · It does NOT re-derive. The route is computed once, at create time, from
 *     the facts and the corrections as they stood then. A later correction is a
 *     new journey, not a mutation of this one.
 *
 * No `next/*` imports, for the same reason lib/uploadedTrips.ts gives: the
 * verification scripts reach this under tsx, where `next/server` is not there to
 * be imported. `__resetJourneys` exists for them.
 */
import { normaliseTitle } from "../albums";
import type { DerivedRoute } from "./clips";

/**
 * One clip's row in the bookkeeping.
 *
 * `tripId` and `splatJobId` are separately nullable because they genuinely come
 * apart: a clip can have been built into a walk with no reconstruction asked
 * for, and a reconstruction can be in flight for a clip whose walk has not been
 * posted back yet. Collapsing them into one "processed" flag would report one
 * of those two as the other.
 */
export interface JourneyLeg {
  /** `ClipFacts.id` — how corrections address this clip, and how the route names it. */
  clipId: string;
  /** The uploaded walk built from this clip, if one was. Never checked to exist. */
  tripId: string | null;
  /** The reconstruction job started for this clip, if one was. Likewise unchecked. */
  splatJobId: string | null;
}

export interface Journey {
  id: string;
  createdAt: string;
  /** Trimmed and capped, or null. A journey with no name is fine — it has a route. */
  title: string | null;
  /** Derived here, never accepted from a client. See the header. */
  route: DerivedRoute;
  /** Per clip, in route order: the uploaded trip it was built into, if it was. */
  legs: JourneyLeg[];
}

/** Ids carry their own provenance so `journey_*` is greppable everywhere. */
export const JOURNEY_ID_PREFIX = "journey_";

export const isJourneyId = (id: string): boolean => id.startsWith(JOURNEY_ID_PREFIX);

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

interface Store {
  journeys: Map<string, Journey>;
}

const KEY = Symbol.for("spark.journeys.store");

/**
 * Beyond this the oldest is dropped.
 *
 * uploadedTrips caps at 8 because a walk carries ten thousand detections.
 * A journey is far lighter — a route over at most a few dozen clips, each one a
 * filename, a timestamp and a coordinate — so the number is higher. But it is
 * still a number, because the difference between "capped generously" and
 * "unbounded" is the difference between a cache and a memory leak with a
 * friendly name.
 *
 * Deliberately unlike lib/albums.ts, which caps nothing: an album is a decision
 * a person made and typed a name for, and evicting one loses something they
 * cannot get back. A journey is a derivation over files they still have, and
 * re-posting the same clips rebuilds it.
 */
export const MAX_JOURNEYS = 32;

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= { journeys: new Map() });
}

export function getJourney(id: string): Journey | null {
  return store().journeys.get(id) ?? null;
}

export function listJourneys(): Journey[] {
  return [...store().journeys.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface CreateJourneyInput {
  /** Already derived — the caller ran `applyCorrections`, this file does not. */
  route: DerivedRoute;
  /**
   * What was built from each clip. Order does not matter and is not read: the
   * legs are re-sorted into route order below, so the ordering invariant on
   * `Journey.legs` is guaranteed here rather than trusted from the caller.
   */
  legs: JourneyLeg[];
  title?: string | null;
}

export function createJourney(input: CreateJourneyInput): Journey {
  const now = new Date();
  // Time plus randomness, the way lib/albums.ts does it rather than the bare
  // timestamp in lib/uploadedTrips.ts. Two journeys posted in the same
  // millisecond is a thing a client loop can actually do, and with a bare
  // timestamp the second one would silently overwrite the first in the map.
  const id = `${JOURNEY_ID_PREFIX}${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const byClip = new Map(input.legs.map((leg) => [leg.clipId, leg]));

  // Route order, one row per clip the route actually knows about.
  //
  // A clip in the route with no leg supplied gets nulls — that is the honest
  // record of "laid out, not built". A leg naming a clip the route does not
  // contain is DROPPED rather than appended: it has no position on the journey,
  // so it could never be rendered, but it would still inflate any count of legs
  // with a walk behind them. A phantom that only shows up in the numbers is
  // worse than one that shows up nowhere.
  const legs: JourneyLeg[] = input.route.clips.map((clip) => {
    const supplied = byClip.get(clip.facts.id);
    return {
      clipId: clip.facts.id,
      tripId: supplied?.tripId ?? null,
      splatJobId: supplied?.splatJobId ?? null,
    };
  });

  const journey: Journey = {
    id,
    createdAt: now.toISOString(),
    // Same normaliser the albums use, so "is this a usable title" has one
    // answer in this codebase rather than two that disagree about whitespace.
    title: input.title ? normaliseTitle(input.title) : null,
    route: input.route,
    legs,
  };

  const s = store();
  s.journeys.set(id, journey);

  while (s.journeys.size > MAX_JOURNEYS) {
    // Map iterates in insertion order, so the first key is the oldest.
    const oldest = [...s.journeys.keys()][0];
    s.journeys.delete(oldest);
    // Nothing to unlink: albums file walks, not journeys, and a journey holds
    // ids rather than being held by one. If that ever changes, this is where
    // the dangling-reference cleanup goes — see forgetJourney in lib/albums.ts.
  }

  return journey;
}

/**
 * How many legs name a walk, and how many do not.
 *
 * "Name", not "have": see the header. This is the count that must go into any
 * sentence a person reads, because reporting N built when N clips merely
 * carried a string is the exact failure this whole module is arranged against.
 */
export function countLegs(journey: Journey): { total: number; named: number; unnamed: number } {
  const named = journey.legs.filter((leg) => leg.tripId !== null).length;
  return { total: journey.legs.length, named, unnamed: journey.legs.length - named };
}

/** The list-view shape: enough to choose one, nowhere near the whole route. */
export interface JourneySummary {
  id: string;
  title: string | null;
  createdAt: string;
  /** Every clip in the route, including ones the reader omitted. */
  clips: number;
  /** Sum of the KNOWN legs only. Holes are skipped, never estimated — see DerivedRoute. */
  totalMetres: number;
  /** Legs naming an uploaded walk. Unverified; see the header. */
  legsWithWalk: number;
}

export function summariseJourney(journey: Journey): JourneySummary {
  return {
    id: journey.id,
    title: journey.title,
    createdAt: journey.createdAt,
    clips: journey.route.clips.length,
    totalMetres: Math.round(journey.route.totalMetres),
    legsWithWalk: countLegs(journey).named,
  };
}

export function __resetJourneys(): void {
  store().journeys.clear();
}
