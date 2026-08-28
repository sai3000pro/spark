/**
 * POST /api/album/place { id, name, lat, lng } — attach (or clear) a run's
 * location, proxied to the studio's /api/run/place. lat/lng may be null: a run
 * can carry a place NAME with no coordinates (album label only, no map pin).
 * Sending both name empty AND lat null clears the location.
 *
 * These coordinates are exactly what the /walk map plots — this is where the
 * map's real data comes from.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let body: { id?: string; name?: string; lat?: number | null; lng?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${STUDIO_URL}/api/run/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: body.id,
        name: body.name ?? "",
        lat: body.lat ?? null,
        lng: body.lng ?? null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "studio unreachable" }, { status: 502 });
  }
}
