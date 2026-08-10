/**
 * POST /api/album/rename { id, label } — rename a run, proxied to the studio's
 * /api/run/rename (writes `label` into meta.json). Server-side so the JSON body
 * doesn't trip a CORS preflight.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { id?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.id || !body.label?.trim()) {
    return NextResponse.json({ error: "id and label required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${STUDIO_URL}/api/run/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: body.id, label: body.label.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "studio unreachable" }, { status: 502 });
  }
}
