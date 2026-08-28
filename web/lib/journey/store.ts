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
 *   · It DOES now survive a restart, and it did not used to. A journey hands
 *     out a link — `/journey/<id>` — and while this was a bare `globalThis`
 *     singleton that link 404'd after any restart or redeploy. Handing someone
 *     a URL you know will stop working is the same class of unkeepable promise
 *     the rest of this module is arranged against, so each journey is now
 *     written to `.data/journeys/<id>.json` and read back on first use. See
 *     lib/persist.ts, and lib/splatJobs.ts for the pattern it generalises.
 *
 *     Two things this does NOT buy, both of which matter:
 *       — It is single process and single machine. On a serverless host with an
 *         ephemeral filesystem it buys nothing at all; that case needs the
 *         Supabase schema in supabase/migrations/, which is written and not yet
 *         wired. `hydrate`/`persist`/`forget` is the seam that swap replaces.
 *       — Persistence is BEST EFFORT. A write that fails is swallowed, because
 *         a full disk should not turn a journey someone just built into a 500.
 *         So a link is durable in the ordinary case and not guaranteed to be.
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
import { mintId } from "../ids";
import { normaliseTitle } from "../albums";
import { __wipeStore, forget, hydrate, persist } from "../persist";
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
  /** Whether the disk sidecars have been read back into this process yet. */
  hydrated: boolean;
}

const KEY = Symbol.for("spark.journeys.store");

/** Sidecar directory name under `.data/`. See lib/persist.ts. */
const STORE_NAME = "journeys";

/**
 * Is this parsed JSON a journey we are willing to serve?
 *
 * Deliberately structural rather than exhaustive. It checks the fields that
 * every consumer dereferences without guarding — an id, a createdAt to sort by,
 * a route with a clips array, and legs — and lets the rest through as written.
 * A DerivedRoute is a large shape and re-validating all of it here would put a
 * second, drifting definition of "valid route" next to lib/journey/clips.ts.
 *
 * What matters is the rule: anything that fails is DROPPED, not repaired. A
 * half-understood journey is reachable at `/journey/<id>`, and a page that
 * renders a route we could not vouch for is worse than a 404.
 */
function parseJourney(raw: unknown): Journey | null {
  if (typeof raw !== "object" || raw === null) return null;
  const j = raw as Partial<Journey>;
  if (typeof j.id !== "string" || !isJourneyId(j.id)) return null;
  if (typeof j.createdAt !== "string" || Number.isNaN(Date.parse(j.createdAt))) return null;
  if (typeof j.route !== "object" || j.route === null) return null;
  if (!Array.isArray((j.route as DerivedRoute).clips)) return null;
  if (!Array.isArray(j.legs)) return null;
  if (j.title !== null && typeof j.title !== "string") return null;
  return j as Journey;
}

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
  const s = (g[KEY] ??= { journeys: new Map(), hydrated: false });

  // Read the sidecars back exactly once per process, on first use rather than
  // at import: importing this module must stay free, and a route that never
  // touches journeys should not pay for a directory scan.
  if (!s.hydrated) {
    s.hydrated = true; // set first — a throw below must not retry forever
    const found = hydrate(STORE_NAME, parseJourney);
    // Oldest first, so the Map's insertion order still means "age" and the
    // eviction loop in createJourney drops the right one.
    found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const journey of found.slice(-MAX_JOURNEYS)) {
      s.journeys.set(journey.id, journey);
    }
    // Anything past the cap on disk is deleted rather than left: it can never
    // be served from this process, and a sidecar nobody will read is litter
    // that grows without bound.
    for (const journey of found.slice(0, Math.max(0, found.length - MAX_JOURNEYS))) {
      forget(STORE_NAME, journey.id);
    }
  }
  return s;
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
  // Unguessable, not just unique — /journey/<id> is a share link, and the id is
  // the whole of its access control today. See lib/ids.ts.
  const id = mintId(JOURNEY_ID_PREFIX, now);

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
  // Write-through, best effort. A journey that cannot be written to disk is
  // still correct for this process and still has a working link until the next
  // restart, so a failure here must not fail the request that created it.
  persist(STORE_NAME, id, journey);

  while (s.journeys.size > MAX_JOURNEYS) {
    // Map iterates in insertion order, so the first key is the oldest.
    const oldest = [...s.journeys.keys()][0];
    s.journeys.delete(oldest);
    // Evict from disk too, or the next restart would hydrate a journey this
    // process has already decided is gone -- and the cap would mean nothing.
    forget(STORE_NAME, oldest);
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

/**
 * Drop everything this process holds WITHOUT touching disk, so the next call
 * hydrates from the sidecars again.
 *
 * This is what a server restart actually is, and it is the only way to test
 * that durability works: `__resetJourneys` wipes both halves, which would make
 * a persistence test pass against a store that never wrote anything. Tests
 * only — a route calling this would silently drop journeys mid-request.
 */
export function __simulateRestart(): void {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  g[KEY] = { journeys: new Map(), hydrated: false };
}

export function __resetJourneys(): void {
  __wipeStore(STORE_NAME);
  const s = store();
  s.journeys.clear();
  // Re-arm hydration: a test that resets and then writes must not have the
  // NEXT store() call read back sidecars this one deliberately removed.
  s.hydrated = true;
}
