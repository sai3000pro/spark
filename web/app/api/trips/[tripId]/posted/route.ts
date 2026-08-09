/**
 * GET/POST /api/trips/:tripId/posted — is this walk on the shared globe?
 *
 * POST { posted: boolean } is the map's "post to the globe" toggle. The flag is
 * local state for now (lib/postedWalks.ts — same in-memory discipline as the
 * live trip); the contract is already the one a real share endpoint would keep.
 */
import { NextResponse } from "next/server";
import { isWalkPosted, setWalkPosted } from "@/lib/postedWalks";
import { resolveTripId } from "@/lib/tripData";

/** Mutable in-memory state — never prerendered, never CDN-cached. See
 *  app/api/trip/active/route.ts for the full argument. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Params = { params: Promise<{ tripId: string }> };

/** resolveTripId falls back to the flagship for anything unknown, so a round
 *  trip that changes the id means the id does not name a real walk. */
const knownTripId = (tripId: string): boolean => resolveTripId(tripId) === tripId;

export async function GET(_request: Request, { params }: Params) {
  const { tripId } = await params;
  if (!knownTripId(tripId)) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
  return NextResponse.json(
    { tripId, posted: isWalkPosted(tripId) },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request, { params }: Params) {
  const { tripId } = await params;
  if (!knownTripId(tripId)) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const posted = (body as { posted?: unknown } | null)?.posted;
  if (typeof posted !== "boolean") {
    return NextResponse.json(
      { error: "body must be { posted: boolean }" },
      { status: 400 },
    );
  }

  setWalkPosted(tripId, posted);
  return NextResponse.json({ tripId, posted }, { headers: NO_STORE });
}
