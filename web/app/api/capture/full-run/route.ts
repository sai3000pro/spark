/**
 * POST /api/capture/full-run { session } — queue a high-quality offline
 * reconstruction from a captured live splat run.
 *
 * Proxied to the studio's /api/live/full-run server-side so the JSON body
 * doesn't trigger a CORS preflight the studio's plain HTTP server wouldn't
 * answer (same reason as app/api/capture/delete). The finished splat later
 * appears in the Album.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { session?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.session) {
    return NextResponse.json({ error: "session required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${STUDIO_URL}/api/live/full-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: body.session }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "studio unreachable" }, { status: 502 });
  }
}
