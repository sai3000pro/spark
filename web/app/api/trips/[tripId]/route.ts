/**
 * GET /api/trips/:tripId — the trip view model.
 *
 * Reads from lib/mock today and from the DB tomorrow. Deliberately returns the
 * same `TripView` shape the pages consume, minus the raw detections (thousands of
 * rows; the binned lane is what the UI needs).
 */
import { NextResponse } from "next/server";
import { getObjectIndexView, getTripView } from "@/lib/tripData";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { tripId } = await params;
  const trip = getTripView();

  if (trip.id !== tripId) {
    return NextResponse.json(
      { error: "trip not found", known: [trip.id] },
      { status: 404 },
    );
  }

  const index = getObjectIndexView();

  return NextResponse.json({
    ...trip,
    objectIndex: index.entries.map((e) => ({
      label: e.label,
      lastSeenT: e.lastSeenT,
      sightings: e.sightings.length,
      bestMomentId: e.best.momentId,
      navTarget: e.navTarget,
    })),
  });
}
