/**
 * GET /api/trips/:tripId — the trip view model.
 *
 * Reads from lib/mock today and from the DB tomorrow. Deliberately returns the
 * same `TripView` shape the pages consume, minus the raw detections (thousands of
 * rows; the binned lane is what the UI needs).
 */
import { NextResponse } from "next/server";
import { getObjectIndexView, getTripView, listTripIds } from "@/lib/tripData";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { tripId } = await params;
  const trip = getTripView(tripId);

  if (!trip) {
    return NextResponse.json(
      { error: "trip not found", known: listTripIds() },
      { status: 404 },
    );
  }

  // Non-null: getTripView resolved, so the spec exists.
  const index = getObjectIndexView(tripId)!;

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
