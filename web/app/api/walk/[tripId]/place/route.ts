/**
 * POST /api/walk/[tripId]/place — say where this walk happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PERSON GETS TO OVERRIDE THE FILE
 *
 * The container is the better source and is frequently empty: location services
 * are off by default for the camera on plenty of phones, and several ordinary
 * sharing paths strip the tag. Before this, that left the walk pinned to a
 * hardcoded Toronto street corner with no way to correct it.
 *
 * So the order of preference is: the file's own fix (lib/video/probeMetadata.ts,
 * read at build time), then this, then the placeholder. A typed answer is a
 * statement of fact by somebody who was there, and it is marked `originMeasured`
 * for the same reason a metadata fix is — what that flag separates is a claim
 * from a placeholder, not one kind of claim from another.
 *
 * Accepts a coordinate OR a place name. A coordinate is parsed locally and
 * never sent anywhere; a name goes to Nominatim once, on submit. See
 * lib/geo/geocode.ts, which never throws and returns null rather than guessing.
 */
import { NextResponse } from "next/server";

import { resolvePlace } from "@/lib/geo/geocode";
import { getUploadedWalk, setWalkPlace } from "@/lib/uploadedTrips";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Long enough for "1600 Amphitheatre Parkway, Mountain View, CA", short enough. */
const MAX_QUERY = 200;

interface Ctx {
  params: Promise<{ tripId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!getUploadedWalk(tripId)) {
    return NextResponse.json({ error: "no such walk" }, { status: 404, headers: NO_STORE });
  }

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY) : "";
  if (!query) {
    return NextResponse.json(
      { error: "send a place name or a coordinate as `query`" },
      { status: 400, headers: NO_STORE },
    );
  }

  const found = await resolvePlace(query);
  if (!found) {
    // Not an error in this route's terms — the request was fine and the answer
    // is "nowhere I could find". 404 would suggest the WALK was missing.
    return NextResponse.json(
      {
        ok: false,
        note: `Could not place "${query}". Try a coordinate like 43.6406, -79.4019.`,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  // The geocoder's own label, so the trip says what was actually matched rather
  // than what was typed — "the park" resolving to a park in Ohio should be
  // visible immediately, not discovered on the globe later.
  setWalkPlace(tripId, {
    origin: { lat: found.lat, lng: found.lng },
    label: found.label ?? query,
  });

  return NextResponse.json(
    {
      ok: true,
      place: { lat: found.lat, lng: found.lng, label: found.label ?? query },
      source: found.source,
      note:
        found.source === "typed-coordinates"
          ? "Placed from the coordinate you typed."
          : found.source === "known-place"
            ? `Placed at ${found.label}.`
            : `Matched "${found.label ?? query}".`,
    },
    { status: 200, headers: NO_STORE },
  );
}
