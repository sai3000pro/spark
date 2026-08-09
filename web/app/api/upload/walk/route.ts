/**
 * POST /api/upload/walk — turn detections found in a video into a real walk.
 *
 * The detector ran in the BROWSER (Transformers.js, WebGPU/WASM — it cannot run
 * here), so what arrives is its output: real `Detection[]` with real timestamps
 * from real frames. From there it is the ordinary pipeline — `scoreCandidates`
 * and `promoteToMoment`, the same functions and the same TRIGGER_WEIGHTS the
 * authored walks use — and the result is a Trip that `/walk?trip=<id>` renders
 * with no special-casing at the screen.
 *
 * Read the header of lib/uploadedTrips.ts before quoting any number this
 * produces: the detections, candidates and moments are measured, the positions
 * and the transcript are not.
 */
import { NextResponse } from "next/server";
import { linkJobToTrip } from "@/lib/splatJobs";
import { createUploadedWalk } from "@/lib/uploadedTrips";
import { validateDetections } from "@/lib/validate";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const result = validateDetections(body.detections);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400, headers: NO_STORE },
    );
  }

  const durationSec = Number(body.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return NextResponse.json(
      { error: "durationSec must be a positive number" },
      { status: 400, headers: NO_STORE },
    );
  }

  const walk = createUploadedWalk({
    detections: result.value,
    durationSec,
    sourceName: str(body.sourceName),
    placeLabel: str(body.placeLabel),
    region: str(body.region),
    country: str(body.country),
    splatJobId: str(body.splatJobId),
  });

  if (walk.splatJobId) linkJobToTrip(walk.splatJobId, walk.id);

  const { trip, distanceM } = walk.built;
  const discarded = trip.candidates.filter((c) => c.status === "discarded").length;

  return NextResponse.json(
    {
      tripId: walk.id,
      href: `/walk?trip=${walk.id}`,
      found: {
        detections: trip.detections.length,
        candidates: trip.candidates.length,
        discarded,
        moments: trip.moments.length,
        distanceM: Math.round(distanceM),
      },
      // Said in the payload, not only in a comment, because a caller that shows
      // these numbers has to be able to label them.
      measured: ["detections", "candidates", "moments", "object sightings"],
      synthesized: ["positions (a time transect, not odometry)", "no transcript — there was no audio pass"],
      persisted: false,
      note: "In memory only. Restarting the server forgets this walk.",
    },
    { status: 201, headers: NO_STORE },
  );
}

export function GET() {
  return NextResponse.json(
    {
      endpoint: "POST /api/upload/walk",
      accepts: {
        detections: "Detection[] — from a real detector, with real video timestamps",
        durationSec: "number — length of the source video",
        sourceName: "string, optional",
        splatJobId: "string, optional — links the walk to its reconstruction",
      },
      contract: "lib/types.ts → Detection · lib/uploadedTrips.ts → UploadedWalkInput",
      statuses: { 201: "walk built", 400: "validation failed" },
    },
    { status: 200 },
  );
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
