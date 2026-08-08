/**
 * POST /api/ingest/moments — stage-3 output from the capture rig.
 *
 * Day-2 integration seam; see the detections route for the same pattern.
 */
import { NextResponse } from "next/server";
import { noteIngest } from "@/lib/liveTrip";
import { buildObjectIndex } from "@/lib/objectIndex";
import { validateMoment } from "@/lib/validate";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = validateMoment(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400 },
    );
  }

  const moment = result.value;

  // Echo back what the object index would learn from this moment — that is the
  // part downstream features ("where is my X?") actually depend on.
  // Guarded: the validator is the contract, but a shape it does not yet cover
  // should come back as a diagnosable 422 rather than an opaque 500.
  let index;
  try {
    // No path and no real trip record yet — the index only needs enough of one to
    // stamp sightings with an absolute clock, and an ingested moment has no
    // odometry attached, so nav targets legitimately come back undefined.
    index = buildObjectIndex([moment], [], {
      id: moment.tripId,
      title: moment.tripId,
      startedAt: new Date(0).toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "moment passed validation but could not be indexed",
        detail: err instanceof Error ? err.message : String(err),
        hint: "This is a gap in lib/validate.ts — the payload is missing a field the pipeline reads.",
      },
      { status: 422 },
    );
  }

  // ── TODO(day 2): persist here. `await db.moments.upsert(moment)` ────────────

  // See the note in the detections route — this is what flips the live counters
  // from extrapolated to measured.
  const attachedToActiveTrip = noteIngest(moment.tripId, { moments: 1 });

  return NextResponse.json(
    {
      accepted: moment.id,
      tripId: moment.tripId,
      attachedToActiveTrip,
      span: [moment.tStart, moment.tEnd],
      objects: moment.objects.length,
      locatable: moment.objects.filter((o) => o.worldPos).length,
      transcriptSegments: moment.transcript.length,
      splatStatus: moment.splat.status,
      indexedLabels: index.map((e) => e.label).sort(),
      persisted: false,
    },
    { status: 202 },
  );
}

export function GET() {
  return NextResponse.json(
    {
      endpoint: "POST /api/ingest/moments",
      accepts: "Moment",
      contract: "lib/types.ts → Moment",
      required: [
        "id",
        "tripId",
        "candidateId",
        "title",
        "summary",
        "tStart",
        "tEnd",
        "keyframes (non-empty)",
        "objects",
        "transcript",
        "splat.status",
        "vibe",
      ],
      note: "splat.url is required when splat.status is 'ready'.",
    },
    { status: 200 },
  );
}
