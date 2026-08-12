/**
 * POST /api/trip/stop — close the recording session.
 *
 * The session does not disappear immediately: it enters `processing` for
 * PROCESSING_SEC so the UI has a real state to render while the pipeline would be
 * doing stage-3 work. After that it is collected and /api/trip/active returns
 * null again.
 */
import { NextResponse } from "next/server";
import { PROCESSING_SEC, TripConflictError, stopTrip } from "@/lib/liveTrip";
import { validateStopTrip } from "@/lib/validate";

/** See the note in ../active/route.ts — mutable state must not be prerendered. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const result = validateStopTrip(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const active = stopTrip(result.value.tripId);
    return NextResponse.json(
      {
        active,
        processingSec: PROCESSING_SEC,
        persisted: false,
        momentsPromoted: active.counters.moments,
        // Always true now: a session only exists because something reported
        // into it, so there is no "captured nothing" case left to disclaim.
        capturedFromRobot: true,
        note: "Ingested data was attached to this session.",
      },
      { status: 202, headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof TripConflictError) {
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
      endpoint: "POST /api/trip/stop",
      accepts: "{ tripId?: string }",
      contract: "lib/liveTrip.ts → ActiveTripSnapshot",
      note: `Passing tripId guards against a stale tab stopping a session another tab replaced. After stopping, the session reports 'processing' for ${PROCESSING_SEC}s and is then collected.`,
      statuses: {
        202: "session closed, snapshot returned in the processing state",
        400: "validation failed",
        409: "no trip in progress, or tripId does not match the live one",
      },
    },
    { status: 200 },
  );
}
