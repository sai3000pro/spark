/**
 * POST /api/trip/start — open a recording session.
 *
 * Day-2 integration seam, same shape as the ingest routes. The response says
 * plainly, in the payload rather than in a comment nobody reads, that starting a
 * trip does NOT drive the robot: `followMode: false`. That behaviour is not
 * implemented yet, and the UI should not imply otherwise.
 */
import { NextResponse } from "next/server";
import { TripConflictError, startTrip } from "@/lib/liveTrip";
import { validateStartTrip } from "@/lib/validate";

/** See the note in ../active/route.ts — mutable state must not be prerendered. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  // An empty body is the normal case: the toolbar button sends nothing.
  let body: unknown = null;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const result = validateStartTrip(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const active = startTrip(result.value);
    return NextResponse.json(
      {
        active,
        persisted: false,
        note: "In-memory only. Restarting the server forgets this.",
        followMode: false,
        followModeNote:
          "The rover-follow behaviour is not implemented. Starting a trip opens the recording session; nothing is driving the robot.",
      },
      { status: 202, headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof TripConflictError) {
      // Hand back the live snapshot so a stale tab can heal itself.
      return NextResponse.json(
        { error: err.message, active: err.active },
        { status: 409, headers: NO_STORE },
      );
    }
    throw err;
  }
}

export function GET() {
  return NextResponse.json(
    {
      endpoint: "POST /api/trip/start",
      accepts: "StartTripInput (every field optional)",
      contract: "lib/liveTrip.ts → StartTripInput",
      example: {
        placeLabel: "Waterloo Park",
        region: "Waterloo, ON",
        country: "Canada",
        origin: { lat: 43.4735, lng: -80.531 },
        source: "robot",
      },
      statuses: {
        202: "session opened, snapshot returned",
        400: "validation failed",
        409: "a trip is already in progress (the live snapshot is included)",
      },
    },
    { status: 200 },
  );
}
