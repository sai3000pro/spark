/**
 * POST /api/album/thumb { id, path } — pin a source frame as a run's album cover.
 *
 * Proxied to the studio's /api/run/thumb (which writes `thumb` into the run's
 * meta.json, so _ref_image prefers it thereafter). Done server-side so the
 * JSON body doesn't trigger a CORS preflight the studio's plain HTTP server
 * wouldn't answer.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let body: { id?: string; path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.id || !body.path) {
    return NextResponse.json({ error: "id and path required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${STUDIO_URL}/api/run/thumb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: body.id, path: body.path }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "studio unreachable" }, { status: 502 });
  }
}
