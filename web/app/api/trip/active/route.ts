/**
 * GET /api/trip/active — the in-flight trip, or null.
 *
 * The one GET in this app that is a data endpoint rather than a contract doc.
 * The toolbar polls it; the interval it should use comes back in the payload
 * (`pollAfterMs`) so the polling policy lives on the server and can be tuned
 * without shipping a client change.
 */
import { NextResponse } from "next/server";
import { getActiveTrip, serverStartedAt } from "@/lib/liveTrip";

/**
 * This route reads mutable in-memory state and must never be prerendered at build
 * time or cached by a CDN. Cache Components is not enabled today (next.config.ts
 * is empty), so route handlers are already uncached — but turning it on later
 * would otherwise silently freeze this endpoint at whatever it returned during
 * the build, which is `null`, forever.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET() {
  const active = getActiveTrip();

  return NextResponse.json(
    {
      active,
      // Fast while something is happening, lazy when nothing is.
      pollAfterMs: active ? 2000 : 15000,
      serverStartedAt: serverStartedAt(),
      contract: "lib/liveTrip.ts → ActiveTripSnapshot",
    },
    { headers: NO_STORE },
  );
}
