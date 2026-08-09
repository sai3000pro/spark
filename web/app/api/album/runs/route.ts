/**
 * GET /api/album/runs — the studio's run list, proxied from :8899 so the album's
 * training cards can poll progress (latest_iter / status) same-origin. Mirrors
 * the frames proxy; keeps the client ignorant of the studio URL.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${STUDIO_URL}/api/runs`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ runs: [], error: "studio unreachable" }, { status: 502 });
  }
}
