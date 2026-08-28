/**
 * POST /api/capture/delete { session } — delete one live splat run.
 *
 * Proxied to the studio's /api/live/delete server-side so the JSON body doesn't
 * trigger a CORS preflight the studio's plain HTTP server wouldn't answer (same
 * reason as app/api/album/thumb). The studio keeps the captured phone frames;
 * only the splat + dataset are removed.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

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
    const res = await fetch(`${STUDIO_URL}/api/live/delete`, {
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
