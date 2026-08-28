/**
 * POST /api/ingest/detections — the robot's stage-1 feed.
 *
 * Validates against lib/types.ts, scores the batch with the real pipeline so the
 * caller can see immediately whether it would produce anything, and STORES it.
 *
 * It used to do the first two and drop the third — `TODO(day 2): persist here`,
 * and a response that said `persisted: false`. Honest, and it meant a rover
 * could stream for an hour and leave nothing behind but counters that had since
 * reset. lib/ingest/store.ts holds it now, per trip, with the detection feed
 * capped and the trimming REPORTED rather than silent.
 */
import { NextResponse } from "next/server";
import { noteIngest, openTripForIngest } from "@/lib/liveTrip";
import { scoreCandidates } from "@/lib/pipeline";
import { recordDetections } from "@/lib/ingest/store";
import { validateDetections } from "@/lib/validate";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = validateDetections(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400 },
    );
  }

  const detections = result.value;
  const tMax = Math.max(...detections.map((d) => d.t));

  // Run the real scorer so the caller can see immediately whether its batch
  // would produce anything — far more useful than a bare 201.
  let candidates;
  try {
    candidates = scoreCandidates({
      tripId: detections[0].tripId,
      durationSec: Math.max(16, tMax + 8),
      detections,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "batch passed validation but could not be scored",
        detail: err instanceof Error ? err.message : String(err),
        hint: "This is a gap in lib/validate.ts — the payload is missing a field the pipeline reads.",
      },
      { status: 422 },
    );
  }

  /*
    Stored before the session is opened, and before anything is reported.

    Order matters: `openTripForIngest` makes the counters on /live move, so a
    write that happened after it would leave a window where the screen says a
    batch arrived and nothing on disk agrees. Cheap, and it removes the window
    entirely.
  */
  const kept = recordDetections(detections[0].tripId, detections);

  // This batch IS the start. A rover does not have to call /api/trip/start
  // first — the first detections to arrive open the session under the rover's
  // own trip id, and the toolbar goes live on its own. Nothing else in the app
  // can open one, which is why every counter on screen was measured.
  openTripForIngest(detections[0].tripId);
  const attachedToActiveTrip = noteIngest(detections[0].tripId, {
    detections: detections.length,
    candidates: candidates.length,
  });

  return NextResponse.json(
    {
      accepted: detections.length,
      tripId: detections[0].tripId,
      attachedToActiveTrip,
      timeRange: [Math.min(...detections.map((d) => d.t)), tMax],
      distinctLabels: [...new Set(detections.map((d) => d.label))].sort(),
      distinctTracks: new Set(detections.map((d) => d.trackId ?? d.id)).size,
      candidates: candidates.map((c) => ({
        id: c.id,
        tStart: c.tStart,
        tEnd: c.tEnd,
        score: c.score,
        status: c.status,
        discardReason: c.discardReason,
        triggerKinds: c.triggers.map((t) => t.kind),
      })),
      persisted: true,
      held: kept.held,
      totalForTrip: kept.total,
      /*
        Non-zero when the per-trip cap trimmed the oldest detections on THIS
        call. Reported rather than swallowed: `accepted` would otherwise be a
        number that quietly stopped meaning "kept", and a caller reconciling its
        own counts against ours would find a discrepancy with no explanation.
      */
      trimmed: kept.dropped,
      note:
        kept.dropped > 0
          ? `Stored. ${kept.dropped} older detection(s) were trimmed — this trip holds the most recent ${kept.held}.`
          : "Stored.",
    },
    { status: 202 },
  );
}

export function GET() {
  return NextResponse.json(
    {
      endpoint: "POST /api/ingest/detections",
      accepts: "Detection[] or { detections: Detection[] }",
      contract: "lib/types.ts → Detection",
      example: {
        id: "det_0",
        tripId: "trip_live",
        frameId: "f_120",
        t: 4,
        label: "bottle",
        confidence: 0.91,
        bbox: [0.42, 0.55, 0.06, 0.14],
        trackId: "track_7",
        depthM: 1.3,
        worldPos: [480.3, 0.78, 60.5],
        source: "onboard",
      },
    },
    { status: 200 },
  );
}
