/**
 * POST /api/journey — lay several clips out as one route.
 * GET  /api/journey — the list, in summary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A JOURNEY IS
 *
 * One clip is a walk; `/api/upload/walk` builds those. A JOURNEY is several
 * clips in order plus the route between them — you filmed the courtyard,
 * stopped, walked to the fountain, filmed that, walked on. The gaps are as much
 * a part of the afternoon as the clips, and nothing in this codebase had a place
 * to put them until lib/journey/. Read lib/journey/clips.ts before touching
 * anything here: its one rule — MEASURED AND ASSUMED ARE NEVER THE SAME FIELD —
 * is what every check below is in service of.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ENDPOINT REFUSES TO TAKE FROM THE CLIENT
 *
 * The route. Not "validates loosely", not "checks and then trusts" — a
 * `route` in the request body is read by nothing and stored by nothing.
 *
 * A client sends two things: the FACTS it read off each file (in the browser,
 * because the drop path deliberately never uploads the video — see
 * lib/journey/clips.ts) and the CORRECTIONS the person made on screen. The
 * server then runs `applyCorrections` over those, exactly as the page did, and
 * stores that. Same function, same inputs, so the stored route and the route
 * the reader was looking at cannot drift apart. Accepting a route instead would
 * mean the map on the page is the only thing that ever computed it, and the
 * server would be a filing cabinet for whatever a POST felt like claiming.
 *
 * The facts themselves are checked field by field for the same reason
 * `/api/upload/walk` checks its audio events: these numbers decide where dots
 * land on a map. A field that is present but wrong — a lat of 900, a duration
 * of -1, a timestamp that is not a date — is reduced to NULL rather than
 * clamped into range. Dropping under-reports, which the whole module is built
 * to survive: null is the ordinary case in `ClipFacts` and `deriveRoute` knows
 * how to say "we do not know". Clamping a lat of 900 to 90 draws a confident
 * pin in the Arctic that nobody measured, and nothing downstream can tell it
 * from a real fix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT DOES NOT PERSIST
 *
 * lib/journey/store.ts is a globalThis map. A journey is gone the moment the
 * process is, and the `note` on every response says so in words rather than
 * leaving the caller to find out.
 */
import { NextResponse } from "next/server";

import { applyCorrections, parseCorrections } from "@/lib/journey/corrections";
import { countLegs, createJourney, listJourneys, summariseJourney } from "@/lib/journey/store";
import type { JourneyLeg } from "@/lib/journey/store";
import type { ClipFacts } from "@/lib/journey/clips";
import type { GeoPoint } from "@/lib/types";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Beyond this it is not a journey, it is a media library.
 *
 * Every clip costs a haversine chain and a row on a page somebody has to read;
 * fifty is already more legs than anyone will scroll. The cap is stated in the
 * error because "400" on a 200-clip POST is indistinguishable from a bug.
 */
const MAX_CLIPS = 50;

/** Minutes east of UTC. ±14:00 is the widest offset any place on earth uses. */
const MAX_UTC_OFFSET_MIN = 840;

// Length caps on the free-text fields. These are strings that get rendered, and
// an unbounded one is a way to make a page unreadable with a single request.
const MAX_ID_CHARS = 200;
const MAX_NAME_CHARS = 400;
const MAX_DEVICE_CHARS = 200;

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const rawClips = body.clips;
  if (!Array.isArray(rawClips) || rawClips.length === 0) {
    return NextResponse.json(
      { error: "clips must be a non-empty array of { facts, tripId?, splatJobId? }" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (rawClips.length > MAX_CLIPS) {
    return NextResponse.json(
      { error: `too many clips: ${rawClips.length} sent, ${MAX_CLIPS} is the cap` },
      { status: 400, headers: NO_STORE },
    );
  }

  const facts: ClipFacts[] = [];
  const legs: JourneyLeg[] = [];
  const errors: string[] = [];

  // Ids are how a correction addresses a clip — `{ kind: "location", clipId }`
  // means nothing if two clips answer to the same string. A duplicate is not a
  // cosmetic problem: it is an edit that silently moves the wrong dot, and the
  // reader would have no way to see that it did. So it is a 400 rather than a
  // rename or a first-wins.
  const seen = new Set<string>();

  rawClips.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`clips[${i}] must be an object`);
      return;
    }
    const row = entry as Record<string, unknown>;
    const checked = validateFacts(row.facts, i);
    if ("error" in checked) {
      errors.push(checked.error);
      return;
    }
    if (seen.has(checked.facts.id)) {
      errors.push(`clips[${i}] repeats facts.id ${JSON.stringify(checked.facts.id)}`);
      return;
    }
    seen.add(checked.facts.id);

    facts.push(checked.facts);
    legs.push({
      clipId: checked.facts.id,
      // Unverified by design — the store's header is explicit that a leg
      // NAMING a walk is not a leg that has one. Nothing here goes and looks.
      tripId: nonEmptyString(row.tripId, MAX_ID_CHARS),
      splatJobId: nonEmptyString(row.splatJobId, MAX_ID_CHARS),
    });
  });

  if (errors.length > 0) {
    return NextResponse.json(
      { error: "validation failed", errors: errors.slice(0, 20) },
      { status: 400, headers: NO_STORE },
    );
  }

  // The one line that matters. `parseCorrections` throws away edits it cannot
  // read; `applyCorrections` turns facts plus edits into the route. The client
  // never got a vote on the output, only on the inputs.
  const route = applyCorrections(facts, parseCorrections(body.corrections));

  const journey = createJourney({
    route,
    legs,
    title: nonEmptyString(body.title, MAX_NAME_CHARS),
  });

  return NextResponse.json(
    {
      journeyId: journey.id,
      // `/journey/<id>`, which is the page that renders this. Written out here
      // rather than assembled at the caller for the reason /api/upload/walk
      // learned the hard way: a button pointing at a URL nobody serves looks
      // exactly like a feature that does not work.
      href: `/journey/${journey.id}`,
      route: journey.route,
      persisted: false,
      note: noteFor(countLegs(journey)),
    },
    { status: 201, headers: NO_STORE },
  );
}

/**
 * The list. Summaries, not routes.
 *
 * `summariseJourney` exists precisely so this does not hand back thirty full
 * `DerivedRoute`s — each carries every clip, every warning and every assumption,
 * and a chooser screen needs a title and a distance. The full route is one more
 * request away at `/api/journey/<id>`.
 */
export function GET() {
  const journeys = listJourneys().map(summariseJourney);
  return NextResponse.json(
    {
      journeys,
      count: journeys.length,
      note:
        "In memory only. Restarting the server forgets every one of these. " +
        "Summaries — GET /api/journey/<id> for the full route. " +
        "`legsWithWalk` counts legs that NAME an uploaded walk; none of them were checked to still exist.",
    },
    { status: 200, headers: NO_STORE },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The facts, checked before they are believed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One clip's facts, or the sentence explaining why not.
 *
 * `id`, `name` and `bytes` are required — they are non-nullable in `ClipFacts`
 * and there is no honest null to fall back to, so their absence is a 400 and
 * not a repair. `bytes` is included in that even when it is merely out of range
 * (negative, NaN, infinite): the field cannot hold null, so the choice is
 * between refusing the request and inventing a size, and inventing is the one
 * thing this module does not do.
 *
 * Everything else is nullable, and everything else that fails its check becomes
 * null. See the header for why that is dropping and not clamping.
 */
function validateFacts(raw: unknown, at: number): { facts: ClipFacts } | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: `clips[${at}].facts must be an object` };
  }
  const v = raw as Record<string, unknown>;

  const id = nonEmptyString(v.id, MAX_ID_CHARS);
  if (!id) {
    return { error: `clips[${at}].facts.id is required (a non-empty string, ≤${MAX_ID_CHARS} chars)` };
  }
  const name = nonEmptyString(v.name, MAX_NAME_CHARS);
  if (!name) {
    return {
      error: `clips[${at}].facts.name is required (a non-empty string, ≤${MAX_NAME_CHARS} chars)`,
    };
  }
  if (typeof v.bytes !== "number" || !Number.isFinite(v.bytes) || v.bytes < 0) {
    return { error: `clips[${at}].facts.bytes is required and must be a finite number ≥ 0` };
  }

  return {
    facts: {
      id,
      name,
      bytes: v.bytes,
      // Must survive Date.parse, because everything downstream compares these
      // as epoch ms (`epochOf`). A string that parses to NaN would sort as if
      // it had no time at all while still LOOKING like a timestamp on screen.
      recordedAt: isoOrNull(v.recordedAt),
      utcOffsetMin: numberInRange(v.utcOffsetMin, -MAX_UTC_OFFSET_MIN, MAX_UTC_OFFSET_MIN),
      location: geoOrNull(v.location),
      // No range: a fix on a plane and a fix in a mine are both real, and this
      // field is displayed rather than computed with. Finite is the whole bar.
      altitudeM: numberInRange(v.altitudeM, -Infinity, Infinity),
      device: nonEmptyString(v.device, MAX_DEVICE_CHARS),
      // A negative or infinite duration is not a short clip, it is a wrong
      // number, and `legSeconds` would carry it straight into a speed.
      durationSec: numberInRange(v.durationSec, 0, Infinity),
      // NEVER promoted into `recordedAt`, here or anywhere — see the field's
      // own comment in lib/journey/clips.ts. Copying a clip off a phone
      // rewrites mtime to the time of the copy.
      fileModifiedAt: isoOrNull(v.fileModifiedAt),
    },
  };
}

/** A usable string, or null. Over the cap is dropped, not truncated. */
function nonEmptyString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** The string back if it is a date, else null. Never a repaired date. */
function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return null;
  return Number.isFinite(Date.parse(v)) ? v : null;
}

function numberInRange(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v >= min && v <= max ? v : null;
}

/**
 * A coordinate, or nothing.
 *
 * Both halves have to be good: a point with a valid lat and a lng of 400 is not
 * "mostly located", it is a pin somewhere nobody was, and half a fix renders
 * with exactly the same confidence as a whole one.
 */
function geoOrNull(v: unknown): GeoPoint | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const lat = numberInRange(p.lat, -90, 90);
  const lng = numberInRange(p.lng, -180, 180);
  return lat === null || lng === null ? null : { lat, lng };
}

/**
 * What the caller is allowed to say out loud about what just happened.
 *
 * Two facts, both of which a caller will otherwise get wrong: this did not
 * touch a disk, and N clips is not N walks. `countLegs` counts legs that NAME
 * an uploaded trip — the store never verifies one exists — so the sentence says
 * "name", and the clips with no `tripId` are counted rather than rounded away.
 */
function noteFor(counts: { total: number; named: number; unnamed: number }): string {
  const { total, named, unnamed } = counts;
  const built =
    named === 0
      ? `None of the ${total} legs name an uploaded walk — this is a route over clips, not over built walks.`
      : named === total
        ? `All ${total} legs name an uploaded walk, though none of those names was checked to still resolve.`
        : `${named} of ${total} legs name an uploaded walk; the other ${unnamed} are laid out, not built.`;

  return `In memory only. Restarting the server forgets this journey. ${built}`;
}
