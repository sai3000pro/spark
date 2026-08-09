/**
 * GET /api/capture/live-splat?session=<id> — the live status of one run,
 * proxied from the studio's /api/live_splat. The Capture page calls this right
 * before opening bigview, to read the run's current_ply (the snapshot path
 * bigview ingests). Same-origin proxy so the client stays ignorant of the
 * studio URL, matching app/api/album/frames.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = new URL(request.url).searchParams.get("session") ?? "";
  if (!session) return NextResponse.json({ error: "session required" }, { status: 400 });
  try {
    const res = await fetch(
      `${STUDIO_URL}/api/live_splat?session=${encodeURIComponent(session)}`,
      { cache: "no-store" },
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "studio unreachable" }, { status: 502 });
  }
}
