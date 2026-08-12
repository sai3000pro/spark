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
import type { KeywordHit } from "@/lib/pipeline";
import type { AudioEvent, TranscriptSegment } from "@/lib/types";

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

  // The audio pass, when the browser ran one. Shape-checked rather than
  // trusted: these feed TRIGGER_WEIGHTS directly, so a malformed event would
  // promote a window on a number nobody measured. Anything that fails the check
  // is dropped and the walk is built from the pictures, which is exactly what
  // happened before this stage existed.
  const audioEvents = validAudioEvents(body.audioEvents, durationSec);
  const keywordHits = validKeywordHits(body.keywordHits, durationSec);
  const transcript = validTranscript(body.transcript, durationSec);

  const walk = createUploadedWalk({
    detections: result.value,
    durationSec,
    sourceName: str(body.sourceName),
    placeLabel: str(body.placeLabel),
    region: str(body.region),
    country: str(body.country),
    splatJobId: str(body.splatJobId),
    audioEvents,
    keywordHits,
    transcript,
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
      measured: [
        "detections",
        "candidates",
        "moments",
        "object sightings",
        "camera motion (median box displacement — this is what makes dwell fire)",
        // Only claimed when it happened. This list is a ledger, and a ledger
        // that says "transcript" for a silent clip is worth nothing.
        ...(transcript.length
          ? [`transcript (${transcript.length} segments, Whisper in the browser)`]
          : []),
        ...(audioEvents.length ? ["speech energy (RMS over the real waveform)"] : []),
      ],
      synthesized: [
        "distance scale (monocular, from the depth proxy — an order of magnitude)",
        "direction (not estimated at all — the trace runs along one axis)",
        ...(transcript.length
          ? ["speaker labels — Whisper does not diarise, everyone is 'unknown'"]
          : ["no transcript — the audio pass did not run or found nothing"]),
      ],
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

// ─────────────────────────────────────────────────────────────────────────────
// The audio pass, checked before it is believed
//
// These three arrive from a browser and go straight into scoreCandidates, where
// they can promote a window. A hand-rolled POST with `energy: 1e9` and a
// thousand laughter events must not be able to manufacture moments — so every
// field is range-checked and anything outside it is dropped rather than
// clamped. Dropping is the safer failure: a missing trigger under-reports, a
// clamped one silently reports something nobody measured.
// ─────────────────────────────────────────────────────────────────────────────

/** Beyond this a clip is not being transcribed, it is being flooded. */
const MAX_AUDIO_EVENTS = 2000;

const inClip = (t: unknown, durationSec: number): t is number =>
  typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= durationSec + 1;

function validAudioEvents(raw: unknown, durationSec: number): AudioEvent[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(["speech", "laughter", "music", "ambient"]);

  return raw
    .slice(0, MAX_AUDIO_EVENTS)
    .filter((e): e is AudioEvent => {
      if (!e || typeof e !== "object") return false;
      const v = e as Record<string, unknown>;
      return (
        inClip(v.t, durationSec) &&
        typeof v.durationSec === "number" &&
        Number.isFinite(v.durationSec) &&
        v.durationSec > 0 &&
        v.durationSec <= durationSec + 1 &&
        typeof v.kind === "string" &&
        kinds.has(v.kind) &&
        typeof v.energy === "number" &&
        Number.isFinite(v.energy) &&
        v.energy >= 0 &&
        v.energy <= 1
      );
    });
}

function validKeywordHits(raw: unknown, durationSec: number): KeywordHit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_AUDIO_EVENTS)
    .filter((h): h is KeywordHit => {
      if (!h || typeof h !== "object") return false;
      const v = h as Record<string, unknown>;
      return (
        inClip(v.t, durationSec) &&
        typeof v.phrase === "string" &&
        v.phrase.length > 0 &&
        v.phrase.length <= 80
      );
    });
}

function validTranscript(raw: unknown, durationSec: number): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_AUDIO_EVENTS)
    .filter((s): s is TranscriptSegment => {
      if (!s || typeof s !== "object") return false;
      const v = s as Record<string, unknown>;
      return (
        typeof v.id === "string" &&
        inClip(v.t, durationSec) &&
        typeof v.durationSec === "number" &&
        Number.isFinite(v.durationSec) &&
        v.durationSec >= 0 &&
        typeof v.text === "string" &&
        // Long enough to be a sentence, short enough not to be a payload.
        v.text.length <= 2000 &&
        typeof v.speaker === "string" &&
        typeof v.confidence === "number"
      );
    });
}
